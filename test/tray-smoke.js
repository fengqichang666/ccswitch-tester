const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const electronPath = require('electron');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ccswitch-tester-tray-'));

const result = spawnSync(electronPath, ['.'], {
  cwd: path.join(__dirname, '..'),
  env: { ...process.env, CCSWITCH_TEST_TRAY: '1', CCSWITCH_TEST_USER_DATA: userData },
  stdio: 'inherit',
});

fs.rmSync(userData, { recursive: true, force: true });
process.exit(result.status ?? 1);
