/**
 * dsh-worklog 浏览器端：conversation.view 新增「工作台」页签。
 * 月历（会话量/分钟）→ 点选日期/区间 → 拉条目（勾选）→ 生成日报/周报/半年总结 markdown。
 * 与宿主通过 /dsh-worklog JSON-RPC 通道通信（client→host，仅 JSON）。
 * 纯 React.createElement，无 JSX / CSS 模块依赖。
 */
import * as React from 'react'

export const inject = ['slots']

const DAY_MS = 86_400_000
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
const KINDS = [
  { value: 'daily', label: '日报' },
  { value: 'weekly', label: '周报' },
  { value: 'monthly', label: '月报' },
  { value: 'halfyear', label: '半年总结' },
  { value: 'custom', label: '自定义' },
]
const DEFAULT_OFF = 480 // Asia/Shanghai；随后以宿主 month 响应中的 offsetMinutes 覆盖

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n) }

function localParts(ms: number, off: number): { y: number; m: number; d: number } {
  const dt = new Date(ms + off * 60_000)
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }
}

function dayKey(y: number, m: number, d: number): string { return `${y}-${pad2(m)}-${pad2(d)}` }
function todayLocal(off: number): string {
  const { y, m, d } = localParts(Date.now(), off)
  return dayKey(y, m, d)
}
function firstDow(y: number, m: number): number {
  // 某天的星期与时区无关：直接取该日历日期的星期
  return new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
}
function fmtMin(ms: number): string {
  if (!ms) return ''
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h${pad2(m % 60)}m`
}

type WireResult = { ok: true; value: any } | { ok: false; error: { code: string; message: string } }
type Rpc = (endpoint: string, payload?: object) => Promise<any>

interface ItemView {
  sessionId: string
  title: string
  cwdLabel: string
  startClock: string
  endClock: string
  durationMs: number
  spanDayCount: number
  endDay: string
  activityDays: string[]
  summary: { text: string; tags: string[] } | null
  nodes: Array<{ day: string; startClock: string; endClock: string; summary: { text: string; tags: string[] } }>
}

// ---------------------------------------------------------------------------

function makeRpc(ctx: any): Rpc {
  return async (endpoint: string, payload?: object) => {
    const connection = ctx.get('connection')
    if (!connection || !connection.rpc) throw new Error('无网络通道（connection）')
    const res: WireResult = await connection.rpc.call('/dsh-worklog', endpoint, payload ?? {})
    if (!res.ok) throw new Error(res.error?.message || res.error?.code || 'rpc failed')
    return res.value
  }
}

export function apply(ctx: any): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register(
    {
      name: 'conversation.view',
      id: 'worklog',
      order: 20,
      label: '工作台',
      inject: () => ({ rpc: makeRpc(ctx) }),
    },
    WorklogRoot,
  ))
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
    {
      name: 'settings.plugin.item',
      key: 'dsh-worklog',
      inject: () => ({ rpc: makeRpc(ctx) }),
    },
    WorklogSettingsCard,
  ))
}

class WorklogBoundary extends React.Component<any, { err: string | null }> {
  constructor(props: any) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(e: any) {
    return { err: e && e.message ? e.message : String(e) }
  }
  componentDidCatch(e: any) { console.error('[dsh-worklog] render error', e) }
  render() {
    if (this.state.err) {
      return React.createElement('div', { style: { padding: 16, color: '#ff6b6b', fontSize: 13 } },
        '工作台渲染出错：', this.state.err)
    }
    return this.props.children
  }
}

function WorklogRoot(props: any): React.ReactElement {
  return React.createElement(WorklogBoundary, null, React.createElement(WorklogView, props))
}

// ---------------------------------------------------------------------------

const cellBase: React.CSSProperties = {
  minHeight: 64, border: '1px solid rgba(127,127,127,.18)', borderRadius: 6,
  padding: 4, display: 'flex', flexDirection: 'column', gap: 2, cursor: 'pointer',
  background: 'transparent', color: 'inherit', textAlign: 'left', font: 'inherit',
}

function WorklogView(props: any): React.ReactElement {
  const rpc: Rpc = props.rpc
  const boot = localParts(Date.now(), DEFAULT_OFF)
  const [off, setOff] = React.useState(DEFAULT_OFF)
  const [ym, setYm] = React.useState({ y: boot.y, m: boot.m })
  const [days, setDays] = React.useState<Record<string, { sessions: number; minutesMs: number; msgs: number }>>({})
  const [sel, setSel] = React.useState<{ from?: string; to?: string }>({})
  const [items, setItems] = React.useState<ItemView[]>([])
  const [checked, setChecked] = React.useState<Set<string>>(new Set())
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
  const [kind, setKind] = React.useState('daily')
  const [report, setReport] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const loadMonth = React.useCallback(async (y: number, m: number) => {
    setError(null)
    setBusy(true)
    try {
      const r = await rpc('month', { year: y, month: m })
      if (typeof r.offsetMinutes === 'number') setOff(r.offsetMinutes)
      setDays(r.days || {})
    } catch (e) {
      setError(String((e as Error)?.message || e))
    } finally {
      setBusy(false)
    }
  }, [rpc])

  React.useEffect(() => { void loadMonth(ym.y, ym.m) }, [ym, loadMonth])

  const fetchItems = React.useCallback(async (from: string, to: string) => {
    setError(null)
    setBusy(true)
    try {
      const r = await rpc('range', { from, to })
      setItems(r.items || [])
    } catch (e) {
      setError(String((e as Error)?.message || e))
    } finally {
      setBusy(false)
    }
  }, [rpc])

  const pick = (date: string) => {
    setReport(null)
    setSel((s) => {
      if (!s.from) return { from: date }
      if (!s.to) {
        const ns = { from: s.from, to: date }
        if (ns.from <= ns.to) void fetchItems(ns.from, ns.to)
        else return {} // 从早于起点则重置
        return ns
      }
      return { from: date }
    })
  }

  const toggle = (id: string) => {
    setChecked((c) => {
      const n = new Set(c)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const selectAll = () => {
    const ids = items.map((it) => it.sessionId)
    setChecked((c) => {
      const all = ids.every((id) => c.has(id))
      return all ? new Set<string>() : new Set(ids)
    })
  }

  const toggleExpand = (id: string) => {
    setExpanded((c) => {
      const n = new Set(c)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const genReport = async () => {
    if (!sel.from) return
    const to = sel.to || sel.from
    setBusy(true)
    setError(null)
    try {
      const includeIds = checked.size ? [...checked] : null
      const r = await rpc('report', { from: sel.from, to, kind, includeIds })
      setReport(r.markdown)
    } catch (e) {
      setError(String((e as Error)?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const rescan = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await rpc('rescan')
      setReport(`重扫完成：收录 ${r.kept} 条，补摘要 ${r.summarized} 条。\n\n${report || ''}`)
      await loadMonth(ym.y, ym.m)
      if (sel.from) await fetchItems(sel.from, sel.to || sel.from)
    } catch (e) {
      setError(String((e as Error)?.message || e))
    } finally {
      setBusy(false)
    }
  }

  const summarizeNow = async () => {
    if (!sel.from) return
    setBusy(true)
    setError(null)
    try {
      const r = await rpc('summarize-now')
      setReport(`已按节点切片生成摘要 ${r.summarized} 条。\n\n${report || ''}`)
      await loadMonth(ym.y, ym.m)
      await fetchItems(sel.from, sel.to || sel.from)
    } catch (e) {
      setError(String((e as Error)?.message || e))
    } finally {
      setBusy(false)
    }
  }

  // ---- month grid ----
  const dow = firstDow(ym.y, ym.m)
  const lead = (dow + 6) % 7 // 周一为 0
  const daysInMonth = new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate()
  const cells: Array<{ key: string; d: number; inMonth: boolean }> = []
  for (let i = 0; i < 42; i++) {
    const dayNum = i - lead + 1
    cells.push({ key: String(i), d: dayNum, inMonth: dayNum >= 1 && dayNum <= daysInMonth })
  }
  const today = todayLocal(off)

  const header: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap',
  }
  const grid: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4,
  }
  const weekCell: React.CSSProperties = {
    textAlign: 'center', fontSize: 12, opacity: .7, padding: 2,
  }
  const rangeSel: React.CSSProperties = {
    fontSize: 13, opacity: .9, margin: '4px 0 8px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
  }
  const badgeRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
  const badge: React.CSSProperties = { fontSize: 11, fontWeight: 700, opacity: .85 }
  const minLabel: React.CSSProperties = { fontSize: 10, opacity: .6 }
  const btn: React.CSSProperties = {
    border: '1px solid rgba(127,127,127,.35)', borderRadius: 6, padding: '2px 8px',
    background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13,
  }
  const btnPrimary: React.CSSProperties = { ...btn, borderColor: 'rgba(80,140,255,.8)', color: '#5a9cff' }
  const row: React.CSSProperties = {
    display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 4px',
    borderBottom: '1px solid rgba(127,127,127,.15)',
  }
  const title = `${ym.y} 年 ${ym.m} 月`

  return React.createElement('div', { style: { padding: 12, overflow: 'auto', height: '100%' } },
    React.createElement('div', { style: header },
      React.createElement('button', { style: btn, onClick: () => setYm((s) => ({ y: s.m === 1 ? s.y - 1 : s.y, m: s.m === 1 ? 12 : s.m - 1 })) }, '‹'),
      React.createElement('button', { style: btn, onClick: () => setYm((s) => ({ y: s.m === 12 ? s.y + 1 : s.y, m: s.m === 12 ? 1 : s.m + 1 })) }, '›'),
      React.createElement('span', { style: { fontWeight: 700 } }, title),
      React.createElement('button', { style: btn, onClick: () => { const t = localParts(Date.now(), off); setYm({ y: t.y, m: t.m }) } }, '今天'),
      React.createElement('button', { style: btn, onClick: () => void rescan(), disabled: busy }, '刷新'),
      busy && React.createElement('span', { style: { opacity: .6, fontSize: 12 } }, '加载中…'),
      error && React.createElement('span', { style: { color: '#f66', fontSize: 12 } }, error),
    ),
    React.createElement('div', { style: rangeSel },
      React.createElement('span', null, sel.from ? `已选：${sel.from}${sel.to ? ` ~ ${sel.to}` : '（再点一天结束区间）'}` : '点击日期查看当天，或选起止两天做区间'),
      React.createElement('button', { style: btn, onClick: () => { setSel({}); setItems([]); setReport(null) } }, '清空'),
    ),
    React.createElement('div', { style: grid },
      WEEK_LABELS.map((w) => React.createElement('div', { key: w, style: weekCell }, w)),
      cells.map((c) => {
        if (!c.inMonth) return React.createElement('div', { key: c.key, style: { minHeight: 64 } })
        const date = dayKey(ym.y, ym.m, c.d)
        const info = days[date]
        const active = sel.from === date || sel.to === date
        const inRange = sel.from && sel.to && date >= sel.from && date <= sel.to
        const isToday = date === today
        const style: React.CSSProperties = {
          ...cellBase,
          borderColor: isToday ? 'rgba(90,156,255,.9)' : active ? 'rgba(90,156,255,.65)' : undefined,
          background: inRange ? 'rgba(90,156,255,.12)' : info ? 'rgba(90,200,120,.10)' : 'transparent',
        }
        return React.createElement('button', { key: c.key, style, onClick: () => pick(date) },
          React.createElement('div', { style: badgeRow },
            React.createElement('span', null, c.d),
            info && React.createElement('span', { style: badge }, `${info.sessions} 会话`),
          ),
          info && React.createElement('span', { style: minLabel }, fmtMin(info.minutesMs)),
        )
      }),
    ),
    React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0' } },
      React.createElement('span', { style: { fontSize: 13, opacity: .8 } }, '生成：'),
      React.createElement('select', { value: kind, onChange: (e: any) => setKind(e.target.value), style: btn },
        KINDS.map((k) => React.createElement('option', { key: k.value, value: k.value }, k.label)),
      ),
      React.createElement('button', { style: btnPrimary, onClick: () => void genReport(), disabled: !sel.from || busy }, '生成报告'),
      React.createElement('button', { style: btn, onClick: () => void summarizeNow(), disabled: !sel.from || busy }, '生成摘要（节点切片）'),
      items.length > 0 && React.createElement('button', { style: btn, onClick: selectAll }, '全选/全不选'),
      checked.size > 0 && React.createElement('span', { style: { fontSize: 12, opacity: .7 } }, `已勾选 ${checked.size} 条`),
    ),
    items.length === 0
      ? React.createElement('div', { style: { opacity: .55, fontSize: 13, padding: 8 } }, '（该日/区间暂无工作条目；数据由宿主自动扫描会话生成）')
      : React.createElement('div', null,
        items.map((it) => {
          const cross = it.spanDayCount > 1 ? '（跨天）' : ''
          const nodes = (it.nodes || []).filter((n) => n.summary && n.summary.text)
          const isOpen = expanded.has(it.sessionId)
          const tagSet = new Set<string>()
          for (const n of nodes) for (const t of n.summary.tags || []) tagSet.add(t)
          if (!tagSet.size && it.summary) for (const t of it.summary.tags || []) tagSet.add(t)
          const tags = [...tagSet].map((t) => `#${t}`).join(' ')
          return React.createElement('div', { key: it.sessionId, style: row },
            React.createElement('input', {
              type: 'checkbox', checked: checked.has(it.sessionId), onChange: () => toggle(it.sessionId),
            }),
            React.createElement('div', { style: { flex: 1, minWidth: 0 } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                React.createElement('strong', null, it.title || it.sessionId.slice(0, 12)),
                React.createElement('span', { style: { fontSize: 12, opacity: .7 } }, `${it.startClock}–${it.endClock} · ${fmtMin(it.durationMs)} ${cross} · ${it.cwdLabel}`),
                nodes.length > 0 && React.createElement('button', {
                  style: { ...btn, padding: '1px 6px', fontSize: 11, border: 'none', color: 'var(--dsw-alias-label-secondary)' },
                  onClick: () => toggleExpand(it.sessionId),
                }, isOpen ? '收起 ▾' : `展开 ${nodes.length} 个节点 ▸`),
              ),
              isOpen && nodes.length > 0
                ? React.createElement('div', { style: { marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 } },
                  nodes.map((n, i) => React.createElement('div', { key: i, style: { fontSize: 12, opacity: .85 } },
                    React.createElement('span', { style: { opacity: .55, marginRight: 6 } }, `${n.startClock}–${n.endClock}`),
                    n.summary.text,
                  )),
                )
                : (!nodes.length && it.summary && it.summary.text && React.createElement('div', { style: { fontSize: 12, opacity: .85, marginTop: 2 } }, it.summary.text)),
              tags && React.createElement('div', { style: { fontSize: 11, opacity: .6, marginTop: 2 } }, tags),
            ),
          )
        }),
      ),
    report !== null && React.createElement('div', { style: { marginTop: 12 } },
      React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 } },
        React.createElement('strong', null, '报告预览'),
        React.createElement('button', {
          style: btnPrimary,
          onClick: () => { void navigator.clipboard?.writeText(report).catch(() => undefined) },
        }, '复制'),
      ),
      React.createElement('pre', {
        style: {
          whiteSpace: 'pre-wrap', background: 'rgba(127,127,127,.08)', borderRadius: 8,
          padding: 10, fontSize: 13, maxHeight: 420, overflow: 'auto', margin: 0,
        },
      }, report),
    ),
  )
}

