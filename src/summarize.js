/**
 * 摘要队列：按“对话节点”逐节点补摘要，指纹缓存 + 增量重算。
 * - 每个节点 = 一轮用户消息 → 模型完成（buildNodes）。
 * - 节点指纹（内容哈希）不变 → 复用已有摘要缓存，不重复消耗 token。
 * - 会话有新活动时，只对新增/变化的节点重新摘要，老节点保持不动。
 * - 会话整体在报告里仍按一条项目聚合（report 层把该会话所有节点摘要合并）。
 */
import { todayKey } from './times.js'
import { buildNodes, hashText } from './transcript.js'
import { generateDaySummary } from './llm.js'

function settingsOf(settings) {
  return (settings && typeof settings === 'function') ? settings() : (settings || {})
}

export async function drainSummaries({ ctx, sq, cfg, store, settings, limit, logger = console }) {
  if (!cfg.autoSummarize) return 0
  const now = Date.now()
  const today = todayKey(cfg.timezoneOffsetMinutes)
  const st = settingsOf(settings)
  const proactive = !!st.proactive
  const cap = limit || cfg.summarizePerRun || 5

  // 候选：上次完整摘要之后又有新活动（lastActivityMs 越过 lastSummarizedThroughMs）
  const candidates = store.all().filter((it) => {
    if (!it.sessionId) return false
    const through = it.lastSummarizedThroughMs || 0
    if (it.lastActivityMs <= through) return false
    if (proactive) return true
    if (it.endDay < today) return true
    return now - it.lastActivityMs >= cfg.settleIdleMs
  }).sort((a, b) => a.lastActivityMs - b.lastActivityMs)

  let done = 0
  for (const item of candidates) {
    if (done >= cap) break
    try {
      const surface = await sq.readSurface(item.sessionId)
      const nodes = buildNodes(surface && surface.events ? surface.events : [], cfg.timezoneOffsetMinutes)
      const byKey = new Map()
      for (const n of (item.nodes || [])) {
        if (n && n.day && n.startMs) byKey.set(`${n.day}:${n.startMs}`, n)
      }
      const nextNodes = []
      let through = item.lastSummarizedThroughMs || 0
      for (const node of nodes) {
        const fp = hashText(node.text)
        const key = `${node.day}:${node.startMs}`
        const prev = byKey.get(key)
        let summary = null
        if (prev && prev.fp === fp && prev.summary && prev.summary.text) {
          summary = prev.summary // 指纹一致 → 复用缓存
        } else if (done < cap && node.text.length >= 20) {
          const res = await generateDaySummary(ctx, cfg, st, node.text)
          if (res.ok) {
            summary = { text: res.summary, tags: res.tags, model: res.model, generatedAtMs: Date.now(), fp }
            done++
          }
        }
        if (summary) {
          if (node.endMs > through) through = node.endMs
          nextNodes.push({ day: node.day, startMs: node.startMs, endMs: node.endMs, fp, summary })
        }
        // 无摘要（cap 用尽或生成失败）的节点暂不写入，下次扫描重试
      }
      store.patch(item.sessionId, { nodes: nextNodes, lastSummarizedThroughMs: through })
    } catch (e) {
      logger.error(`[dsh-worklog] summary threw for ${item.sessionId}: ${(e && e.message) || e}`)
    }
  }
  store.setMeta({ lastSummaryMs: Date.now() })
  return done
}
