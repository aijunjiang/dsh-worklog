/**
 * 模型可见工具：worklog_status / worklog_day / worklog_range / worklog_report / worklog_rescan。
 * 全部只读（rescan 触发一次扫描与补摘要）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { fmtDuration, todayKey, cmpDay } from './times.js'
import { selectItems, buildRangeMarkdown, buildReportMarkdown } from './report.js'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const TEXT_OUTPUT = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

function normDate(v, fallback) {
  if (typeof v === 'string' && DAY_RE.test(v)) return v
  return fallback
}

/** 从一个日期向上/下取整到最近边界。 */
function inferKind(fromDay, toDay) {
  const span = Math.abs(cmpDay(fromDay, toDay)) + 1
  if (span <= 1) return 'daily'
  if (span <= 7) return 'weekly'
  if (span <= 31) return 'monthly'
  return 'halfyear'
}

export function registerWorklogTools(ctx, deps) {
  const { store, cfg, scanNow } = deps
  const offset = () => cfg.timezoneOffsetMinutes
  const disposes = []

  const make = (tool) => {
    const t = defineTool(tool)
    const dispose = ctx.tools.register(t)
    if (typeof dispose === 'function') disposes.push(dispose)
    return t
  }

  make({
    name: 'worklog_status',
    description: '查看 dsh-worklog 状态：存储位置、记录条数、最近扫描时间、待补摘要数量。',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async () => {
      const items = store.all()
      const pending = items.filter((i) => (i.lastActivityMs || 0) > (i.lastSummarizedThroughMs || 0)).length
      const meta = store.getMeta()
      const totalMs = items.reduce((s, i) => s + (i.durationMs || 0), 0)
      return [
        '## dsh-worklog 状态',
        `- 存储：\`${store.file}\``,
        `- 会话记录：${items.length} 条 · 总跨度 ${fmtDuration(totalMs)}`,
        `- 上次扫描：${new Date(meta.lastScanMs || 0).toISOString()} · 上次补摘要：${new Date(meta.lastSummaryMs || 0).toISOString()}`,
        `- 待补摘要：${pending} 条（含 stale）`,
        '',
        '用法：worklog_day(日期) 看某天；worklog_range(起,止) 拉条目；worklog_report(起,止[,kind][,includeIds]) 生成报告；worklog_rescan 强制重扫。',
      ].join('\n')
    },
  })

  make({
    name: 'worklog_day',
    description: '查看某一天（YYYY-MM-DD，缺省今天）的 DSH 工作汇总：该日有活动的会话、各条摘要与当日时长。',
    parameters: {
      date: { type: 'string', description: '本地日 YYYY-MM-DD；缺省今天。' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args) => {
      const day = normDate(args && args.date, todayKey(offset()))
      const items = selectItems(store, day, day, null)
      if (!items.length) return `（${day} 没有工作记录）`
      return buildRangeMarkdown(items, day, day, offset())
    },
  })

  make({
    name: 'worklog_range',
    description: '拉取 [from,to]（YYYY-MM-DD）时间段内与所选日有活动重叠的全部工作条目，供核对与后续勾选生成报告。',
    parameters: {
      from: { type: 'string', required: true, description: '起始日 YYYY-MM-DD（含）' },
      to: { type: 'string', required: true, description: '结束日 YYYY-MM-DD（含）' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args) => {
      const from = normDate(args && args.from, todayKey(offset()))
      const to = normDate(args && args.to, from)
      if (cmpDay(from, to) > 0) return 'from 不能晚于 to'
      const items = selectItems(store, from, to, null)
      return buildRangeMarkdown(items, from, to, offset())
    },
  })

  make({
    name: 'worklog_report',
    description: '生成日报/周报/月报/半年总结：按 [from,to] 时间范围（缺省自动按宽度推断类型），或用 includeIds 明确勾选条目（值为会话 sessionId 数组，来自 worklog_range/status）。',
    parameters: {
      from: { type: 'string', required: true, description: '起始日 YYYY-MM-DD（含）' },
      to: { type: 'string', required: true, description: '结束日 YYYY-MM-DD（含）' },
      kind: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'halfyear', 'custom'], description: '报告类型；缺省按区间宽度推断。' },
      includeIds: { type: 'array', items: { type: 'string' }, description: '可选：明确勾选的会话 sessionId 列表；提供时忽略 from/to 过滤但仍用于标题。' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args) => {
      const from = normDate(args && args.from, todayKey(offset()))
      const to = normDate(args && args.to, from)
      if (cmpDay(from, to) > 0) return 'from 不能晚于 to'
      const kind = (args && args.kind) || inferKind(from, to)
      const includeIds = Array.isArray(args && args.includeIds) ? args.includeIds : null
      const items = selectItems(store, from, to, includeIds)
      return buildReportMarkdown(items, from, to, kind, offset())
    },
  })

  make({
    name: 'worklog_rescan',
    description: '立即重扫会话语料：刷新所有会话度量，并对已静默/新结束的会话补 LLM 工作摘要。通常无需手动调用。',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async () => {
      const r = await scanNow()
      return `重扫完成：语料 ${r.total} 个会话，收录 ${r.kept} 条记录，变更 ${r.changed}，本次补摘要 ${r.summarized}。`
    },
  })

  return () => {
    for (const d of disposes) {
      try { d() } catch { /* noop */ }
    }
  }
}