// ---------------------------------------------------------------------------
// 设置卡片：对齐 DSH 官方插件卡样式（theme 变量），字段为独立 LLM 配置
// ---------------------------------------------------------------------------

const WL_CSS: Record<string, React.CSSProperties> = {
  card: {
    listStyle: 'none', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '12px',
    background: 'var(--dsw-alias-bg-layer-3)', transition: 'border-color .16s, background .16s',
  },
  cardOpen: { background: 'var(--dsw-alias-bg-layer-2)', borderColor: 'var(--dsw-alias-label-dimmed)' },
  header: {
    width: '100%', appearance: 'none', border: '0', background: 'none', font: 'inherit', color: 'inherit',
    textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px',
    padding: '14px 16px', borderRadius: '12px', outlineOffset: '-2px', boxSizing: 'border-box',
  },
  headText: { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '4px' },
  name: { fontSize: '15px', fontWeight: 600, lineHeight: '1.4', color: 'var(--dsw-alias-label-primary)' },
  description: { fontSize: '13px', lineHeight: '1.5', color: 'var(--dsw-alias-label-tertiary)' },
  pill: { flex: 'none', borderRadius: '999px', padding: '1px 8px', fontSize: '11px', lineHeight: '17px', fontWeight: 500, whiteSpace: 'nowrap', background: 'var(--dsw-alias-bg-module-platform)', color: 'var(--dsw-alias-label-secondary)' },
  pillOk: { color: 'var(--dsw-alias-label-success, #16a34a)' },
  pillEmpty: { color: 'var(--dsw-alias-label-tertiary, #888)' },
  chevron: { flex: 'none', color: 'var(--dsw-alias-label-tertiary)', transition: 'transform .16s' },
  chevronOpen: { transform: 'rotate(180deg)' },
  body: { borderTop: '1px solid var(--dsw-alias-border-l2)', margin: '0 16px', paddingBottom: '8px' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '12px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' },
  fieldHead: { display: 'flex', alignItems: 'center', gap: '8px' },
  label: { minWidth: '0', color: 'var(--dsw-alias-label-primary)', flex: '1', fontSize: '13px', fontWeight: 500, lineHeight: '1.5' },
  input: { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', height: '34px', font: 'inherit', color: 'var(--dsw-alias-label-primary)', borderRadius: '8px', padding: '0 12px', fontSize: '13px', lineHeight: '1.5', boxSizing: 'border-box', width: '100%' },
  hint: { color: 'var(--dsw-alias-label-tertiary)', margin: '0', fontSize: '12px', lineHeight: '1.5' },
  footer: { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0 4px' },
  footerLeft: { flex: '1', minWidth: '0', display: 'flex', gap: '8px', alignItems: 'center' },
  ok: { margin: '0', fontSize: '12px', lineHeight: '1.5', color: 'var(--dsw-alias-label-success, #16a34a)' },
  failed: { margin: '0', fontSize: '12px', lineHeight: '1.5', color: 'var(--dsw-alias-label-error)' },
  btn: { appearance: 'none', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', padding: '5px 14px', font: 'inherit', fontSize: '13px', lineHeight: '1.5', cursor: 'pointer', background: 'none', color: 'var(--dsw-alias-label-secondary)' },
  btnPrimary: { background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-3)', borderColor: 'transparent' },
  btnDisabled: { opacity: '0.4', cursor: 'default' },
  checkRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0' },
}

function wlMerge(a: React.CSSProperties, b: React.CSSProperties | null): React.CSSProperties {
  return Object.assign({}, a, b || undefined)
}

function WorklogSettingsCard(props: any): React.ReactElement {
  const rpc: Rpc = props.rpc
  const [open, setOpen] = React.useState(false)
  const [apiFormat, setApiFormat] = React.useState('dsh')
  const [baseUrl, setBaseUrl] = React.useState('')
  const [apiKey, setApiKey] = React.useState('')
  const [modelName, setModelName] = React.useState('')
  const [context, setContext] = React.useState('')
  const [prompt, setPrompt] = React.useState('')
  const [defaultPrompt, setDefaultPrompt] = React.useState('')
  const [proactive, setProactive] = React.useState(true)
  const [msg, setMsg] = React.useState('')
  const [msgOk, setMsgOk] = React.useState(true)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    let live = true
    void (async () => {
      try {
        const v = await rpc('settings.get')
        if (!live) return
        setApiFormat(v.apiFormat || 'dsh')
        setBaseUrl(v.baseUrl || '')
        setApiKey(v.apiKey || '')
        setModelName(v.modelName || '')
        setContext(v.context ? String(v.context) : '')
        setPrompt(v.prompt || '')
        setDefaultPrompt(typeof v.defaultPrompt === 'string' ? v.defaultPrompt : '')
        setProactive(v.proactive !== false)
      } catch (e) {
        if (live) { setMsg(String((e as Error)?.message || e)); setMsgOk(false) }
      }
    })()
    return () => { live = false }
  }, [rpc])

  const configured = apiFormat === 'dsh' ? true : !!(modelName && baseUrl)

  const pill = (extra: React.CSSProperties, text: string) =>
    React.createElement('span', { style: wlMerge(WL_CSS.pill, extra) }, text)
  const chevron = () =>
    React.createElement('span', { style: wlMerge(WL_CSS.chevron, open ? WL_CSS.chevronOpen : null) }, '▾')

  const field = (label: string, node: any, hint?: string) =>
    React.createElement('div', { style: WL_CSS.field },
      React.createElement('div', { style: WL_CSS.fieldHead },
        React.createElement('span', { style: WL_CSS.label }, label),
      ),
      node,
      hint ? React.createElement('p', { style: WL_CSS.hint }, hint) : null,
    )

  const save = async () => {
    setBusy(true)
    setMsg('')
    try {
      await rpc('settings.set', {
        apiFormat, baseUrl, apiKey, modelName,
        context: context === '' ? 0 : Number(context) || 0,
        prompt, proactive,
      })
      setMsg('已保存'); setMsgOk(true)
    } catch (e) {
      setMsg('保存失败：' + String((e as Error)?.message || e)); setMsgOk(false)
    } finally {
      setBusy(false)
    }
  }

  const rescan = async () => {
    setBusy(true)
    setMsg('')
    try {
      const r = await rpc('summarize-now')
      setMsg(`已按节点切片重摘要 ${r.summarized} 条`); setMsgOk(true)
    } catch (e) {
      setMsg('重摘要失败：' + String((e as Error)?.message || e)); setMsgOk(false)
    } finally {
      setBusy(false)
    }
  }

  const external = apiFormat !== 'dsh'

  return React.createElement('li', { style: wlMerge(WL_CSS.card, open ? WL_CSS.cardOpen : null) },
    React.createElement('button', { style: WL_CSS.header, onClick: () => setOpen((v) => !v), 'aria-expanded': open },
      React.createElement('div', { style: WL_CSS.headText },
        React.createElement('span', { style: WL_CSS.name }, '工作日志'),
        React.createElement('span', { style: WL_CSS.description }, '按对话节点切片、自动生成工作摘要'),
      ),
      pill(configured ? WL_CSS.pillOk : WL_CSS.pillEmpty, configured ? '已配置' : '未配置'),
      chevron(),
    ),
    open && React.createElement('div', { style: WL_CSS.body },
      field('模型接口格式', React.createElement('select', { style: WL_CSS.input, value: apiFormat, onChange: (e: any) => setApiFormat(e.target.value) },
        React.createElement('option', { value: 'dsh' }, 'DSH 内置（默认模型）'),
        React.createElement('option', { value: 'openai' }, 'OpenAI 兼容'),
        React.createElement('option', { value: 'anthropic' }, 'Anthropic'),
      )),
      external && field('Base URL', React.createElement('input', { style: WL_CSS.input, value: baseUrl, placeholder: 'https://api.openai.com/v1', onChange: (e: any) => setBaseUrl(e.target.value) })),
      external && field('API Key', React.createElement('input', { style: WL_CSS.input, type: 'password', value: apiKey, placeholder: 'sk-...（留空则读环境变量 GJSL_API_KEY）', onChange: (e: any) => setApiKey(e.target.value) }), '保存在本机设置，界面不回显；留空则回退环境变量/凭据库 GJSL_API_KEY'),
      external && field('Model Name', React.createElement('input', { style: WL_CSS.input, value: modelName, placeholder: 'gpt-4o-mini / claude-3-5-sonnet', onChange: (e: any) => setModelName(e.target.value) })),
      field('上下文窗口（tokens）', React.createElement('input', { style: WL_CSS.input, value: context, placeholder: '如 985657，0 = 自动', onChange: (e: any) => setContext(e.target.value) }), '输入上下文窗口大小（不影响输出上限）'),
      field('摘要 Prompt', React.createElement('div', null,
        React.createElement('textarea', { style: { ...WL_CSS.input, height: 96, resize: 'vertical', padding: '8px 12px' }, value: prompt, placeholder: defaultPrompt, onChange: (e: any) => setPrompt(e.target.value) }),
        React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 } },
          React.createElement('button', { style: WL_CSS.btn, onClick: () => setPrompt(defaultPrompt) }, '填入默认提示词'),
          React.createElement('span', { style: WL_CSS.hint }, '留空 = 使用内置提示词（见上方灰字）'),
        ),
      )),
      React.createElement('label', { style: WL_CSS.checkRow },
        React.createElement('input', { type: 'checkbox', checked: proactive, onChange: (e: any) => setProactive(e.target.checked) }),
        React.createElement('span', { style: WL_CSS.label }, '主动模式（每个有新活动的日期都即时补摘要）'),
      ),
      React.createElement('div', { style: WL_CSS.footer },
        React.createElement('div', { style: WL_CSS.footerLeft },
          React.createElement('button', { style: wlMerge(WL_CSS.btn, busy ? WL_CSS.btnDisabled : null), onClick: () => void save(), disabled: busy }, '保存'),
          React.createElement('button', { style: wlMerge(WL_CSS.btn, WL_CSS.btnPrimary, busy ? WL_CSS.btnDisabled : null), onClick: () => void rescan(), disabled: busy }, '立即重新总结'),
        ),
        msg && React.createElement('p', { style: msgOk ? WL_CSS.ok : WL_CSS.failed }, msg),
      ),
    ),
  )
}
