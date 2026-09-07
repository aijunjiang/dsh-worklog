# dsh-worklog — 设计与数据契约（GUI 阶段蓝图）

> 状态：Host 核心已实现并在 profile live（见 README）。本文件定稿数据契约与 GUI 方案，
> 供 client bundle 阶段直接照此实现，避免回头改口径。

## 1. 数据契约（items.json / host API 输出）

每条工作记录（顶层会话，子代理默认排除）：

```ts
type WorkItem = {
  sessionId: string          // 会话 id
  cwd: string                // 工作区绝对路径
  cwdLabel: string           // 展示标签：目录名 或 `ssh:<路径>`
  agentPreset?: string
  createdAtMs: number
  title: string              // 会话标题（可空）
  live: boolean              // 当前是否仍在进程内活跃
  firstActivityMs: number    // 首条活动消息时刻
  lastActivityMs: number     // 末条活动消息时刻
  lastActivityClock: string  // 本地 HH:MM
  durationMs: number         // = last - first（“一次聊天开始-结束时长”）
  userMsgCount: number
  assistantMsgCount: number
  days: Record<string, { activityMs: number; msgs: number }> // 本地日分布
  endDay: string             // 归属日 = 末条活动所在本地日
  spanDayCount: number       // >1 ⇒ 跨天
  summary: {
    text: string; tags: string[]
    model: { provider: string; model: string }
    generatedAtMs: number
    basedOnLastActivityMs: number  // 摘要基于的活动尾部；新活动 → stale
    stale?: boolean
  } | null
  updatedAtMs: number
}
```

**语义（已定稿）**
- 活动 = surface 上的 user/assistant message（排除簿记事件与插件注入提示）。
- 跨天间隔整段计入“后一条消息所在日”（工作按发生结束时间点归属）；
  起始日显示条目并标注 `（跨天）/计时归入结束日`，供检索与勾选。
- 摘要只在会话静默 > settleIdleMs 或已结束且非当天活跃时补；摘要带
  `basedOnLastActivityMs`，有新活动自动 stale → 下轮空闲重算。GUI 无需关心这些。

## 2. GUI 目标交互（与用户确认过的流程）

1. **日历（月视图）**：每天格子显示 会话量 / 总分钟（活动计时），密集度视觉区分；
   点某天 → 侧边/下方列出当天条目（时间、标题、摘要、标签、跨天标记）。
2. **报表流**：点日历选**时间区间**（起、止两天）→ 拉出区间内全部条目列表
   （跨天条目完整展示、可展开看按日分解）→ **勾选**所需条目 → 生成
   日报/周报/月报/半年总结。
3. 每条目也可从某日卡片“+”快速加入勾选集。

## 3. 实现载体与落点（client bundle，静态）

- **Slot**：`conversation.view` 注册 `id: 'worklog'`，label「工作台」。
  Chat / Trajectory 之外新增第三个视图页签，会话级 scope；任意会话可打开全局工作台。
  （已由 Slots inspect 确认：list 型注册 `{ name, id, order, label }`，`ui-conversation`
  在会话头部渲染视图切换。）
- **通道（Client→Host）**：参照 dsh-remote-ssh：host 注册 `/dsh-worklog` RPC 通道端点；
  client 用 `connection.rpc.call('/dsh-worklog', endpoint, payload)`。
- **端点初版（返回 lossless JSON，不做 markdown）**：
  - `month {year, month}` → 每日汇总 `[{day, sessions, minutesMs, itemsCount}]`
  - `day {date}` → 当日条目（复用 selectItems/buildRangeMarkdown 语义，但给结构化数据）
  - `range {from, to}` → 条目列表（含跨天展开 days、可勾选）
  - `report {from, to, kind, includeIds?}` → 结构化报告 + markdown（沿用现有组装器）
  - `rescan` → 触发扫描（透传 scanNow 结果）
- **Client 渲染**：React，theme tokens + 少量自带 CSS（styles.insert）；
  无第三方日历库（自绘月网格，避免依赖与包体膨胀）。
- **构建**：复用 dsh-remote-ssh 的 tsdown host-in-checkout 脚本模式产出
  `lib/client.js`（`window.__ModuleLoader__` 包裹），`dsh.client` 声明 inject 列表
  （需含 `@deepseek-ai/dsh-client-connection` 等）。

## 4. 待定（需用户确认后再定，避免返工）

1. **跨天口径可切换**：当前“计时归入结束日”；GUI 设置页可提供
   「按天比例分摊时长」选项（数据层加 second activityMinutes 分摊算法）。
2. **摘要时机对“持续多天的会话”**：现在会话空闲即补、有新活动即 stale。
   若用户不想每段都重算，可加 `minNewActivityMs` 阈值。
3. 报告导出：复制 markdown vs 落盘到 `$HOME/Documents/worklog/<kind>.md`。
4. 是否把工作台同时做成 CLI/聊天命令（/worklog …）。

## 5. 质量与交付清单

- [x] Host：采集/度量/天分布/归属日/自动摘要（已 live，6 条真实记录+摘要）
- [x] worklog_status/day/range/report/rescan 工具（子代理端到端实测通过）
- [x] 纯逻辑单测 + 端点单测 + client 无头冒烟（npm test，14 例）
- [x] GUI client bundle（conversation.view「工作台」，host /dsh-worklog 通道，见 README）
- [x] 正式安装形态：profile package.json（file 依赖 + bundles 收录）+ profile patch host row（bundle patch 留空防重复）
- [ ] 用户重启 dsh web 一次 → 页面验证「工作台」与跨重启可用（唯一剩余项）
- [ ] 长时间运行观察：扫描节奏、stale 重算频率、items.json 体积
