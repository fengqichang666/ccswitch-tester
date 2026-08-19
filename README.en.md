# CCSwitch Tester

Windows desktop client for running one real Claude or Codex request against selected providers stored in CC Switch.

[Download the latest Windows release](https://github.com/fengqichang666/ccswitch-tester/releases/latest)

## Features

- Reads `%USERPROFILE%\.cc-switch\cc-switch.db` read-only by default; the only write path is the opt-in Claude Desktop sync described below.
- Clones selected Claude Code providers into Claude Desktop providers, after a preview and an explicit confirmation.
- Separate Claude and Codex provider lists.
- Filters the active tab instantly by provider name or server URL, with separate queries for Claude and Codex.
- Batch testing is limited to the currently visible Claude or Codex tab, and every row has its own test button.
- Uses the request protocol recorded by CC Switch.
- Adds Claude Code- and Codex-compatible request headers for providers that validate the calling client.
- Defaults to `claude-opus-5` and `gpt-5.6-sol`; each row is editable.
- Randomly selects one enabled prompt for each provider.
- Sends one request per selected provider and never retries automatically.
- Keeps the latest 10 results for each provider.
- Shows provider history in a dedicated dialog.
- Resolves CC Switch, environment, and Windows system proxy settings and reports the underlying network error code.
- Closing the main window hides the app in the Windows system tray; use the tray menu to reopen or quit.
- Stores no API keys or authorization headers in its own state.

## Sync to Claude Desktop

CC Switch keeps `claude` (Claude Code) and `claude-desktop` providers in separate lists, so every new relay has to be entered twice. The "⇄ 同步到 Desktop" button in the top bar clones Claude Code providers into Claude Desktop rows.

- Dedupes by Base URL (case-insensitive, trailing slash ignored). Rows already present on the desktop side are greyed out; existing desktop rows are never modified or deleted.
- Desktop rows use `<source id>-desktop`, so re-running the sync inserts nothing new.
- Mode selection mirrors CC Switch: `direct` when the endpoint is anthropic-formatted, all model names are `claude-*` role ids, and `ANTHROPIC_AUTH_TOKEN` is present; otherwise `proxy` with routes generated from `ANTHROPIC_DEFAULT_{SONNET,OPUS,HAIKU,FABLE}_MODEL` (a `[1M]` suffix becomes `supports1m`).
- Backs up to `%USERPROFILE%\.cc-switch\backups\db_backup_<timestamp>.db` before writing, using CC Switch's own naming so its settings page can restore it.
- INSERT only, inside one transaction: if any row fails, the whole batch rolls back.
- CC Switch does not hot-reload external changes — restart it to see the new Claude Desktop providers.

## Development

```powershell
npm install
npm start
```

## Test

```powershell
npm test
```

## Windows build

```powershell
npm run dist
```

Build artifacts are written to `dist/`.
