const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const {
  buildSyncPlan,
  canGoDirect,
  decideDesktopMode,
  directBlockReason,
  isClaudeSafeModelId,
  normalizeProviderRow,
  stripOneMMarker,
  suggestRoutes,
  toPlanView,
} = require('../src/sync-desktop');
const { INSERT_PROVIDER_SQL, backupDatabase, insertValues, previewSync, syncToDesktop } = require('../src/ccswitch-write');

const PROVIDERS_DDL = `CREATE TABLE providers (
  id TEXT NOT NULL, app_type TEXT NOT NULL, name TEXT NOT NULL, settings_config TEXT NOT NULL,
  website_url TEXT, category TEXT, created_at INTEGER, sort_index INTEGER, notes TEXT, icon TEXT,
  icon_color TEXT, meta TEXT NOT NULL DEFAULT '{}', is_current BOOLEAN NOT NULL DEFAULT 0,
  in_failover_queue BOOLEAN NOT NULL DEFAULT 0, cost_multiplier TEXT NOT NULL DEFAULT '1.0',
  limit_daily_usd TEXT, limit_monthly_usd TEXT, provider_type TEXT, PRIMARY KEY (id, app_type))`;

function claudeRow(overrides = {}) {
  return normalizeProviderRow({
    id: 'demo', app_type: 'claude', name: 'Demo', settings_config: JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://demo.example', ANTHROPIC_AUTH_TOKEN: 'token' } }),
    website_url: null, category: null, created_at: 1700000000000, sort_index: null, notes: null, icon: null,
    icon_color: null, meta: '{}', is_current: 0, in_failover_queue: 0, cost_multiplier: '1.0',
    limit_daily_usd: null, limit_monthly_usd: null, provider_type: null, ...overrides,
  });
}

function withEnv(env, overrides = {}) {
  return claudeRow({ settings_config: JSON.stringify({ env }), ...overrides });
}

test('accepts only claude role model ids as direct-safe', () => {
  assert.equal(isClaudeSafeModelId('claude-opus-5'), true);
  assert.equal(isClaudeSafeModelId('anthropic/claude-sonnet-4-6'), true);
  assert.equal(isClaudeSafeModelId('claude-opus-5-max'), true);
  assert.equal(isClaudeSafeModelId('claude-sonnet-'), false);
  assert.equal(isClaudeSafeModelId('claude-fable-5[1m]'), false);
  assert.equal(isClaudeSafeModelId('deepseek-v4-pro'), false);
});

