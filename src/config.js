import z from '@deepseek-ai/schemastery'

/** dsh-worklog Loader 配置（与 bundle.gui.patch.yml 的 config 键保持一致）。 */
export const Config = z.object({
  baseDir: z.string().default('').volatile(),
  timezoneOffsetMinutes: z.number().min(-840).max(840).default(480).volatile(),
  scanIntervalMs: z.number().min(10_000).max(86_400_000).default(300_000).volatile(),
  settleIdleMs: z.number().min(5_000).max(86_400_000).default(180_000).volatile(),
  autoSummarize: z.boolean().default(true).volatile(),
  summarizeProvider: z.string().default('').volatile(),
  summarizeModel: z.string().default('').volatile(),
  maxInputChars: z.number().min(1_000).max(2_000_000).default(60_000).volatile(),
  maxOutputTokens: z.number().min(1).max(32_000).default(8000).volatile(),
  includeAgentPresets: z.array(z.string()).default([]).volatile(),
  excludeCwdPrefixes: z.array(z.string()).default([]).volatile(),
  includeSubagents: z.boolean().default(false).volatile(),
  summarizePerRun: z.number().min(1).max(50).default(5).volatile(),
  minReSummaryMs: z.number().min(0).max(86_400_000).default(600_000).volatile(),
  llmTimeoutMs: z.number().min(10_000).max(600_000).default(90_000).volatile(),
  // ── 摘要模型设置（原 SettingsSchema）─────────────────────────────────────
  // DSH 0.2.x derives ONE form per Loader entry from that entry's Config, so a
  // second schema installed at runtime is no longer possible. The summary-model
  // knobs therefore live here beside the scan knobs: same namespace, same form,
  // same write path (`settings.update('worklog', patch)`).
  apiFormat: z.string().default('dsh').volatile(),
  baseUrl: z.string().default('').volatile(),
  apiKey: z.string().role('secret').default('').volatile(),
  apiKeyEnv: z.string().default('GJSL_API_KEY').volatile(),
  modelName: z.string().default('').volatile(),
  context: z.number().step(1).min(0).default(0).volatile(),
  prompt: z.string().default('').volatile(),
  proactive: z.boolean().default(true).volatile(),
})
