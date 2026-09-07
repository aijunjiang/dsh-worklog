# dsh-worklog · DSH 工作日志日历

> **[English](./README.en.md) · 中文**

把你在 DSH 里的所有聊天（跨工作区、跨 SSH 路由、含已结束会话）自动整理成**工作日志**：

- 按**对话节点**切片——每一轮「用户发消息 → 模型完成」是一个节点，逐节点生成摘要；
- 日历视图按天统计会话量与时长，点选日期/区间即可查看、勾选并生成**日报 / 周报 / 月报 / 半年总结**；
- 摘要走**指纹缓存 + 增量重算**：节点内容没变就复用，会话有新活动只补新增节点，不重复烧 token；
- 会话在报告里仍作为**一个整体项目**聚合（跨天也不散）。

## 特性

- **全量汇总**：`ctx.sessionQuery` 读取本机与 SSH 路由上所有会话（含已结束）。
- **对话节点级摘要**：颗粒度精细到每一轮对话，按本地日期归属。
- **主动 / 手动摘要**：主动模式即时补摘要；工作台提供「生成摘要（节点切片）」按钮，按需强制重算。
- **独立 LLM 配置**：支持 `DSH 内置`、`OpenAI 兼容`、`Anthropic` 三种接口，可配 baseUrl / apiKey / model / 上下文，摘要 prompt 可自定义。
- **报表**：日历选区间 → 勾选条目（支持全选/全不选）→ 生成 markdown 报告，可复制。
- **模型工具**：`worklog_status / day / range / report / rescan`，任意会话可用。

## 安装（官方方式）

前置：DSH（deepseek-harness）+ Node ≥ 22。

```bash
dsh plugin --profile web add github:aijunjiang/dsh-worklog
# 或本地路径：dsh plugin --profile web add <本仓库路径>

pnpm dsh web   # 重启一次即可，无需其它参数
```

> 安装后重启一次 dsh web：宿主插件（扫描/摘要/工具）与「工作台」client 模块都会在启动时自动注册。
> 卸载：`dsh plugin --profile web remove dsh-worklog`。

## 使用

1. **工作台**：任意会话头部视图切换里点「工作台」页签 → 月历显示每天会话量/分钟。
2. **看某天**：点一个日期看当天条目（默认收起，点「展开 N 个节点」看该日节点级摘要）；点两个日期选区间。
3. **生成报告**：选好区间 → 「全选/全不选」或逐条勾选 → 选报告类型（日报/周报/月报/半年）→ 「生成报告」。
4. **补摘要**：选日期后点「生成摘要（节点切片）」按需重算。
5. **设置**：设置 → 插件 → 插件配置 →「工作日志」，配置摘要模型与 prompt、主动模式。

## 配置

### 摘要设置（设置 → 插件 → 工作日志）

| 项 | 默认 | 说明 |
|---|---|---|
| 模型接口格式 | `dsh` | `dsh`（内置默认模型）/ `openai`（OpenAI 兼容）/ `anthropic` |
| Base URL | — | 外部接口地址（openai/anthropic 时） |
| API Key | — | 留空则回退环境变量/凭据库 `GJSL_API_KEY` |
| Model Name | — | 外部模型名 |
| 上下文窗口 | 0 | 输入上下文窗口 tokens（不影响输出上限） |
| 摘要 Prompt | 内置 | 可自定义，界面展示默认结构 |
| 主动模式 | 开 | 每个有新活动的日期即时补摘要 |

### 行级配置（profile `cordis.patch.yml` / bundle patch）

见 `bundle.gui.patch.yml`：时区偏移、扫描间隔、静默阈值、输出上限、摘要并发等。

## 数据与缓存

- 数据目录：`$DSH_HOME/dsh-worklog/items.json`（默认 `~/.dsh/dsh-worklog`）。
- 每个会话存 `nodes[]`：节点摘要带内容**指纹**；指纹不变则复用，变了才重算 → 增量、省 token。

## 目录

```
src/index.js       宿主插件入口（扫描/摘要/工具/通道）
src/summarize.js   节点级摘要队列（指纹缓存 + 增量）
src/transcript.js  对话节点切片 + 指纹哈希
src/llm.js         摘要 LLM 调用（DSH/openai/anthropic）
src/report.js      报表组装（按日期筛选节点）
src/endpoints.js   /dsh-worklog GUI JSON-RPC 端点
src/client/index.ts 浏览器端：工作台 + 设置卡片
lib/client.js      编译产物（随仓库提交，无需本地构建）
tests/             单测（node --test）
```

## 开发

```bash
npm test            # 单测
npm run build:client  # 用 harness tsdown 管线重建 lib/client.js
```

## 卸载

```bash
dsh plugin --profile web remove dsh-worklog
```

## License

MIT
