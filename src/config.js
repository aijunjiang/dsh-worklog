import z from '@deepseek-ai/schemastery'

/** dsh-worklog Loader 配置（与 bundle.gui.patch.yml 的 config 键保持一致）。 */
export const Config = z.object({
  baseDir: z.string().default(''),
  timezoneOffsetMinutes: z.number().min(-840).max(840).default(480),
  scanIntervalMs: z.number().min(10_000).max(86_400_000).default(300_000),
  settleIdleMs: z.number().min(5_000).max(86_400_000).default(180_000),
  autoSummarize: z.boolean().default(true),
  summarizeProvider: z.string().default(''),
  summarizeModel: z.string().default(''),
  maxInputChars: z.number().min(1_000).max(2_000_000).default(60_000),
  maxOutputTokens: z.number().min(1).max(32_000).default(8000),
  includeAgentPresets: z.array(z.string()).default([]),
  excludeCwdPrefixes: z.array(z.string()).default([]),
  includeSubagents: z.boolean().default(false),
  summarizePerRun: z.number().min(1).max(50).default(5),
  minReSummaryMs: z.number().min(0).max(86_400_000).default(600_000),
  llmTimeoutMs: z.number().min(10_000).max(600_000).default(90_000),
})
