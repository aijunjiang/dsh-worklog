/**
 * 报表组装（确定性 markdown 基底；LLM 润色在 tools 层可选接入）。
 * 范围语义：与 [from,to] 有活动重叠（任一 activityDay 落在区间内）即入选；
 * 跨天条目保留完整时间跨度并在条目中标注“跨天”。
 */
import { cmpDay, fmtDuration, localClock, dayKey } from './times.js'

/** 某条 item 是否与日期区间重叠。 */
export function overlaps(item, fromDay, toDay) {
  const days = item.days ? Object.keys(item.days) : []
  if (!days.length) {
    const d = dayKey(item.lastActivityMs, 0) // 兜底按 UTC 近似
    return cmpDay(d, fromDay) >= 0 && cmpDay(d, toDay) <= 0
  }
  const sorted = days.slice().sort(cmpDay)
  return cmpDay(sorted[0], toDay) <= 0 && cmpDay(sorted[sorted.length - 1], fromDay) >= 0
}

export function selectItems(store, fromDay, toDay, includeIds) {
  const pool = Array.isArray(includeIds) && includeIds.length
    ? includeIds.map((id) => store.get(String(id))).filter(Boolean)
    : store.all()
  const seen = new Set()
  const out = []
  for (const it of pool) {
    if (!it || !it.sessionId || seen.has(it.sessionId)) continue
    seen.add(it.sessionId)
    if (Array.isArray(includeIds) && includeIds.length) { out.push(it); continue }
    if (overlaps(it, fromDay, toDay)) out.push(it)
  }
  out.sort((a, b) => a.firstActivityMs - b.firstActivityMs)
  return out
}

/** 会话内落在 [from,to] 日期区间的对话节点（按日期筛选，解决跨天串内容）。 */
function filterNodes(item, from, to) {
  const nodes = item.nodes || []
  return nodes.filter((n) => n && n.day && cmpDay(n.day, from) >= 0 && cmpDay(n.day, to) <= 0)
}

/** [from,to] 区间内的摘要文本：按节点合并。 */
function dailyText(item, from, to) {
  const sums = filterNodes(item, from, to).filter((n) => n.summary && n.summary.text).map((n) => n.summary)
  if (sums.length) return sums.map((s) => s.text).join('；')
  return item.summary && item.summary.text ? item.summary.text : ''
}

/** [from,to] 区间内的标签集合。 */
function dailyTags(item, from, to) {
  const tags = new Set()
  for (const n of filterNodes(item, from, to)) {
    if (!n.summary) continue
    for (const t of n.summary.tags || []) if (t) tags.add(t)
  }
  if (!tags.size && item.summary && item.summary.tags) {
    for (const t of item.summary.tags) if (t) tags.add(t)
  }
  return [...tags]
}

function line(item, offset) {
  const span = `[${localClock(item.firstActivityMs, offset)}–${localClock(item.lastActivityMs, offset)}]`
  const cross = item.spanDayCount > 1 ? '（跨天）' : ''
  const title = item.title || '（无标题）'
  const where = item.cwdLabel ? ` · ${item.cwdLabel}` : ''
  return { span, cross, title, where, durationMs: item.durationMs }
}

