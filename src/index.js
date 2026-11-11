/**
 * dsh-worklog — DSH 工作日志日历（Host 核心）。
 *
 * 常驻扫描 ctx.sessionQuery 语料 → 生成/刷新每条会话的工作记录（开始/结束、
 * 时长、按本地日的活动分布、结束日归属）→ 会话静默/结束后自动 LLM 摘要并缓存
 * 到 ${DSH_HOME}/dsh-worklog/items.json → 注册 worklog_* 模型工具供生成
 * 日报/周报/半年总结。
 *
 * 安装：放入 profile node_modules 后，在 profile cordis.patch.yml insert 一行
 * `- id: worklog / name: dsh-worklog`（或把本包加入 bundles 列表）。
 */
import { Config as ConfigSchema } from './config.js'
import { defaultBaseDir, createStore } from './store.js'
import { scanSessions } from './ingest.js'
import { drainSummaries } from './summarize.js'
import { registerWorklogTools } from './tools.js'
import { registerWorklogChannel } from './endpoints.js'
import { defaultSummaryPrompt } from './llm.js'
import { writeFileSync } from 'node:fs'
import z from '@deepseek-ai/schemastery'

/** 设置命名空间（Web「设置 → 插件」卡片按此 key 配对）。 */
// The settings namespace is the Loader ENTRY id from bundle.gui.patch.yml
// (`- id: worklog`), NOT the package name. The two are deliberately different
// and confusing them is silent: describe() simply finds no such namespace and
// the card reads nothing. The Plugins-page slot is keyed by the PACKAGE name,
// so both spellings appear in this plugin — each in its own place.
export const SETTINGS_NS = 'worklog'

/** 设置 schema：独立 LLM 配置（接口格式/baseUrl/apiKey/model/上下文）+ 摘要 prompt + 主动模式。 */
// DSH 0.2.x: no runtime-installed schema any more — these knobs are part of
// the entry's Config now (see config.js), so the form the settings package
// derives IS this plugin's card.

const settingsDefaults = { apiFormat: 'dsh', baseUrl: '', apiKey: '', apiKeyEnv: 'GJSL_API_KEY', modelName: '', context: 0, prompt: '', proactive: true }

function withSettingsDefaults(s) {
  s = s && typeof s === 'object' ? s : {}
  return {
    apiFormat: typeof s.apiFormat === 'string' ? s.apiFormat : 'dsh',
    baseUrl: typeof s.baseUrl === 'string' ? s.baseUrl : '',
    apiKey: typeof s.apiKey === 'string' ? s.apiKey : '',
    apiKeyEnv: typeof s.apiKeyEnv === 'string' && s.apiKeyEnv !== '' ? s.apiKeyEnv : 'GJSL_API_KEY',
    modelName: typeof s.modelName === 'string' ? s.modelName : '',
    context: Number.isInteger(Number(s.context)) ? Number(s.context) : 0,
    prompt: typeof s.prompt === 'string' ? s.prompt : '',
    proactive: s.proactive !== false,
  }
}

/** 启动诊断落盘（写到 store 目录，node:fs 已知可写）。 */
function diagFile(baseDir, extra) {
  try {
    writeFileSync(`${baseDir}/boot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`, JSON.stringify(extra, null, 2))
  } catch { /* ignore */ }
}

/** Cordis Loader 使用的包名。 */
export const name = 'dsh-worklog'

/** 硬依赖服务。 */
export const inject = ['timer', 'tools', 'sessionQuery', 'llm']

/** Loader 配置 schema（含默认值）。 */
export const Config = ConfigSchema

function pickNumber(v, dflt) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : dflt
}

