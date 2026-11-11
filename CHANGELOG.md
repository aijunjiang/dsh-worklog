# Changelog

Notable changes to this plugin. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-11-11

Supports **DSH 0.2.x** (verified on `0.2.2-rc.1`).

### Fixed

- **The settings channel registers at all.** It was registered straight from
  `apply()`, where neither `webServer` nor `connection` exists yet — both are
  mounted by rows that start later. The plugin logged
  `no connection/webServer — GUI channel not registered`, kept its tools
  working, and the browser's `/dsh-worklog/settings.get` reached no handler,
  which is the HTTP 405 users saw. Registration now waits through
  `ctx.inject(['webServer'], ...)`.
- **The committed client bundle was stale.** `lib/client.js` predated the 0.2.x
  migration and still registered `settings.plugin.item`, so the configuration
  page never appeared. The bundle is rebuilt, and a `prepare` script makes an
  install of this branch rebuild it instead of trusting whatever was committed.

### Changed

- **The settings namespace is the Loader ENTRY id (`worklog`), not the package
  name (`dsh-worklog`).** Both spellings appear in this plugin, each in its own
  place. Getting it wrong is silent: `describe()` finds no such namespace and
  the card reads defaults forever.
- **The summary knobs move into `Config`.** `installSection` is gone and 0.2.x
  derives exactly one form per entry, so a second runtime-installed schema had
  nowhere to live. The API key / model / prompt fields now sit beside the scan
  knobs — the two sets never overlapped, so existing values are untouched.
- The card reads live values through `settings.describe()` with the schema
  defaults as the fallback, instead of returning a static object that only ever
  held defaults once `setSource` disappeared.
- `settings.plugin.item` → `plugins.bundle.config` (keyed by package name),
  plus the `@deepseek-ai/dsh-client-ui-plugin-manager` client dependency that
  package requires.
- Both READMEs point at the Plugins view and explain why the two configuration
  tables became one.

## [0.1.0] — previous

See the repository history.
