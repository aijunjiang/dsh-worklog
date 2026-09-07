/**
 * 从会话 surface 构建用于摘要/报告的精简工作记录稿。
 * 只保留“真实用户消息(source.kind==='user')”与“最终助手消息(source.kind==='model')”，
 * 剔除插件注入的系统提示等噪音；超长时保留头尾。
 */
import { localClock, dayKey } from './times.js'

function blockText(blocks, wanted) {
  const out = []
  if (!Array.isArray(blocks)) return ''
  for (const b of blocks) {
    if (!b) continue
    if (b.type === 'text' && wanted.text && typeof b.text === 'string') out.push(b.text)
    else if (b.type === 'reasoning' && wanted.reasoning && typeof b.text === 'string') out.push(b.text)
  }
  return out.join('\n')
}

/** 收集真实用户 + 最终助手文本条目（按 seq 升序）。 */
function collectEntries(surfaceEvents) {
  const entries = []
  let userCount = 0
  for (const ev of surfaceEvents) {
    const data = ev && ev.data ? ev.data : {}
    if (ev.type === 'user/message') {
      const src = data.source
      if (!src || src.kind !== 'user') continue // 排除 plugin/system 注入
      const text = blockText(data.content, { text: true })
      if (!text) continue
      userCount++
      entries.push({ seq: ev.seq, time: ev.time, role: '用户', text })
    } else if (ev.type === 'assistant/message') {
      const msg = data.message
      const src = msg && msg.source
      if (!msg || !src || src.kind !== 'model') continue
      const text = blockText(msg.content, { text: true, reasoning: false })
      if (!text) continue
      entries.push({ seq: ev.seq, time: ev.time, role: '助手', text })
    }
  }
  entries.sort((a, b) => a.seq - b.seq)
  return { entries, userCount }
}

/** 把一批条目渲染成受限文本（头尾保留）。 */
function render(entries, offsetMinutes, capChars) {
  const halfHead = Math.floor(capChars * 0.55)
  const halfTail = capChars - halfHead
  let text = ''
  const append = (e) => {
    text += `[${e.role} ${localClock(e.time, offsetMinutes)}] ${e.text}\n\n`
  }
  if (entries.reduce((s, e) => s + e.text.length, 0) <= capChars) {
    for (const e of entries) append(e)
  } else {
    let acc = 0
    let cut = -1
    for (let i = 0; i < entries.length; i++) {
      acc += entries[i].text.length
      if (acc > halfHead) { cut = i; break }
    }
    const keepTail = []
    acc = 0
    for (let i = entries.length - 1; i >= 0; i--) {
      acc += entries[i].text.length
      keepTail.unshift(i)
      if (acc > halfTail || keepTail.length >= 24) break
    }
    for (let i = 0; i <= cut; i++) append(entries[i])
    if (cut < entries.length - 1) text += `…（中段 ${entries.length - 1 - cut} 条消息因过长省略，共 ${entries.length} 条）\n\n`
    for (const i of keepTail) {
      if (i > cut) append(entries[i])
    }
  }
  return text
}

/** 整会话转录（保留旧语义）。 */
export function buildTranscript(surfaceEvents, offsetMinutes, capChars) {
  const { entries, userCount } = collectEntries(surfaceEvents)
  if (entries.length === 0) return { text: '', userCount: 0 }
  return { text: render(entries, offsetMinutes, capChars), userCount }
}

/** 轻量字符串哈希（djb2），用于节点指纹，检测内容变化以复用摘要缓存。 */
export function hashText(text) {
  let h = 5381
  const s = String(text || '')
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return String(h >>> 0)
}

/**
 * 按“对话节点”切片：每个真实用户消息 + 其后直到下一条用户消息之间的助手消息 = 一个节点。
 * @returns {Array<{day:string,startMs:number,endMs:number,text:string}>}
 */
export function buildNodes(surfaceEvents, offsetMinutes) {
  const evs = surfaceEvents.slice().sort((a, b) => a.seq - b.seq)
  const nodes = []
  let cur = null
  for (const ev of evs) {
    const data = ev && ev.data ? ev.data : {}
    if (ev.type === 'user/message') {
      const src = data.source
      if (!src || src.kind !== 'user') continue
      const text = blockText(data.content, { text: true })
      if (!text) continue
      if (cur) nodes.push(cur)
      cur = { day: dayKey(ev.time, offsetMinutes), startMs: ev.time, endMs: ev.time, userText: text, asstText: '' }
    } else if (ev.type === 'assistant/message') {
      const msg = data.message
      const src = msg && msg.source
      if (!msg || !src || src.kind !== 'model') continue
      const text = blockText(msg.content, { text: true, reasoning: false })
      if (!text) continue
      if (!cur) continue
      cur.asstText += (cur.asstText ? '\n\n' : '') + text
      cur.endMs = ev.time
    }
  }
  if (cur) nodes.push(cur)
  return nodes.map((n) => ({
    day: n.day,
    startMs: n.startMs,
    endMs: n.endMs,
    text: `[用户] ${n.userText}\n[助手] ${n.asstText}`.trim(),
  }))
}

/**
 * 按本地日期切片转录：每天一段，供“按日期切片摘要”。
 * @returns {Record<string, {text:string, userCount:number}>} day 'YYYY-MM-DD' → 该日文本
 */
export function buildDailyTranscripts(surfaceEvents, offsetMinutes, capPerDay) {
  const { entries, userCount } = collectEntries(surfaceEvents)
  const byDay = {}
  for (const e of entries) {
    const d = dayKey(e.time, offsetMinutes)
    ;(byDay[d] || (byDay[d] = [])).push(e)
  }
  const out = {}
  for (const d of Object.keys(byDay)) {
    const list = byDay[d]
    const uCount = list.filter((e) => e.role === '用户').length
    out[d] = { text: render(list, offsetMinutes, capPerDay), userCount: uCount }
  }
  return { days: out, totalUserCount: userCount }
}