export function apply(ctx, config) {
  const cfg = {
    baseDir: typeof config.baseDir === 'string' && config.baseDir ? config.baseDir : defaultBaseDir(),
    timezoneOffsetMinutes: Number.isFinite(Number(config.timezoneOffsetMinutes))
      ? Number(config.timezoneOffsetMinutes) : 480,
    scanIntervalMs: pickNumber(config.scanIntervalMs, 300_000),
    settleIdleMs: pickNumber(config.settleIdleMs, 180_000),
    autoSummarize: config.autoSummarize !== false,
    summarizeProvider: config.summarizeProvider || '',
    summarizeModel: config.summarizeModel || '',
    maxInputChars: pickNumber(config.maxInputChars, 60_000),
    maxOutputTokens: pickNumber(config.maxOutputTokens, 4000),
    includeAgentPresets: Array.isArray(config.includeAgentPresets) ? config.includeAgentPresets : [],
    excludeCwdPrefixes: Array.isArray(config.excludeCwdPrefixes) ? config.excludeCwdPrefixes : [],
    includeSubagents: !!config.includeSubagents,
    summarizePerRun: pickNumber(config.summarizePerRun, 5),
    minReSummaryMs: pickNumber(config.minReSummaryMs, 600_000),
    llmTimeoutMs: pickNumber(config.llmTimeoutMs, 90_000),
  }

  const store = createStore(cfg.baseDir)
  console.log(`[dsh-worklog] store: ${store.file} · autoSummarize=${cfg.autoSummarize} · scan=${cfg.scanIntervalMs}ms`)

  // 设置（模型/prompt/主动开关）：供 Web 设置卡片 + 摘要管线读取。
  //
  // DSH 0.2.x: ctx.settings.installSection is gone. A plugin's settings are now
  // its Config schema, projected into a form by the settings package and keyed
  // by the Loader entry id — there is nothing to install. `SettingsSchema` and
  // `settingsDefaults` therefore become the source values directly, and the
  // Web card reads/writes them through the same RPC it always used.
  //
  // The card and the summary pipeline both need the LIVE values, so read them
  // back from the settings service (describe() projects every namespace) with
  // the schema defaults as the fallback for a deployment without settings.
  const settingsOf = () => {
    try {
      const service = ctx.get && ctx.get('settings')
      if (service && typeof service.describe === 'function') {
        const found = service.describe().find(entry => String(entry.ns) === SETTINGS_NS)
        if (found && found.value && typeof found.value === 'object') {
          return withSettingsDefaults(found.value)
        }
      }
    } catch { /* 无 settings 服务时用默认值 */ }
    return settingsDefaults
  }
  let currentSettings = () => settingsOf()
  const connAtStart = (ctx.get && ctx.get('connection')) || null
  store.setMeta({
    bootDiag: {
      phase: 'apply-start',
      ctxConnection: !!connAtStart,
      getConnection: !!connAtStart,
      webServer: !!(ctx.get && ctx.get('webServer')),
      t: Date.now(),
    },
  })
  diagFile(cfg.baseDir, {
    phase: 'apply-start',
    ctxConnection: !!connAtStart,
    getConnection: !!connAtStart,
    webServer: !!(ctx.get && ctx.get('webServer')),
  })

  let scanning = false
  let lastResult = null

  /** 一次完整扫描 + 补摘要（串行防重入）。 */
  async function scanNow() {
    if (scanning) return lastResult || { total: 0, kept: 0, changed: 0, summarized: 0 }
    scanning = true
    try {
      const r = await scanSessions({
        sessionQuery: ctx.sessionQuery,
        cfg,
        store,
        readTitle: true,
        logger: console,
      })
      let summarized = 0
      if (cfg.autoSummarize && r.pendingSummaries > 0) {
        summarized = await drainSummaries({
          ctx,
          sq: ctx.sessionQuery,
          cfg,
          store,
          settings: () => currentSettings(),
          limit: cfg.summarizePerRun,
          logger: console,
        })
      }
      lastResult = { total: r.total, kept: r.kept, changed: r.changed, summarized }
      return lastResult
    } finally {
      scanning = false
    }
  }

  /** 强制按节点重摘要（不限主动/被动，cap 可调），供工作台“生成摘要”按钮。 */
  async function summarizeNow(limit) {
    await scanSessions({ sessionQuery: ctx.sessionQuery, cfg, store, readTitle: true, logger: console })
    const st = { ...currentSettings(), proactive: true }
    const n = await drainSummaries({
      ctx,
      sq: ctx.sessionQuery,
      cfg,
      store,
      settings: () => st,
      limit: limit || 200,
      logger: console,
    })
    return { summarized: n }
  }

  // 模型工具（只读为主；rescan 触发一次扫描）
  const disposeTools = registerWorklogTools(ctx, { store, cfg, scanNow })

  // GUI JSON-RPC 通道（/dsh-worklog）
  const channelDeps = {
    store,
    cfg,
    scanNow,
    summarizeNow,
    getSettings: () => ({ ...currentSettings(), defaultPrompt: defaultSummaryPrompt }),
    saveSettings: (patch) => {
      const s = ctx.get('settings')
      if (s && typeof s.update === 'function') {
        return s.update(SETTINGS_NS, patch).then(() => ({ ok: true }))
      }
      return Promise.resolve({ ok: false, error: { code: 'no-settings', message: 'settings service unavailable' } })
    },
    listModels: () => {
      const llm = ctx.get('llm')
      if (!llm || typeof llm.listProviders !== 'function') return Promise.resolve([])
      return Promise.resolve(llm.listProviders()).then((ps) =>
        (ps || []).map((p) => ({ id: String(p.id || p.provider || p.name || ''), name: String(p.name || p.label || p.id || '') }))
      ).catch(() => [])
    },
  }
  let disposeChannel = null
  try {
    disposeChannel = registerWorklogChannel(ctx, channelDeps)
  } catch (e) {
    diagFile(cfg.baseDir, { channelThrew: String((e && e.message) || e) })
  }

  // 周期扫描。timer 服务以 ctx 混入形式提供 interval/timeout。
  const disposers = []
  const trySchedule = () => {
    let ok = false
    if (typeof ctx.interval === 'function') {
      disposers.push(ctx.interval(() => {
        scanNow().catch((e) => console.error(`[dsh-worklog] scan failed: ${(e && e.message) || e}`))
      }, cfg.scanIntervalMs))
      ok = true
    } else {
      const timerSvc = ctx.get && ctx.get('timer')
      if (timerSvc && typeof timerSvc.interval === 'function') {
        disposers.push(timerSvc.interval(() => {
          scanNow().catch((e) => console.error(`[dsh-worklog] scan failed: ${(e && e.message) || e}`))
        }, cfg.scanIntervalMs))
        ok = true
      }
    }
    if (typeof ctx.timeout === 'function') {
      disposers.push(ctx.timeout(() => scanNow().catch((e) => console.error(`[dsh-worklog] initial scan failed: ${(e && e.message) || e}`)), 5_000))
    } else if (ok) {
      // interval 已排程，首轮由 interval 承担
    }
    return ok
  }
  const scheduled = trySchedule()

  // 生命周期清理
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      disposeTools()
      if (typeof disposeChannel === 'function') disposeChannel()
      for (const d of disposers) {
        try { d() } catch { /* noop */ }
      }
    })
  }

  // 提供一个小服务表面，供后续 GUI/远程 RPC 复用
  const api = {
    store,
    cfg,
    scanNow,
    selectForDay: undefined, // 由 report 层使用
  }
  if (typeof ctx.provide === 'function') {
    try {
      ctx.provide('worklog', api)
    } catch { /* 已存在同名服务则忽略 */ }
  }
  console.log(`[dsh-worklog] ready (interval scheduled: ${scheduled})`)
}