/** 按天分组的范围清单（worklog_range 输出）。 */
export function buildRangeMarkdown(items, fromDay, toDay, offset) {
  if (!items.length) return `（${fromDay} ~ ${toDay} 之间没有工作记录）`
  const groups = {}
  for (const it of items) {
    const days = (it.days && Object.keys(it.days).slice().sort(cmpDay)) || [it.endDay]
    for (const d of days) {
      if (cmpDay(d, fromDay) < 0 || cmpDay(d, toDay) > 0) continue
      ;(groups[d] || (groups[d] = [])).push(it)
    }
  }
  const keys = Object.keys(groups).sort(cmpDay)
  const out = []
  let totalMs = 0
  let sessions = 0
  const sessionsSeen = new Set()
  for (const d of keys) {
    out.push(`## ${d}`)
    const list = groups[d].sort((a, b) => a.firstActivityMs - b.firstActivityMs)
    for (const it of list) {
      const L = line(it, offset)
      totalMs += it.durationMs
      if (!sessionsSeen.has(it.sessionId)) { sessions++; sessionsSeen.add(it.sessionId) }
      const dayMs = (it.days && it.days[d] && it.days[d].activityMs) || 0
      const msgs = (it.days && it.days[d] && it.days[d].msgs) || 0
      const dayLabel = dayMs > 0
        ? `当日约 ${fmtDuration(dayMs)}`
        : msgs > 0 ? `当日 ${msgs} 条消息（计时归入结束日）` : ''
      const summary = dailyText(it, d, d)
      const tags = dailyTags(it, d, d)
      const tagStr = tags.length ? `  \`${tags.join('` `')}\`` : ''
      out.push(`- ${L.span} ${L.cross}${L.where} **${L.title}**（${dayLabel}）${summary ? `\n  ${summary}` : ''}${tagStr}`)
    }
  }
  return [
    `# DSH 工作记录 ${fromDay} ~ ${toDay}`,
    `> 会话 ${sessions} 次 · 记录总时长（跨天完整跨度）${fmtDuration(totalMs)}`,
    '',
    ...out,
  ].join('\n')
}

/** 报告主体（日报/周报/半年共用一个组装器，头部与粒度不同）。 */
export function buildReportMarkdown(items, fromDay, toDay, kind, offset) {
  const kindLabel = { daily: '日报', weekly: '周报', monthly: '月报', halfyear: '半年总结', custom: '总结' }[kind] || '总结'
  const title = kind === 'daily'
    ? `${fromDay}`
    : `${fromDay} ~ ${toDay}`
  const Ls = items.map((it) => line(it, offset))
  let totalMs = 0
  const tags = new Map()
  const spans = new Map()
  for (const it of items) {
    const fNodes = filterNodes(it, fromDay, toDay)
    const minMs = fNodes.length ? Math.min(...fNodes.map((n) => n.startMs)) : it.firstActivityMs
    const maxMs = fNodes.length ? Math.max(...fNodes.map((n) => n.endMs)) : it.lastActivityMs
    spans.set(it.sessionId, { minMs, maxMs, durMs: Math.max(0, maxMs - minMs) })
    totalMs += Math.max(0, maxMs - minMs)
    for (const t of dailyTags(it, fromDay, toDay)) tags.set(t, (tags.get(t) || 0) + 1)
  }
  const topTags = [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t)
  const lines = []
  lines.push(`# DSH ${kindLabel} ${title}`)
  lines.push(`> 会话 ${items.length} 次 · 覆盖时长 ${fmtDuration(totalMs)}${topTags.length ? ` · 高频标签：${topTags.join('、')}` : ''}`)
  lines.push('')
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const L = Ls[i]
    const summary = dailyText(it, fromDay, toDay)
    const sp = spans.get(it.sessionId)
    const d0 = sp.minMs ? dayKey(sp.minMs, offset) : ''
    const d1 = dayKey(sp.maxMs, offset)
    const timeStr = d0 === d1
      ? `${d0} ${localClock(sp.minMs, offset)} – ${localClock(sp.maxMs, offset)}`
      : `${d0} ${localClock(sp.minMs, offset)} – ${d1} ${localClock(sp.maxMs, offset)}`
    const tagList = dailyTags(it, fromDay, toDay)
    lines.push(`## ${i + 1}. ${L.title}`)
    lines.push(`- 时间：${timeStr}（${fmtDuration(sp.durMs)}）${L.cross ? '，跨天' : ''}${L.where}`)
    if (summary) lines.push(`- 内容：${summary}`)
    if (tagList.length) lines.push(`- 标签：${tagList.join('、')}`)
    lines.push('')
  }
  lines.push(`---\n> 由 dsh-worklog 生成 · 逐条勾选/生成的正式报告可在此基础上由模型润色。`)
  return lines.join('\n')
}
