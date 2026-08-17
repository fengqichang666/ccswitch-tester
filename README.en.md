# CCSwitch Tester

Windows desktop client for running one real Claude or Codex request against selected providers stored in CC Switch.

## Features

- Reads `%USERPROFILE%\.cc-switch\cc-switch.db` without modifying it.
- Separate Claude and Codex provider lists.
- Uses the request protocol recorded by CC Switch.
- Defaults to `claude-opus-5` and `gpt-5.6-sol`; each row is editable.
- Randomly selects one enabled prompt for each provider.
- Sends one request per selected provider and never retries automatically.
- Keeps the latest 10 results for each provider.
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
