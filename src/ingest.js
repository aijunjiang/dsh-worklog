/**
 * 从会话语料生成一条“工作记录”（item）。
 * - 活动 = surface 上的 user/message 与 assistant/message（排除 log-only 簿记事件）
 * - 开始/结束 = 首/末活动消息时刻；时长 = 末-首（日历“按发生结束时间点归属”）
 * - 天分布：每条消息落在其所在本地日；跨日间隔整段计入后一条消息所在日
 * - 保留已生成的摘要，活动尾部前进则把摘要标记为待重算
 */
import { dayKey, fmtDuration, localClock } from './times.js'

const ACTIVITY_TYPES = new Set(['user/message', 'assistant/message'])
const CONTENT_TYPES = new Set(['user/message', 'assistant/message', 'tool/result'])

export function labelForCwd(cwd) {
  if (!cwd) return '(unknown)'
  const m = String(cwd).match(/\/\.dsh\/dsh-ssh-routes\/([^/]+)\/(.+)$/)
  if (m) return `ssh:${m[2]}`
  const parts = String(cwd).replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || cwd
}

/** 计算会话的度量：活动消息（按 surface current 优先，缺省回退 shadowed）。 */
export function computeMetrics(events) {
  const act = []
  for (const e of events) {
    if (!ACTIVITY_TYPES.has(e.type)) continue
    if (e.surface !== 'current' && e.surface !== 'shadowed') continue
    act.push(e)
  }
  if (act.length === 0) {
    // 极端：持久化会话可能 surface 标记缺失，退回全部同类型事件
    for (const e of events) {
      if (ACTIVITY_TYPES.has(e.type)) act.push(e)
    }
  }
  if (act.length === 0) return null
  act.sort((a, b) => a.time - b.time)
  let userMsg = 0
  let asstMsg = 0
  let min = Infinity
  let max = -Infinity
  for (const e of act) {
    if (e.type === 'user/message') userMsg++
    else if (e.type === 'assistant/message') asstMsg++
    if (e.time < min) min = e.time
    if (e.time > max) max = e.time
  }
  return {
    firstActivityMs: min,
    lastActivityMs: max,
    durationMs: Math.max(0, max - min),
    userMsgCount: userMsg,
    assistantMsgCount: asstMsg,
  }
}

function msInDayRange(fromMs, toMs, offsetMinutes) {
  // from 所在日起点 → to 所在日（不含次日零点）区间
  const d0 = dayKey(fromMs, offsetMinutes)
  const [y, m, dd] = d0.split('-').map(Number)
  const start = Date.UTC(y, m - 1, dd) - offsetMinutes * 60_000
  const end = start + 86_400_000
  const a = Math.max(fromMs, start)
  const b = Math.min(toMs, end)
  return { start, end, overlapMs: Math.max(0, b - a) }
}

/**
 * @param events 轻量事件（listEvents 输出）
 * @param offsetMinutes 本地时区偏移
 */
export function computeDayBuckets(events, offsetMinutes) {
  const act = []
  for (const e of events) {
    if (!CONTENT_TYPES.has(e.type)) continue
    if (e.surface !== 'current' && e.surface !== 'shadowed') continue
    act.push(e)
  }
  if (act.length === 0) {
    for (const e of events) {
      if (CONTENT_TYPES.has(e.type)) act.push(e)
    }
  }
  act.sort((a, b) => a.time - b.time)
  const buckets = {}
  let prevTime = null
  for (const e of act) {
    const cur = e.time
    const dk = dayKey(cur, offsetMinutes)
    const b = buckets[dk] || (buckets[dk] = { activityMs: 0, msgs: 0, lastActivityMs: 0 })
    b.msgs += 1
    if (cur > b.lastActivityMs) b.lastActivityMs = cur
    if (prevTime !== null) {
      // 间隔整段计入“后一条消息”所在日（工作按发生结束时间点）
      const { overlapMs } = msInDayRange(prevTime, cur, offsetMinutes)
      b.activityMs += overlapMs
    }
    prevTime = cur
  }
  // 无间隔可计时时给出一个保守下限（首条消息后 1 分钟），保证日历有“工作时长”可看
  let total = 0
  for (const k of Object.keys(buckets)) total += buckets[k].activityMs
  if (total === 0 && act.length > 0) {
    const firstDk = dayKey(act[0].time, offsetMinutes)
    buckets[firstDk].activityMs = 60_000
  }
  return buckets
}

