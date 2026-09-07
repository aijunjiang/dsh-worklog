/**
 * 本地“天”的切分工具。所有会话事件时间为 epoch 毫秒（UTC）；
 * 日历按用户本地时区（固定偏移分钟）切成 YYYY-MM-DD 的“天”。
 */
export const DAY_MS = 86_400_000

function pad2(n) {
  return n < 10 ? `0${n}` : String(n)
}

/** epoch ms → 本地天 key 'YYYY-MM-DD'（按 timezoneOffsetMinutes 平移）。 */
export function dayKey(ms, offsetMinutes) {
  const d = new Date(ms + offsetMinutes * 60_000)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/** epoch ms → 本地时（HH:MM，便于展示）。 */
export function localClock(ms, offsetMinutes) {
  const d = new Date(ms + offsetMinutes * 60_000)
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`
}

/** 某天起点 epoch ms（本地）。 */
export function dayStartMs(day, offsetMinutes) {
  const [y, m, dd] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, dd) - offsetMinutes * 60_000
}

/** 某天（含）之后的第一个零点 key，用于“到昨天为止”等开区间上限。 */
export function nextDayKey(day) {
  const [y, m, dd] = day.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1, dd + 1))
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/** 自然比较两个 'YYYY-MM-DD' key。 */
export function cmpDay(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 今天的本地 day key。 */
export function todayKey(offsetMinutes) {
  return dayKey(Date.now(), offsetMinutes)
}

/** 按分钟精度的活动时长串（如 1h05m / 45m / 90s）。 */
export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0m'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm === 0 ? `${h}h` : `${h}h${String(mm).padStart(2, '0')}m`
}