test('translates the [1M] env marker into supports1m', () => {
  assert.deepEqual(stripOneMMarker('claude-fable-5[1M]'), { model: 'claude-fable-5', has1m: true });
  assert.deepEqual(stripOneMMarker('claude-opus-5'), { model: 'claude-opus-5', has1m: false });
  const routes = suggestRoutes(withEnv({ ANTHROPIC_BASE_URL: 'https://demo.example', ANTHROPIC_AUTH_TOKEN: 'token', ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5[1M]' }));
  assert.deepEqual(routes, { 'claude-sonnet-5': { model: 'glm-5', labelOverride: 'glm-5', supports1m: true } });
});

test('prefers an explicit _NAME env value as the label override', () => {
  const routes = suggestRoutes(withEnv({
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-4-6',
    ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: '主力档',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'kimi-k3',
  }));
  assert.equal(routes['claude-sonnet-5'].labelOverride, '主力档');
  assert.equal(routes['claude-opus-5'].labelOverride, 'kimi-k3');
});

test('merges duplicate upstream models and falls back to ANTHROPIC_MODEL', () => {
  const merged = suggestRoutes(withEnv({
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-opus-5',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-opus-5',
  }));
  assert.deepEqual(Object.keys(merged), ['claude-sonnet-5']);
  const fallback = suggestRoutes(withEnv({ ANTHROPIC_MODEL: 'qwen4-max' }));
  assert.deepEqual(fallback, { 'claude-sonnet-5': { model: 'qwen4-max', labelOverride: 'qwen4-max', supports1m: true } });
  assert.equal(suggestRoutes(withEnv({ ANTHROPIC_BASE_URL: 'https://demo.example' })), null);
});

test('replicates the upstream direct-mode gate', () => {
  assert.equal(canGoDirect(claudeRow()), true);
  assert.equal(canGoDirect(withEnv({ ANTHROPIC_BASE_URL: 'https://demo.example', ANTHROPIC_AUTH_TOKEN: 'token', ANTHROPIC_MODEL: 'claude-opus-5' })), true);
  assert.match(directBlockReason(withEnv({ ANTHROPIC_BASE_URL: 'https://demo.example', ANTHROPIC_AUTH_TOKEN: 'token', ANTHROPIC_MODEL: 'glm-5' })), /claude-\* 角色名/);
  assert.match(directBlockReason(claudeRow({ meta: JSON.stringify({ apiFormat: 'openai_chat' }) })), /anthropic 接口格式/);
  assert.match(directBlockReason(claudeRow({ meta: JSON.stringify({ isFullUrl: true }) })), /完整 URL/);
  assert.match(directBlockReason(claudeRow({ provider_type: 'github_copilot' })), /必须走本地路由/);
  assert.match(directBlockReason(withEnv({ ANTHROPIC_BASE_URL: 'https://demo.example', ANTHROPIC_API_KEY: 'key' })), /ANTHROPIC_AUTH_TOKEN/);
});

test('chooses proxy mode with routes when direct is impossible', () => {
  const decision = decideDesktopMode(withEnv({ ANTHROPIC_BASE_URL: 'https://demo.example', ANTHROPIC_AUTH_TOKEN: 'token', ANTHROPIC_MODEL: 'glm-5' }));
  assert.equal(decision.mode, 'proxy');
  assert.deepEqual(decision.routes, { 'claude-sonnet-5': { model: 'glm-5', labelOverride: 'glm-5', supports1m: true } });
  assert.equal(decideDesktopMode(claudeRow()).mode, 'direct');
  assert.equal(decideDesktopMode(withEnv({ ANTHROPIC_BASE_URL: 'https://demo.example', ANTHROPIC_API_KEY: 'key' })), null);
});

function sourceRow(id, name, url, overrides = {}) {
  return claudeRow({ id, name, settings_config: JSON.stringify({ env: { ANTHROPIC_BASE_URL: url, ANTHROPIC_AUTH_TOKEN: 'token' } }), ...overrides });
}

function desktopRow(id, name, url) {
  return claudeRow({ id, app_type: 'claude-desktop', name, settings_config: JSON.stringify({ env: { ANTHROPIC_BASE_URL: url, ANTHROPIC_AUTH_TOKEN: 'token' } }) });
}

test('classifies each source provider against the desktop side', () => {
  const plan = buildSyncPlan({
    claudeRows: [
      sourceRow('fresh', '新站', 'https://fresh.example'),
      sourceRow('dup', '重复站', 'https://Taken.example/'),
      sourceRow('twin', '桌面同名', 'https://twin.example'),
      sourceRow('official', 'Claude 官方', 'https://api.anthropic.com', { category: 'official' }),
      claudeRow({ id: 'keyless', name: '缺 key', settings_config: JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://keyless.example' } }) }),
      claudeRow({ id: 'urlless', name: '缺地址', settings_config: JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: 'token' } }) }),
      sourceRow('echo', '批内重复', 'https://fresh.example/'),
    ],
    desktopRows: [desktopRow('existing', '已有站', 'https://taken.example'), desktopRow('twin-mirror', '桌面同名', 'https://other.example')],
  });
  assert.deepEqual(plan.map((item) => `${item.id}:${item.status}`), [
    'fresh:ready', 'dup:exists', 'twin:name-conflict', 'official:unsupported',
    'keyless:unsupported', 'urlless:unsupported', 'echo:exists',
  ]);
  const byId = Object.fromEntries(plan.map((item) => [item.id, item]));
  assert.equal(byId.fresh.targetId, 'fresh-desktop');
  assert.equal(byId.fresh.mode, 'direct');
  assert.deepEqual([byId.fresh.selectable, byId.fresh.defaultSelected], [true, true]);
  assert.deepEqual([byId.twin.selectable, byId.twin.defaultSelected], [true, false]);
  assert.match(byId.twin.reason, /https:\/\/other\.example/);
  assert.match(byId.dup.reason, /已有站/);
  assert.deepEqual([byId.official.selectable, byId.keyless.selectable], [false, false]);
  assert.equal('desktopRow' in toPlanView(byId.fresh), false);
});

test('reuses an existing desktop id as a dedupe signal', () => {
  const plan = buildSyncPlan({
    claudeRows: [sourceRow('same', '同 id', 'https://new.example')],
    desktopRows: [desktopRow('same-desktop', '早先同步过', 'https://old.example')],
  });
  assert.equal(plan[0].status, 'exists');
  assert.match(plan[0].reason, /相同 id/);
});
function fixture(t, rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccswitch-sync-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'cc-switch.db');
  const db = new DatabaseSync(dbPath);
  db.exec(PROVIDERS_DDL);
  const insert = db.prepare(INSERT_PROVIDER_SQL);
  for (const row of rows) insert.run(...insertValues(row));
  db.close();
  return { dbPath, backupDir: path.join(dir, 'backups') };
}

function readAll(dbPath, appType) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT * FROM providers WHERE app_type = ? ORDER BY id').all(appType);
  } finally {
    db.close();
  }
}

