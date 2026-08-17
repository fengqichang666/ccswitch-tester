# CCSwitch Tester

Windows desktop client for running one real Claude or Codex request against selected providers stored in CC Switch.

[Download the latest Windows release](https://github.com/fengqichang666/ccswitch-tester/releases/latest)

## Features

- Reads `%USERPROFILE%\.cc-switch\cc-switch.db` without modifying it.
- Separate Claude and Codex provider lists.
- Batch testing is limited to the currently visible Claude or Codex tab, and every row has its own test button.
- Uses the request protocol recorded by CC Switch.
- Defaults to `claude-opus-5` and `gpt-5.6-sol`; each row is editable.
- Randomly selects one enabled prompt for each provider.
- Sends one request per selected provider and never retries automatically.
- Keeps the latest 10 results for each provider.
- Shows provider history in a dedicated dialog.
- Resolves CC Switch, environment, and Windows system proxy settings and reports the underlying network error code.
- Closing the main window hides the app in the Windows system tray; use the tray menu to reopen or quit.
- Stores no API keys or authorization headers in its own state.

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
