# dsh-worklog · DSH Worklog Calendar

> **English · [简体中文](./README.md)**

Automatically turns all your DSH chats (across workspaces, SSH routes, and finished sessions) into a **work log**:

- Sliced by **conversation node** — each "user message → model completes" turn is one node with its own summary;
- A calendar view shows daily session counts and duration; pick dates/ranges to inspect, check, and generate **daily / weekly / monthly / half-year reports**;
- Summaries use **fingerprint caching + incremental re-computation**: unchanged nodes are reused, new activity only re-summarizes new nodes (no repeated token burn);
- In reports, a session stays **one aggregated project** even when it spans multiple days.

## Features

- **Full corpus**: reads every session (local + SSH routes, including finished) via `ctx.sessionQuery`.
- **Node-level summaries**: granularity down to each turn, attributed to a local date.
- **Proactive / manual summarization**: proactive mode summarizes as soon as a day has activity; the workbench offers a "Generate summary (node slice)" button to force recompute.
- **Standalone LLM config**: `DSH built-in`, `OpenAI-compatible`, or `Anthropic`; baseUrl / apiKey / model / context configurable, custom summary prompt.
- **Reports**: select a range → check items (select-all / none) → generate Markdown, copyable.
- **Model tools**: `worklog_status / day / range / report / rescan`, available in any session.

## Install (official)

Prereqs: DSH (deepseek-harness) + Node ≥ 22.

```bash
dsh plugin --profile web add github:aijunjiang/dsh-worklog
# or from a local checkout: dsh plugin --profile web add <this-repo-path>

pnpm dsh web   # restart once; no other flags
```

> Restart dsh web once after installing: the host plugin (scan/summarize/tools) and the "工作台" client module both auto-register at boot.
> Uninstall: `dsh plugin --profile web remove dsh-worklog`.

## Usage

1. **Workbench**: open the "工作台" tab from the session-header view switcher → the month calendar shows daily session counts / minutes.
2. **View a day**: click a date to see that day's items (collapsed by default; "Expand N nodes" shows node-level summaries); click two dates to select a range.
3. **Generate report**: pick a range → "全选/全不选" or check items → choose kind (daily/weekly/monthly/half-year) → "生成报告".
4. **Summarize**: click "生成摘要（节点切片）" after selecting a date to recompute.
5. **Settings**: Settings → Plugins → Plugin configuration → "工作日志" for model/prompt/proactive.

## Configuration

### Summary settings (Settings → Plugins → 工作日志)

| Field | Default | Meaning |
|---|---|---|
| API format | `dsh` | `dsh` (built-in default model) / `openai` (OpenAI-compatible) / `anthropic` |
| Base URL | — | external endpoint (for openai/anthropic) |
| API Key | — | leave empty to fall back to env/credential `GJSL_API_KEY` |
| Model Name | — | external model name |
| Context window | 0 | input context window in tokens (does not affect output limit) |
| Summary prompt | built-in | customizable; the UI shows the default structure |
| Proactive | on | summarize as soon as a day has new activity |

### Row-level config (profile `cordis.patch.yml` / bundle patch)

See `bundle.gui.patch.yml`: timezone offset, scan interval, idle threshold, output cap, per-run summary limit, etc.

## Data & caching

- Data directory: `$DSH_HOME/dsh-worklog/items.json` (default `~/.dsh/dsh-worklog`).
- Each session stores `nodes[]`: node summaries carry a content **fingerprint**; unchanged → reused, changed → recomputed → incremental and token-efficient.

## Layout

```
src/index.js       host plugin entry (scan/summarize/tools/channel)
src/summarize.js   node-level summary queue (fingerprint cache + incremental)
src/transcript.js  conversation-node slicing + fingerprint hash
src/llm.js         summary LLM calls (DSH/openai/anthropic)
src/report.js      report assembly (date-filtered nodes)
src/endpoints.js   /dsh-worklog GUI JSON-RPC endpoints
src/client/index.ts browser half: workbench + settings card
lib/client.js      built artifact (committed; no local build needed)
tests/             unit tests (node --test)
```

## Development

```bash
npm test              # unit tests
npm run build:client  # rebuild lib/client.js via the harness tsdown pipeline
```

## Uninstall

```bash
dsh plugin --profile web remove dsh-worklog
```

## License

MIT
