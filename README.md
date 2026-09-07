# dsh-worklog — DSH 工作日志日历（Host 核心）

把你在 DSH 里的所有聊天（跨工作区、跨 SSH 路由、含已结束会话）汇总成**工作记录**：
按你的本地日统计每天的会话量与工作时长，会话结束后自动让模型生成一条**内容摘要**并缓存；
之后可据此生成**日报 / 周报 / 月报 / 半年总结**（先 `worklog_range` 拉条目，再 `worklog_report` 勾选/按区间生成）。

> 当前为 Host 核心版本（模型工具形态）。GUI 日历视图（月历 + 勾选 + 一键生成）在下一阶段以
> client bundle 加入本包，Host 数据层与存储格式不变。

## 安装 / 挂载

本包是标准 Cordis 插件，装进 dsh profile（宿主平面，服务跨会话共享）。正式形态与
dsh-remote-ssh/doubao-search 一致：

1. 依赖声明（`~/.dsh/profiles/web/package.json`）：
   - `dependencies["dsh-worklog"] = "file:<本仓库>/dsh-worklog"`
   - `dsh.profile.bundles` 加入 `"dsh-worklog"`（clientModules 在 web 启动时据此收录
     「工作台」client 模块）；
2. 宿主 row 由 profile 的 `cordis.patch.yml` `- insert:` 提供（`id: worklog, name: dsh-worklog`），
   本包 `bundle.gui.patch.yml` 刻意留空以避免 row 重复；
3. 开发期可用 symlink 指向仓库目录代替 pnpm 安装：
   `ln -s <仓库>/dsh-worklog ~/.dsh/profiles/web/node_modules/dsh-worklog`
   （正式交付时在 profile 里执行一次 `pnpm install` 固化为真实依赖即可）。

profile 的 `patchReload: live` 即时重载宿主侧；数据落在 `$DSH_HOME/dsh-worklog/items.json`
（默认 `/Users/<你>/.dsh/dsh-worklog`），可在 patch config 里用 `baseDir` 改。

## 工作记录怎么算（重要语义）

每一条工作记录 = 一个「顶层会话」（子代理会话默认不算，可 `includeSubagents: true` 打开）：

- **活动** = 会话表面（surface）上的 `user/message` 与 `assistant/message`（排除纯簿记事件与
  插件注入的系统提示）。
- **开始/结束** = 首条 / 末条活动消息的时刻（epoch ms）。**时长 = 结束 − 开始**，即你说的
  “根据一次聊天开始-结束时间登记该项工作时长”。
- **天分布**：每条消息落在它所在本地日（`timezoneOffsetMinutes` 默认 +480=Asia/Shanghai）；
  跨日的时间间隔整段计入**后一条消息所在的那一天**——这与“工作按发生结束时间点来”一致。
  跨天会话在两天都能被检索到，并标注 `（跨天）`。
- **归属日 endDay** = 末条活动消息所在日；`spanDayCount > 1` 表示跨天。
- 摘要只在会话**静默超过 `settleIdleMs`（默认 3 分钟）或已结束**后才补，且摘要带
  `basedOnLastActivityMs`，会话后续又有新活动会自动标 `stale` 等待重算——跨天继续的会话不会被重复误总结。

## 模型工具

| 工具 | 作用 |
|---|---|
| `worklog_status` | 存储位置、条数、上次扫描/补摘要时间、待补摘要数 |
| `worklog_day date?` | 某天（缺省今天）的会话 + 各条摘要 + 当日时长 |
| `worklog_range from to` | 时间段内所有工作条目（供勾选/核对） |
| `worklog_report from to [kind] [includeIds]` | 生成日报(daily)/周报(weekly)/月报(monthly)/半年(halfyear)总结 markdown；`includeIds` 为勾选的 sessionId 数组 |
| `worklog_rescan` | 立即重扫 + 补摘要 |

工具只读（rescan 除外），直接注册于宿主平面，任意会话都可用：例如在日历会话里说
“用 worklog_day 看看今天”或“给我本周周报”。

## 配置（cordis.patch.yml config / 见 bundle.gui.patch.yml 注释）

| 键 | 默认 | 含义 |
|---|---|---|
| `baseDir` | `$DSH_HOME/dsh-worklog` | 存储目录 |
| `timezoneOffsetMinutes` | `480` | 本地时区偏移（Asia/Shanghai） |
| `scanIntervalMs` | `300000` | 扫描间隔（5 分钟） |
| `settleIdleMs` | `180000` | 会话静默多久视为结束、可补摘要 |
| `autoSummarize` | `true` | 结束静默后自动 LLM 摘要 |
| `summarizeProvider` / `summarizeModel` | 空 | 摘要模型；留空 = 当前默认模型 |
| `includeAgentPresets` / `excludeCwdPrefixes` | 空 | 只统计某些 preset / 排除某些工作区前缀 |
| `includeSubagents` | `false` | 是否把子代理会话也单独计入 |
| `summarizePerRun` | `5` | 每轮扫描最多补摘要条数 |
| `llmTimeoutMs` | `90000` | 单次摘要超时 |

## 目录

- `src/index.js` — Cordis 插件入口（inject / Config / apply）
- `src/config.js` — Loader 配置 schema
- `src/store.js` — items.json 原子读写（防抖落盘）
- `src/ingest.js` — 语料扫描 → 度量 / 天分布 / 工作记录
- `src/transcript.js` — 从 surface 抽取“真实用户 + 最终助手”文字，供摘要
- `src/llm.js` — `ctx.llm.stream` 调用 + JSON 解析
- `src/summarize.js` — 摘要队列（静默判定、去重、stale 重算）
- `src/report.js` — 范围选择与报告组装
- `src/tools.js` — worklog_* 工具注册
- `src/endpoints.js` — `/dsh-worklog` GUI JSON-RPC 通道端点
- `src/times.js` — 时区/天 key/时长格式化
- `src/client/index.ts` — 「工作台」浏览器视图（月历 + 条目 + 勾选报告）
- `scripts/build-gui-client.mjs` — 用 harness tsdown 管线产出 `lib/client.js`

## 路线图

- [x] Host 采集 + 自动摘要 + 存储
- [x] worklog_* 模型工具（day/range/report/status/rescan）
- [x] GUI client bundle（conversation.view「工作台」页签）已构建并接线，待页面验证
- [ ] GUI 页面级验证与迭代（需刷新浏览器 / 必要时重启 web）
- [ ] 报告润色（勾选集 → LLM 正式成稿）与导出/保存
- [ ] 跨天口径可配置（结束日归属 vs 按天比例分摊）

## GUI 构建与加载

- client 源码在 `src/client/index.ts`（纯 React.createElement，无 JSX/CSS 依赖），产物为 `lib/client.js`。
- 重新构建（在 harness 同机执行）：

  ```sh
  npm run build:client   # 或 node scripts/build-gui-client.mjs（DSH_HARNESS_CHECKOUT 可覆盖 harness 路径）
  ```

- 宿主 `/dsh-worklog` JSON-RPC 通道端点在 `src/endpoints.js`（status/month/day/range/report/rescan）。
- 浏览器验证：**client 模块表在 dsh web 启动时构建**——本次运行中加入的新 client 模块不会在
  “硬刷新”后出现，必须先**重启一次 dsh web**（外层 `restart-dsh-web.sh`），再硬刷新页面，
  在任意会话头部视图切换里就会出现「工作台」页签。重启后 host 工具（worklog_*）与数据照常恢复。
  （仅当本次 dsh web 进程本身是在 dsh-worklog 安装完成后才启动时，硬刷新才足够。）
