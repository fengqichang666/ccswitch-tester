const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { CLAUDE_APP_TYPE, DESKTOP_APP_TYPE, buildSyncPlan, normalizeProviderRow, toPlanView } = require('./sync-desktop');

const PROVIDER_COLUMNS = [
  'id', 'app_type', 'name', 'settings_config', 'website_url', 'category', 'created_at', 'sort_index', 'notes',
  'icon', 'icon_color', 'meta', 'is_current', 'in_failover_queue', 'cost_multiplier', 'limit_daily_usd',
  'limit_monthly_usd', 'provider_type',
];
const SELECT_PROVIDER_SQL = `SELECT ${PROVIDER_COLUMNS.join(', ')} FROM providers WHERE app_type = ? ORDER BY sort_index, name`;
const INSERT_PROVIDER_SQL = `INSERT INTO providers (${PROVIDER_COLUMNS.join(', ')}) VALUES (${PROVIDER_COLUMNS.map(() => '?').join(', ')})`;

function ccswitchHome() { return path.join(os.homedir(), '.cc-switch'); }
function defaultDbPath() { return path.join(ccswitchHome(), 'cc-switch.db'); }
function defaultBackupDir() { return path.join(ccswitchHome(), 'backups'); }

function assertDatabase(dbPath) {
  if (!fs.existsSync(dbPath)) throw new Error(`找不到 CCSwitch 数据库：${dbPath}`);
}

// 沿用 CC Switch 自己的备份命名，它的设置页就能在「恢复备份」里看到这一份。
function backupStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function backupDatabase(dbPath, backupDir) {
  await fsp.mkdir(backupDir, { recursive: true });
  const stamp = backupStamp();
  let target = path.join(backupDir, `db_backup_${stamp}.db`);
  for (let suffix = 1; fs.existsSync(target); suffix += 1) target = path.join(backupDir, `db_backup_${stamp}_${suffix}.db`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  } catch (error) {
    try { await fsp.unlink(target); } catch { /* VACUUM may fail before creating the target. */ }
    throw error;
  } finally {
    db.close();
  }
  return target;
}

function readRows(db, appType) {
  return db.prepare(SELECT_PROVIDER_SQL).all(appType).map(normalizeProviderRow);
}

function planFor(db) {
  return buildSyncPlan({ claudeRows: readRows(db, CLAUDE_APP_TYPE), desktopRows: readRows(db, DESKTOP_APP_TYPE) });
}

function insertValues(row) {
  return [
    row.id, row.appType, row.name, JSON.stringify(row.settingsConfig ?? {}), row.websiteUrl ?? null,
    row.category ?? null, row.createdAt ?? null, row.sortIndex ?? null, row.notes ?? null, row.icon ?? null,
    row.iconColor ?? null, JSON.stringify(row.meta ?? {}), row.isCurrent ? 1 : 0, row.inFailoverQueue ? 1 : 0,
    String(row.costMultiplier ?? '1.0'), row.limitDailyUsd ?? null, row.limitMonthlyUsd ?? null, row.providerType ?? null,
  ];
}

function previewSync({ dbPath = defaultDbPath() } = {}) {
  assertDatabase(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return planFor(db).map(toPlanView);
  } finally {
    db.close();
  }
}

async function syncToDesktop(ids, { dbPath = defaultDbPath(), backupDir = defaultBackupDir() } = {}) {
  const requested = new Set((Array.isArray(ids) ? ids : []).map(String));
  const report = { backupPath: '', inserted: [], skipped: [], failed: [], rolledBack: false };
  assertDatabase(dbPath);
  if (!requested.size) return report;

  const preview = previewSync({ dbPath }).filter((item) => requested.has(item.id));
  if (!preview.some((item) => item.selectable)) {
    report.skipped = preview.map((item) => ({ id: item.id, name: item.name, reason: item.reason || '当前状态不可同步' }));
    for (const id of requested) if (!preview.some((item) => item.id === id)) report.failed.push({ id, name: id, error: '在数据库里找不到这条 Claude Code 供应商' });
    return report;
  }

  report.backupPath = await backupDatabase(dbPath, backupDir);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('BEGIN IMMEDIATE');
    // 事务内重算一遍：界面上的预览可能已经过期（CC Switch 也在写这个库）。
    const plan = planFor(db);
    const insert = db.prepare(INSERT_PROVIDER_SQL);
    const seen = new Set();
    for (const item of plan) {
      if (!requested.has(item.id)) continue;
      seen.add(item.id);
      if (!item.selectable || !item.desktopRow) {
        report.skipped.push({ id: item.id, name: item.name, reason: item.reason || '当前状态不可同步' });
        continue;
      }
      try {
        insert.run(...insertValues(item.desktopRow));
        report.inserted.push({ id: item.desktopRow.id, sourceId: item.id, name: item.name, baseUrl: item.baseUrl, mode: item.mode, routeCount: item.routes.length });
      } catch (error) {
        report.failed.push({ id: item.id, name: item.name, error: String(error?.message || error) });
      }
    }
    for (const id of requested) if (!seen.has(id)) report.failed.push({ id, name: id, error: '在数据库里找不到这条 Claude Code 供应商' });
    if (report.failed.length) {
      db.exec('ROLLBACK');
      report.rolledBack = true;
      report.inserted = [];
    } else {
      db.exec('COMMIT');
    }
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* 事务可能已经结束 */ }
    report.rolledBack = true;
    report.inserted = [];
    report.failed.push({ id: '', name: '', error: String(error?.message || error) });
  } finally {
    db.close();
  }
  return report;
}

module.exports = {
  INSERT_PROVIDER_SQL,
  PROVIDER_COLUMNS,
  SELECT_PROVIDER_SQL,
  backupDatabase,
  backupStamp,
  defaultBackupDir,
  defaultDbPath,
  insertValues,
  previewSync,
  syncToDesktop,
};
