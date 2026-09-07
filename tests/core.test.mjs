/**
 * dsh-worklog 核心逻辑单测（node --test，纯函数，无宿主依赖）。
 * 运行：node --test tests/
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../src/store.js'
import { computeMetrics, computeDayBuckets, labelForCwd, shouldTrack } from '../src/ingest.js'
import { selectItems, buildReportMarkdown, buildRangeMarkdown } from '../src/report.js'
import { dayKey, fmtDuration, nextDayKey, cmpDay } from '../src/times.js'

const OFF = 480 // Asia/Shanghai
const mk = (seq, type, time, surface = 'current') => ({ seq, type, time, surface })

test('dayKey 按 +8 偏移正确', () => {
  // 2026-09-03T15:50Z == 本地 23:50（09-03）；16:00Z == 00:00（09-04）
  assert.equal(dayKey(Date.UTC(2026, 8, 3, 15, 50), OFF), '2026-09-03')
  assert.equal(dayKey(Date.UTC(2026, 8, 3, 16, 0), OFF), '2026-09-04')
  assert.equal(nextDayKey('2026-09-03'), '2026-09-04')
  assert.equal(cmpDay('2026-09-03', '2026-09-04'), -1)
})

test('computeMetrics：活动窗口与计数', () => {
  const evs = [
    mk(0, 'user/message', Date.UTC(2026, 8, 3, 15, 50)),
    mk(1, 'assistant/message', Date.UTC(2026, 8, 3, 16, 20)),
    mk(2, 'tool/call', Date.UTC(2026, 8, 3, 16, 5), 'log-only'), // 不计入
    mk(3, 'assistant/chunk', Date.UTC(2026, 8, 3, 16, 10), 'log-only'),
  ]
  const m = computeMetrics(evs)
  assert.equal(m.userMsgCount, 1)
  assert.equal(m.assistantMsgCount, 1)
  assert.equal(m.durationMs, 30 * 60_000)
})

test('computeDayBuckets：跨零点间隔计入“后一条消息所在日”', () => {
  const evs = [
    mk(0, 'user/message', Date.UTC(2026, 8, 3, 15, 50)),      // 本地 09-03 23:50
    mk(1, 'assistant/message', Date.UTC(2026, 8, 3, 16, 0)),  // 本地 09-04 00:00
    mk(2, 'assistant/message', Date.UTC(2026, 8, 3, 16, 20)), // 本地 09-04 00:20
  ]
  const b = computeDayBuckets(evs, OFF)
  assert.equal(b['2026-09-03'].msgs, 1)
  assert.equal(b['2026-09-03'].activityMs, 0) // 计时归入结束日
  assert.equal(b['2026-09-04'].msgs, 2)
  assert.equal(b['2026-09-04'].activityMs, 30 * 60_000)
  const total = Object.values(b).reduce((s, v) => s + v.activityMs, 0)
  assert.equal(total, 30 * 60_000)
})

test('shouldTrack：子代理默认排除、可按 preset/前缀过滤', () => {
  const rec = (extra) => ({ header: { id: 's', cwd: '/w', agentPreset: 'standard', ...extra }, live: true, persisted: true })
  const cfg = { includeSubagents: false, includeAgentPresets: [], excludeCwdPrefixes: [] }
  assert.equal(shouldTrack(rec({ delegationDepth: 1 }), cfg), false)
  assert.equal(shouldTrack(rec({ origin: 'subagent' }), cfg), false)
  assert.equal(shouldTrack(rec({}), cfg), true)
  assert.equal(shouldTrack(rec({}), { ...cfg, excludeCwdPrefixes: ['/w'] }), false)
  assert.equal(shouldTrack(rec({ agentPreset: 'ptc' }), { ...cfg, includeAgentPresets: ['standard'] }), false)
  assert.equal(shouldTrack(rec({ delegationDepth: 2 }), { ...cfg, includeSubagents: true }), true)
})

test('labelForCwd：SSH 路由给可读标签', () => {
  assert.equal(labelForCwd('/Users/ruitongxue/.dsh/dsh-ssh-routes/c1/home/haitang'), 'ssh:home/haitang')
  assert.equal(labelForCwd('/Users/x/MyProject/DSH-plugin'), 'DSH-plugin')
})

test('selectItems：日期重叠与 includeIds 勾选', () => {
  const store = createStore('/tmp/dsh-worklog-unit-test')
  const a = Date.UTC(2026, 8, 3, 15, 50)
  const b = Date.UTC(2026, 8, 3, 16, 20)
  const item = {
    sessionId: 'sx', cwdLabel: 'w', title: 't', firstActivityMs: a, lastActivityMs: b,
    durationMs: b - a, days: { '2026-09-03': { activityMs: 0, msgs: 1 }, '2026-09-04': { activityMs: b - a, msgs: 2 } },
    endDay: '2026-09-04', spanDayCount: 2,
    summary: { text: 'x', tags: ['a'], stale: false },
  }
  store.upsert('sx', item)
  assert.equal(selectItems(store, '2026-09-03', '2026-09-03', null).length, 1) // 起始日可检索
  assert.equal(selectItems(store, '2026-09-04', '2026-09-04', null).length, 1) // 结束日可检索
  assert.equal(selectItems(store, '2026-09-05', '2026-09-05', null).length, 0) // 区间外不出现
  assert.equal(selectItems(store, '2026-01-01', '2026-12-31', ['sx']).length, 1) // includeIds
  assert.equal(selectItems(store, '2026-01-01', '2026-12-31', ['missing']).length, 0)
  const md = buildReportMarkdown(selectItems(store, '2026-09-03', '2026-09-04', null), '2026-09-03', '2026-09-04', 'custom', OFF)
  assert.ok(md.includes('跨天'))
  assert.ok(buildRangeMarkdown([], '2026-09-03', '2026-09-03', OFF).includes('没有工作记录'))
})

test('store：原子落盘与重载', () => {
  const dir = '/tmp/dsh-worklog-unit-store'
  const s1 = createStore(dir)
  s1.upsert('a', { sessionId: 'a', title: '1' })
  s1.patch('a', { title: '2' })
  s1.flush()
  const s2 = createStore(dir)
  assert.equal(s2.get('a').title, '2')
})

test('fmtDuration 展示', () => {
  assert.equal(fmtDuration(30 * 60_000), '30m')
  assert.equal(fmtDuration(60 * 60_000), '1h')
  assert.equal(fmtDuration(90 * 60_000), '1h30m')
  assert.equal(fmtDuration(45_000), '45s')
  assert.equal(fmtDuration(0), '0m')
})
