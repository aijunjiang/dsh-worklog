/**
 * endpoints.js 纯函数单测（monthSummary）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../src/store.js'
import { monthSummary } from '../src/endpoints.js'

function storeWith(items) {
  const s = createStore('/tmp/dsh-worklog-endpoints-test-' + Math.random().toString(36).slice(2))
  for (const it of items) s.upsert(it.sessionId, it)
  return s
}

test('monthSummary：只汇总该月日期，跨月分钟不串月', () => {
  const store = storeWith([
    { sessionId: 'a', days: { '2026-08-31': { activityMs: 60_000, msgs: 1 }, '2026-09-01': { activityMs: 120_000, msgs: 2 } } },
    { sessionId: 'b', days: { '2026-10-01': { activityMs: 999, msgs: 9 } } },
  ])
  const r = monthSummary(store, 2026, 9, 480)
  assert.deepEqual(Object.keys(r.days), ['2026-09-01'])
  assert.equal(r.days['2026-09-01'].sessions, 1)
  assert.equal(r.days['2026-09-01'].minutesMs, 120_000)
  assert.equal(r.days['2026-09-01'].msgs, 2)
})

test('monthSummary：同日多条会话量按会话去重、分钟/消息累加', () => {
  const store = storeWith([
    { sessionId: 'a', days: { '2026-09-03': { activityMs: 100_000, msgs: 5 } } },
    { sessionId: 'b', days: { '2026-09-03': { activityMs: 200_000, msgs: 7 } } },
    { sessionId: 'a', days: { '2026-09-03': { activityMs: 100_000, msgs: 5 } } }, // 覆盖
  ])
  const r = monthSummary(store, 2026, 9, 480)
  const d = r.days['2026-09-03']
  assert.equal(d.sessions, 2)
  assert.equal(d.minutesMs, 300_000)
  assert.equal(d.msgs, 12)
})

test('monthSummary：空月返回空 days', () => {
  const store = storeWith([{ sessionId: 'x', days: { '2025-01-01': { activityMs: 1, msgs: 1 } } }])
  const r = monthSummary(store, 2026, 9, 480)
  assert.deepEqual(r.days, {})
})

test('runEndpoint：day/range/report/status 输出与勾选 includeIds', async () => {
  const { runEndpoint } = await import('../src/endpoints.js')
  const a = Date.UTC(2026, 8, 3, 15, 50)
  const b = Date.UTC(2026, 8, 3, 16, 20)
  const item = {
    sessionId: 'sx', cwd: '/w', title: '跨天条目', firstActivityMs: a, lastActivityMs: b,
    durationMs: b - a, endDay: '2026-09-04', spanDayCount: 2,
    days: { '2026-09-03': { activityMs: 0, msgs: 1 }, '2026-09-04': { activityMs: b - a, msgs: 2 } },
    summary: { text: '摘要', tags: ['t1'], stale: false },
  }
  const store = createStore('/tmp/dsh-worklog-endpoints-test2')
  store.upsert('sx', item)
  const cfg = { timezoneOffsetMinutes: 480 }

  const day = await runEndpoint('day', { date: '2026-09-03' }, { store, cfg })
  assert.equal(day.ok, true)
  assert.equal(day.value.items.length, 1)
  assert.equal(day.value.items[0].title, '跨天条目')
  assert.equal(day.value.items[0].summary.tags[0], 't1')

  const range = await runEndpoint('range', { from: '2026-09-01', to: '2026-09-30' }, { store, cfg })
  assert.equal(range.ok, true)
  assert.equal(range.value.items.length, 1)

  const rpt = await runEndpoint('report', { from: '2026-09-03', to: '2026-09-04', kind: 'custom' }, { store, cfg })
  assert.equal(rpt.ok, true)
  assert.ok(rpt.value.markdown.includes('跨天'))

  const rptSel = await runEndpoint('report', { from: '2026-01-01', to: '2026-12-31', includeIds: ['sx'] }, { store, cfg })
  assert.equal(rptSel.value.items.length, 1)
  const rptNone = await runEndpoint('report', { from: '2026-01-01', to: '2026-12-31', includeIds: ['zz'] }, { store, cfg })
  assert.equal(rptNone.value.items.length, 0)

  const st = await runEndpoint('status', {}, { store, cfg })
  assert.equal(st.ok, true)
  assert.equal(st.value.sessions, 1)

  const bad = await runEndpoint('range', { from: 'nope', to: '2026-01-02' }, { store, cfg })
  assert.equal(bad.ok, false)
  assert.equal(bad.error.code, 'bad-request')

  const unknown = await runEndpoint('nope', {}, { store, cfg })
  assert.equal(unknown.ok, false)
})