/** 是否应统计该会话（子代理/预设/工作区过滤）。 */
export function shouldTrack(rec, cfg) {
  const hdr = rec.header || {}
  // 子代理会话默认不单独计为“工作会话”（它属于父会话的工作过程）
  if (!cfg.includeSubagents) {
    if (hdr.origin === 'subagent') return false
    if (typeof hdr.delegationDepth === 'number' && hdr.delegationDepth > 0) return false
  }
  const cwd = hdr.cwd || ''
  if (Array.isArray(cfg.excludeCwdPrefixes)) {
    for (const p of cfg.excludeCwdPrefixes) {
      if (p && cwd.startsWith(String(p))) return false
    }
  }
  if (Array.isArray(cfg.includeAgentPresets) && cfg.includeAgentPresets.length > 0) {
    const preset = rec.header && rec.header.agentPreset
    if (!cfg.includeAgentPresets.includes(preset)) return false
  }
  return true
}

/**
 * 扫描语料并 upsert 工作记录。
 * @returns {Promise<{total:number,kept:number,changed:number,pendingSummaries:number}>}
 */
export async function scanSessions({ sessionQuery, cfg, store, readTitle = true, logger = console }) {
  const sq = sessionQuery
  const all = await sq.listSessions()
  const offset = cfg.timezoneOffsetMinutes
  let kept = 0
  let changed = 0
  let pendingSummaries = 0
  for (const rec of all) {
    const hdr = rec && rec.header
    if (!hdr || !hdr.id) continue
    if (!shouldTrack(rec, cfg)) continue
    const previous = store.get(hdr.id)
    const events = await sq.listEvents(hdr.id)
    const metrics = computeMetrics(events)
    const id = hdr.id
    if (!metrics) {
      // 无内容的会话（如仅权限事件）：保留旧记录但置 live，不产生新工作项
      if (previous && previous.live !== rec.live) {
        store.patch(id, { live: rec.live, updatedAtMs: Date.now() })
        changed++
      }
      continue
    }
    const buckets = computeDayBuckets(events, offset)
    const days = Object.keys(buckets).sort()
    const endDay = dayKey(metrics.lastActivityMs, offset)
    const title = readTitle ? await safeTitle(sq, id) : (previous ? previous.title : null)
    const now = Date.now()
    const dayList = {}
    for (const k of days) {
      dayList[k] = { ...buckets[k] }
    }
    const nodes = previous && previous.nodes ? previous.nodes : []
    const lastSummarizedThroughMs = previous && typeof previous.lastSummarizedThroughMs === 'number' ? previous.lastSummarizedThroughMs : 0
    const next = {
      sessionId: id,
      cwd: hdr.cwd || '',
      cwdLabel: labelForCwd(hdr.cwd),
      agentPreset: hdr.agentPreset || '',
      createdAtMs: hdr.createdAt,
      title: title || (previous ? previous.title : '') || '',
      live: !!rec.live,
      persisted: !!rec.persisted,
      firstActivityMs: metrics.firstActivityMs,
      lastActivityMs: metrics.lastActivityMs,
      lastActivityClock: localClock(metrics.lastActivityMs, offset),
      durationMs: metrics.durationMs,
      userMsgCount: metrics.userMsgCount,
      assistantMsgCount: metrics.assistantMsgCount,
      days: dayList,
      endDay,
      spanDayCount: days.length,
      nodes,
      lastSummarizedThroughMs,
      updatedAtMs: now,
    }
    const existed = !!previous
    store.upsert(id, next)
    kept++
    if (!existed || previous.live !== next.live
      || previous.lastActivityMs !== next.lastActivityMs
      || (previous.title || '') !== (next.title || '')) changed++
    // 待补摘要：有新活动越过上次完整摘要点
    if (metrics.lastActivityMs > lastSummarizedThroughMs) pendingSummaries++
  }
  store.setMeta({ lastScanMs: Date.now() })
  return { total: all.length, kept, changed, pendingSummaries }
}

async function safeTitle(sq, id) {
  try {
    const t = await sq.readTitle(id)
    if (t && typeof t === 'object' && typeof t.title === 'string') return t.title
    return ''
  } catch {
    return ''
  }
}

export { fmtDuration }