function seedRows() {
  return [
    sourceRow('fresh', '新站', 'https://fresh.example'),
    claudeRow({ id: 'proxied', name: '中转站', settings_config: JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://proxied.example', ANTHROPIC_AUTH_TOKEN: 'token', ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5[1M]' } }) }),
    sourceRow('dup', '重复站', 'https://taken.example'),
    desktopRow('existing', '已有站', 'https://taken.example'),
  ];
}

test('keeps secrets out of the preview payload', (t) => {
  const { dbPath } = fixture(t, seedRows());
  const preview = previewSync({ dbPath });
  assert.deepEqual(preview.map((item) => `${item.id}:${item.status}`).sort(), ['dup:exists', 'fresh:ready', 'proxied:ready']);
  assert.equal(preview.every((item) => !('desktopRow' in item)), true);
  assert.doesNotMatch(JSON.stringify(preview), /token/);
});
test('inserts only the requested desktop rows and backs up first', async (t) => {
  const { dbPath, backupDir } = fixture(t, seedRows());
  const before = readAll(dbPath, 'claude-desktop');
  const report = await syncToDesktop(['fresh', 'proxied', 'dup'], { dbPath, backupDir });

  assert.equal(report.rolledBack, false);
  assert.deepEqual(report.failed, []);
  assert.deepEqual(report.inserted.map((item) => `${item.id}:${item.mode}`).sort(), ['fresh-desktop:direct', 'proxied-desktop:proxy']);
  assert.deepEqual(report.skipped.map((item) => item.id), ['dup']);
  assert.match(path.basename(report.backupPath), /^db_backup_\d{8}_\d{6}(_\d+)?\.db$/);
  assert.equal(fs.existsSync(report.backupPath), true);

  const after = readAll(dbPath, 'claude-desktop');
  assert.deepEqual(after.map((row) => row.id), ['existing', 'fresh-desktop', 'proxied-desktop']);
  assert.deepEqual(after.filter((row) => row.id === 'existing'), before);

  const direct = after.find((row) => row.id === 'fresh-desktop');
  assert.deepEqual(JSON.parse(direct.meta), { claudeDesktopMode: 'direct' });
  assert.equal(JSON.parse(direct.settings_config).env.ANTHROPIC_AUTH_TOKEN, 'token');
  assert.deepEqual([direct.is_current, direct.in_failover_queue, direct.name], [0, 0, '新站']);

  const proxied = after.find((row) => row.id === 'proxied-desktop');
  assert.deepEqual(JSON.parse(proxied.meta), {
    claudeDesktopMode: 'proxy',
    claudeDesktopModelRoutes: { 'claude-sonnet-5': { model: 'glm-5', labelOverride: 'glm-5', supports1m: true } },
  });
});

test('is idempotent and takes no backup when there is nothing to insert', async (t) => {
  const { dbPath, backupDir } = fixture(t, seedRows());
  await syncToDesktop(['fresh', 'proxied'], { dbPath, backupDir });
  const afterFirst = readAll(dbPath, 'claude-desktop');

  const second = await syncToDesktop(['fresh', 'proxied', 'dup'], { dbPath, backupDir });
  assert.deepEqual(second.inserted, []);
  assert.equal(second.backupPath, '');
  assert.deepEqual(second.skipped.map((item) => item.id).sort(), ['dup', 'fresh', 'proxied']);
  assert.deepEqual(readAll(dbPath, 'claude-desktop'), afterFirst);
  assert.equal(fs.readdirSync(backupDir).length, 1);
});

test('rolls the whole batch back when any row fails', async (t) => {
  const { dbPath, backupDir } = fixture(t, seedRows());
  const before = readAll(dbPath, 'claude-desktop');
  const report = await syncToDesktop(['fresh', 'ghost'], { dbPath, backupDir });

  assert.equal(report.rolledBack, true);
  assert.deepEqual(report.inserted, []);
  assert.deepEqual(report.failed.map((item) => item.id), ['ghost']);
  assert.deepEqual(readAll(dbPath, 'claude-desktop'), before);
  assert.equal(fs.existsSync(report.backupPath), true);
});

test('backs up committed data that is still in a WAL file', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccswitch-wal-backup-'));
  const dbPath = path.join(dir, 'source.db');
  const writer = new DatabaseSync(dbPath);
  t.after(() => {
    writer.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  writer.exec('PRAGMA journal_mode = WAL');
  writer.exec('PRAGMA wal_autocheckpoint = 0');
  writer.exec('CREATE TABLE snapshot_value (value INTEGER); INSERT INTO snapshot_value VALUES (42)');
  assert.equal(fs.existsSync(`${dbPath}-wal`), true);

  const backupPath = await backupDatabase(dbPath, path.join(dir, 'backups'));
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try {
    assert.equal(backup.prepare('SELECT value FROM snapshot_value').get().value, 42);
  } finally {
    backup.close();
  }
});
