/**
 * /dsh-worklog JSON-RPC 通道端点（GUI 用）。
 * 返回 wire 形状：{ ok:true, value } | { ok:false, error:{ code, message } }
 * 数据全部来自 store（items.json），复用 report/ingest 的纯逻辑。
 * runEndpoint 为纯 async（可脱离通道单测）；registerWorklogChannel 负责挂到 ctx.connection。
 */
import { localClock } from './times.js'
import { selectItems, buildReportMarkdown, buildRangeMarkdown } from './report.js'
import { labelForCwd } from './ingest.js'
import { writeFileSync } from 'node:fs'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const pad2 = (n) => (n < 10 ? `0${n}` : String(n))

function ok(value) {
  return { ok: true, value: value === undefined ? null : value }
}

function fail(code, message) {
  return { ok: false, error: { code, message, details: {} } }
}

/** 轻量 item 视图（逐项裁剪，供 GUI 渲染）。 */
function itemView(it, offset) {
  const s = it.summary || null
  const nodes = (it.nodes || []).filter((n) => n && n.summary && n.summary.text).map((n) => ({
    day: n.day,
    startMs: n.startMs,
    endMs: n.endMs,
    startClock: localClock(n.startMs, offset),
    endClock: localClock(n.endMs, offset),
    summary: { text: n.summary.text, tags: n.summary.tags || [] },
  }))
  return {
    sessionId: it.sessionId,
    cwd: it.cwd || '',
    cwdLabel: it.cwdLabel || labelForCwd(it.cwd),
    title: it.title || '',
    live: !!it.live,
    startClock: it.firstActivityMs ? localClock(it.firstActivityMs, offset) : '',
    endClock: it.lastActivityClock || localClock(it.lastActivityMs, offset),
    startIso: new Date(it.firstActivityMs).toISOString(),
    endIso: new Date(it.lastActivityMs).toISOString(),
    durationMs: it.durationMs,
    spanDayCount: it.spanDayCount || 0,
    endDay: it.endDay,
    activityDays: it.days ? Object.keys(it.days).sort() : [],
    summary: s && s.text ? { text: s.text, tags: s.tags || [] } : null,
    nodes,
  }
}

/** 某月每一天的会话量/分钟汇总（纯函数，可单测）。 */
export function monthSummary(store, year, month, offsetMinutes) {
  const prefix = `${year}-${pad2(month)}`
  const days = {}
  for (const it of store.all()) {
    if (!it.days) continue
    for (const d of Object.keys(it.days)) {
      if (!d.startsWith(prefix)) continue
      const b = days[d] || (days[d] = { sessions: 0, minutesMs: 0, msgs: 0, itemKeys: new Set() })
      b.minutesMs += it.days[d].activityMs || 0
      b.msgs += it.days[d].msgs || 0
      b.itemKeys.add(it.sessionId)
    }
  }
  const out = {}
  for (const d of Object.keys(days)) {
    const b = days[d]
    out[d] = { sessions: b.itemKeys.size, minutesMs: b.minutesMs, msgs: b.msgs }
  }
  return { year, month, offsetMinutes, days: out }
}

/**
 * 处理一个端点。deps = { store, cfg, scanNow? }
 * @returns {Promise<{ok:true,value:any}|{ok:false,error:{code,message}}>}
 */
export async function runEndpoint(endpoint, payload, deps) {
  const { store, cfg } = deps
  const offset = () => cfg.timezoneOffsetMinutes
  const p = payload && typeof payload === 'object' ? payload : {}
  switch (endpoint) {
    case 'models.list': {
      if (!deps.listModels) return ok([])
      return ok(await deps.listModels())
    }
    case 'settings.get': {
      const get = deps.getSettings
      return ok(get ? get() : {})
    }
    case 'settings.set': {
      if (!deps.saveSettings) return fail('unsupported', 'settings.set unavailable')
      const patch = {}
      if (p && typeof p === 'object') {
        for (const k of ['apiFormat', 'baseUrl', 'apiKey', 'apiKeyEnv', 'modelName', 'context', 'prompt', 'proactive']) {
          if (k in p) patch[k] = p[k]
        }
      }
      try {
        const r = await deps.saveSettings(patch)
        return r && r.ok === false ? r : ok(r)
      } catch (e) {
        return fail('settings-failed', (e && e.message) || String(e))
      }
    }
    case 'status': {
      const items = store.all()
      const totalMs = items.reduce((s, i) => s + (i.durationMs || 0), 0)
      return ok({
        file: store.file,
        sessions: items.length,
        totalMs,
        pendingSummaries: items.filter((i) => {
          const days = Object.keys(i.days || {})
          const done = Object.values(i.dailySummaries || {}).filter((s) => s && s.text).length
          return done < days.length
        }).length,
        meta: store.getMeta(),
      })
    }
    case 'month': {
      const y = Number(p.year)
      const m = Number(p.month)
      if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
        return fail('bad-request', 'month needs year + month(1-12)')
      }
      return ok(monthSummary(store, y, m, offset()))
    }
    case 'day': {
      const date = String(p.date || '')
      if (!DAY_RE.test(date)) return fail('bad-request', 'day needs date YYYY-MM-DD')
      const items = selectItems(store, date, date, null)
      return ok({ date, items: items.map((it) => itemView(it, offset())) })
    }
    case 'range': {
      const from = String(p.from || '')
      const to = String(p.to || '')
      if (!DAY_RE.test(from) || !DAY_RE.test(to)) return fail('bad-request', 'range needs from/to YYYY-MM-DD')
      const items = selectItems(store, from, to, null)
      return ok({ from, to, items: items.map((it) => itemView(it, offset())) })
    }
    case 'report': {
      const from = String(p.from || '')
      const to = String(p.to || '')
      const kind = String(p.kind || '')
      const includeIds = Array.isArray(p.includeIds) ? p.includeIds : null
      if (!DAY_RE.test(from) || !DAY_RE.test(to)) return fail('bad-request', 'report needs from/to YYYY-MM-DD')
      const items = selectItems(store, from, to, includeIds)
      const md = buildReportMarkdown(items, from, to, kind || 'daily', offset())
      const rangeMd = buildRangeMarkdown(items, from, to, offset())
      return ok({ markdown: md, rangeMarkdown: rangeMd, items: items.map((it) => itemView(it, offset())) })
    }
    case 'rescan': {
      if (!deps.scanNow) return fail('unsupported', 'rescan requires a live scanNow')
      try {
        const r = await deps.scanNow()
        return ok(r)
      } catch (e) {
        return fail('scan-failed', (e && e.message) || String(e))
      }
    }
    case 'summarize-now': {
      if (!deps.summarizeNow) return fail('unsupported', 'summarize-now unavailable')
      try {
        const r = await deps.summarizeNow()
        return ok(r)
      } catch (e) {
        return fail('summarize-failed', (e && e.message) || String(e))
      }
    }
    default:
      return fail('bad-request', `unknown endpoint ${JSON.stringify(endpoint)}`)
  }
}

