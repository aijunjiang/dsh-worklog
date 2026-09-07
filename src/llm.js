/**
 * LLM 辅助调用：会话工作摘要。
 * - apiFormat='dsh'：复用 ctx.llm.stream（DSH 内部模型路由）。
 * - apiFormat='openai'/'anthropic'：直接 HTTP 调用用户配置的接口（baseUrl/apiKey/modelName）。
 */
import { createUserMessage, BlockAssembler } from '@deepseek-ai/dsh-llm'

function finishError(finish) {
  if (!finish) return new Error('llm stream ended without finish')
  switch (finish.kind) {
    case 'stop': return undefined
    case 'error':
    case 'aborted': {
      const e = new Error(finish.failure && finish.failure.message || 'llm aborted')
      e.code = finish.failure && finish.failure.code
      return e
    }
    case 'max-tokens': return new Error('llm output reached maxTokens')
    case 'tool-calls': return new Error('llm unexpectedly requested a tool')
    default: return new Error(`unsupported finish ${String(finish.kind)}`)
  }
}

/** DSH 内部模型路由：行配置优先，否则当前默认模型。 */
export function resolveRoute(cfg, ctx) {
  if (cfg.summarizeProvider && cfg.summarizeModel) {
    return { provider: cfg.summarizeProvider, model: cfg.summarizeModel }
  }
  const adm = ctx.get('agentDefaultModel')
  if (adm && typeof adm.currentSelection === 'function') {
    try {
      const sel = adm.currentSelection()
      if (sel && sel.provider && sel.model) return { provider: sel.provider, model: sel.model }
    } catch { /* fallthrough */ }
  }
  return null
}

async function streamText(ctx, route, cfg, system, userText) {
  const messages = [
    createUserMessage({
      content: [{ type: 'text', text: userText }],
      source: { kind: 'plugin', plugin: 'dsh-worklog' },
    }),
  ]
  const timeoutMs = cfg.llmTimeoutMs || 90_000
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(new Error('worklog llm timeout')), timeoutMs) : null
  const options = {
    provider: route.provider,
    model: route.model,
    messages,
    system,
    maxTokens: cfg.maxOutputTokens || 800,
    purpose: 'dsh-worklog',
    ...(controller ? { signal: controller.signal } : {}),
  }
  try {
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)
    const err = finishError(assembler.finish)
    if (err) throw err
    return assembler
      .blocks()
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 调用用户配置的外部模型接口（openai / anthropic 兼容），返回文本。 */
async function callExternal(settings, cfg, system, userText) {
  const base = String(settings.baseUrl || '').replace(/\/+$/, '')
  const apiKey = String(settings.apiKey || '')
  const model = String(settings.modelName || '')
  if (!base || !apiKey || !model) throw new Error('外部模型配置不完整（baseUrl/apiKey/modelName）')
  const timeoutMs = cfg.llmTimeoutMs || 90_000
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(new Error('worklog external timeout')), timeoutMs) : null
  const maxTokens = Math.max(64, Math.min(cfg.maxOutputTokens || 800, settings.context > 0 ? Math.floor(settings.context / 4) : cfg.maxOutputTokens || 800))
  try {
    let url
    let body
    let headers
    if (settings.apiFormat === 'anthropic') {
      url = `${base}/v1/messages`
      body = JSON.stringify({ model, system, messages: [{ role: 'user', content: userText }], max_tokens: maxTokens })
      headers = { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    } else {
      url = `${base}/chat/completions`
      body = JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: userText }], max_tokens: maxTokens })
      headers = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }
    }
    const res = await fetch(url, { method: 'POST', headers, body, ...(controller ? { signal: controller.signal } : {}) })
    if (!res.ok) throw new Error(`外部模型 HTTP ${res.status}`)
    const json = await res.json()
    if (settings.apiFormat === 'anthropic') {
      const block = json && Array.isArray(json.content) ? json.content[0] : null
      return block && typeof block.text === 'string' ? block.text : ''
    }
    return json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
      ? String(json.choices[0].message.content) : ''
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 从文本中安全抽取 JSON 对象（容忍 ```json 围栏与前后说明文字）。 */
function extractJson(text) {
  const s = String(text || '')
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fence ? fence[1] : s
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    return null
  }
}

/** 内置摘要 system prompt（也用于设置卡片展示默认结构）。 */
export const defaultSummaryPrompt = [
  '你是个人工作日志助手。请把下面这段 AI 助手工作会话记录，压缩成一条工作条目。',
  '会话可能包含多轮对话与大量工具调用；请抓住整体主线，而不是罗列每句话。',
  '只输出一个 JSON 对象，不要 Markdown，不要解释：',
  '{"summary":"用中文 2~4 句概括：1) 用户想达成什么目标；2) 过程中做了哪些关键动作（排查/修改/执行命令/读写的文件，尽量保留文件名、命令、报错关键词）；3) 最终结果或结论（成功/失败/待办）。","tags":["2~5个简短标签，如 插件开发、会话检索、SSH、驱动调试"]}',
  '若没有真实用户输入则输出 {"summary":"","tags":[]}。',
].join('\n')

/** 解析最终使用的摘要 system prompt：用户自定义优先，否则内置。 */
export function resolveSummaryPrompt(settings) {
  if (settings && typeof settings.prompt === 'string' && settings.prompt.trim() !== '') {
    return settings.prompt.trim()
  }
  return defaultSummaryPrompt
}

/**
 * 为某段（一个对话节点）文本生成一条工作摘要。
 * @returns {Promise<{ok:true,summary:string,tags:string[],model:any}|{ok:false,reason:string}>}
 */
export async function generateDaySummary(ctx, cfg, settings, transcriptText) {
  if (!transcriptText || transcriptText.length < 20) {
    return { ok: false, reason: 'transcript-empty' }
  }
  const system = resolveSummaryPrompt(settings)
  const framed = JSON.stringify({ transcript: transcriptText })
  const input = framed.length > cfg.maxInputChars
    ? framed.slice(0, cfg.maxInputChars)
    : framed

  let text
  let model
  if (settings && settings.apiFormat && settings.apiFormat !== 'dsh') {
    // apiKey 解析：设置里的明文 → 凭据库/环境变量（默认 GJSL_API_KEY）
    let apiKey = settings.apiKey || ''
    if (!apiKey) {
      const envName = settings.apiKeyEnv || 'GJSL_API_KEY'
      const creds = ctx.get('credentials')
      if (creds && typeof creds.resolve === 'function') {
        try {
          const r = await creds.resolve(envName)
          if (r && r.value) apiKey = r.value
        } catch { /* ignore */ }
      }
      if (!apiKey && typeof process !== 'undefined' && process.env && process.env[envName]) {
        apiKey = process.env[envName]
      }
    }
    text = await callExternal({ ...settings, apiKey }, cfg, system, input)
    model = { provider: settings.apiFormat, model: settings.modelName || '' }
  } else {
    const route = resolveRoute(cfg, ctx)
    if (!route) return { ok: false, reason: 'no-model-route' }
    text = await streamText(ctx, route, cfg, system, input)
    model = route
  }

  const parsed = extractJson(text)
  let summary = ''
  let tags = []
  if (parsed && typeof parsed === 'object') {
    if (typeof parsed.summary === 'string') summary = parsed.summary.trim()
    if (Array.isArray(parsed.tags)) {
      tags = parsed.tags.filter((t) => typeof t === 'string' && t).slice(0, 6)
    }
  }
  if (!summary && text) summary = String(text).trim().slice(0, 400)
  if (!summary) return { ok: false, reason: 'empty-summary-output' }
  return { ok: true, summary, tags, model }
}