/** 把端点挂到 /dsh-worklog 通道（优先 connection，回退 webServer 原生路由）。 */
export function registerWorklogChannel(ctx, deps) {
  const conn = (ctx.get && ctx.get('connection')) || null
  const webServer = ctx.get && ctx.get('webServer')
  const diag = {
    via: 'registerWorklogChannel',
    ctxConnection: !!conn,
    getConnection: !!(ctx.get && ctx.get('connection')),
    webServer: !!webServer,
    rpc: !!(conn && conn.rpc),
    rpcHandle: !!(conn && conn.rpc && typeof conn.rpc.handle === 'function'),
  }
  try {
    writeFileSync(`${deps.cfg.baseDir}/boot-channel-${Date.now()}.json`, JSON.stringify(diag, null, 2))
  } catch { /* ignore */ }

  // 首选 connection 通道（带信任/鉴权栅栏）
  if (conn && conn.rpc && typeof conn.rpc.handle === 'function') {
    const dispose = conn.rpc.handle('/dsh-worklog', (endpoint, payload) => runEndpoint(endpoint, payload, deps), { authority: 'loopback' })
    deps.store.setMeta({ bootChannel: { ...diag, via: 'connection' } })
    console.log('[dsh-worklog] /dsh-worklog channel ready (connection)')
    return () => { try { dispose() } catch { /* noop */ } }
  }

  // 回退：直接在 webServer 上注册原生前缀路由（等效信封，读路径）
  if (webServer && typeof webServer.register === 'function') {
    const dispose = webServer.register(rawPrefixRoute(deps))
    deps.store.setMeta({ bootChannel: { ...diag, via: 'webserver' } })
    console.log('[dsh-worklog] /dsh-worklog channel ready (webServer fallback)')
    return () => { try { dispose() } catch { /* noop */ } }
  }

  deps.store.setMeta({ bootChannel: { ...diag, via: 'none' } })
  console.log('[dsh-worklog] no connection/webServer — GUI channel not registered (tools remain available)')
  return null
}

/** 原生 HTTP 前缀路由：解析 client-request 信封并回 server-response（等效 connection 通道）。 */
function rawPrefixRoute(deps) {
  const CHANNEL = '/dsh-worklog'
  return {
    kind: 'prefix',
    path: CHANNEL,
    handler(req, res) {
      if (req.method !== 'POST') {
        res.writeHead(404); res.end('not found'); return
      }
      const pathname = String(req.url || '').split('?')[0]
      const endpoint = pathname.startsWith(`${CHANNEL}/`) ? pathname.slice(CHANNEL.length + 1) : ''
      if (!endpoint || endpoint.includes('/')) {
        res.writeHead(404); res.end('not found'); return
      }
      let body = ''
      req.setEncoding('utf8')
      req.on('data', (chunk) => { body += chunk })
      req.on('end', async () => {
        let msg
        try { msg = JSON.parse(body) } catch {
          res.writeHead(400); res.end('invalid json'); return
        }
        if (!msg || msg.type !== 'client-request' || typeof msg.rpcId !== 'string' || msg.method !== endpoint) {
          res.writeHead(400); res.end('invalid request'); return
        }
        try {
          const result = await runEndpoint(endpoint, msg.payload, deps)
          res.setHeader('content-type', 'application/json')
          res.writeHead(200)
          res.end(JSON.stringify({ type: 'server-response', rpcId: msg.rpcId, result }))
        } catch (e) {
          res.writeHead(500); res.end(String((e && e.message) || e))
        }
      })
    },
  }
}
