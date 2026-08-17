const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const initSqlJs = require('sql.js');
const {
  defaultModel,
  maskKey,
  parseClaude,
  parseCodex,
  parseJson,
} = require('./core');
const { requestProvider } = require('./request-client');

const DEFAULT_PROMPTS = [
  { id: 'intro', name: '自我介绍', text: '你好，请用两三句话介绍你能帮我做什么，并给出一个具体例子。', enabled: true },
  { id: 'engineering', name: '工程建议', text: '我有一个小项目需要提高稳定性，请给出一条具体、可执行的建议。', enabled: true },
  { id: 'planning', name: '方案判断', text: '请帮我快速判断一个技术方案是否可行，并说明最需要注意的一点。', enabled: true },
];

let mainWindow;
let sqlJs;
let statePath;
let running = false;
let stateWriteQueue = Promise.resolve();

function ccswitchDbPath() {
  return path.join(os.homedir(), '.cc-switch', 'cc-switch.db');
}

function defaultState() {
  return { prompts: DEFAULT_PROMPTS, histories: {}, modelOverrides: {} };
}

function safeReadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return {
      prompts: Array.isArray(parsed.prompts) ? parsed.prompts : DEFAULT_PROMPTS,
      histories: parsed.histories && typeof parsed.histories === 'object' ? parsed.histories : {},
      modelOverrides: parsed.modelOverrides && typeof parsed.modelOverrides === 'object' ? parsed.modelOverrides : {},
    };
  } catch {
    return defaultState();
  }
}

async function saveState(next) {
  const clean = {
    prompts: Array.isArray(next.prompts) ? next.prompts : [],
    histories: next.histories && typeof next.histories === 'object' ? next.histories : {},
    modelOverrides: next.modelOverrides && typeof next.modelOverrides === 'object' ? next.modelOverrides : {},
  };
  const tmpPath = `${statePath}.tmp`;
  const serialized = JSON.stringify(clean, null, 2);
  stateWriteQueue = stateWriteQueue.catch(() => {}).then(async () => {
    await fsp.writeFile(tmpPath, serialized, 'utf8');
    await fsp.rename(tmpPath, statePath);
  });
  await stateWriteQueue;
  return clean;
}

async function getProxyUrl(appType) {
  const dbPath = ccswitchDbPath();
  let db;
  try {
    db = await readDatabase(dbPath);
    const row = db.exec(`SELECT app_type, proxy_enabled, enabled, listen_address, listen_port FROM proxy_config WHERE app_type = '${appType}'`)[0]?.values?.[0];
    if (row && Number(row[1]) === 1 && Number(row[2]) === 1) return `http://${row[3]}:${row[4]}`;
  } catch { /* Fall back to environment proxies. */ }
  finally { db?.close(); }
  return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
}

async function readDatabase(dbPath) {
  if (!sqlJs) sqlJs = await initSqlJs({ locateFile: (file) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file) });
  const bytes = await fsp.readFile(dbPath);
  return new sqlJs.Database(bytes);
}

async function extractProviders() {
  const dbPath = ccswitchDbPath();
  if (!fs.existsSync(dbPath)) throw new Error(`找不到 CCSwitch 数据库：${dbPath}`);
  const db = await readDatabase(dbPath);
  const result = db.exec('SELECT id, app_type, name, settings_config, website_url, category, meta FROM providers WHERE app_type IN (\'claude\', \'claude-desktop\', \'codex\') ORDER BY app_type, sort_index, name');
  db.close();
  const rows = result[0]?.values || [];
  const state = safeReadState();
  return rows.map(([id, appType, name, settingsConfig, websiteUrl, category, metaText]) => {
    const settings = parseJson(settingsConfig);
    const meta = parseJson(metaText);
    const parsed = appType === 'codex' ? parseCodex(settings) : parseClaude(settings, meta, appType);
    const group = appType === 'codex' ? 'codex' : 'claude';
    const providerDefaultModel = defaultModel(group);
    const model = state.modelOverrides[id] || providerDefaultModel;
    const supported = Boolean(parsed.key && parsed.baseUrl && category !== 'official');
    return {
      id, appType, group, name: name || id, baseUrl: parsed.baseUrl, websiteUrl: websiteUrl || '',
      model, defaultModel: providerDefaultModel, configuredModel: parsed.configuredModel || '', protocol: parsed.protocol, keyHint: maskKey(parsed.key), hasKey: Boolean(parsed.key),
      supported, unavailableReason: category === 'official' ? '官方配置没有可读取的自定义 key' : !parsed.key ? '缺少 key' : !parsed.baseUrl ? '缺少服务地址' : '',
    };
  });
}

async function getProviderSecrets(id) {
  const db = await readDatabase(ccswitchDbPath());
  const result = db.exec(`SELECT id, app_type, name, settings_config, website_url, category, meta FROM providers WHERE id = '${String(id).replaceAll("'", "''")}' LIMIT 1`);
  db.close();
  const row = result[0]?.values?.[0];
  if (!row) throw new Error('找不到供应商配置');
  const [providerId, appType, name, settingsConfig, websiteUrl, category, metaText] = row;
  const settings = parseJson(settingsConfig);
  const meta = parseJson(metaText);
  const parsed = appType === 'codex' ? parseCodex(settings) : parseClaude(settings, meta, appType);
  return { id: providerId, appType, group: appType === 'codex' ? 'codex' : 'claude', name, websiteUrl, category, ...parsed };
}

async function runTests(providerIds) {
  if (running) throw new Error('已有测试正在运行');
  const state = safeReadState();
  const prompts = state.prompts.filter((item) => item.enabled && item.text.trim());
  if (!prompts.length) throw new Error('请先在语句管理中启用至少一条测试语句');
  running = true;
  try {
    const queue = [...providerIds];
    const worker = async () => {
      while (queue.length) {
        const providerId = queue.shift();
        if (!providerId) return;
        const prompt = prompts[Math.floor(Math.random() * prompts.length)];
        let provider;
        let result;
        try {
          provider = await getProviderSecrets(providerId);
          const model = state.modelOverrides[provider.id] || defaultModel(provider.group);
          const proxyUrl = await getProxyUrl(provider.group);
          result = await requestProvider(provider, model, prompt.text, { proxyUrl });
          result.model = model;
        } catch (error) {
          provider = provider || { id: providerId, name: providerId, group: 'unknown' };
          result = { ok: false, status: 0, elapsedMs: 0, response: '', errorCategory: '配置读取失败', error: String(error?.message || error).slice(0, 500), model: state.modelOverrides[providerId] || '' };
        }
        const record = {
          id: crypto.randomUUID(), testedAt: new Date().toISOString(), model: result.model, promptId: prompt.id, promptName: prompt.name,
          promptText: prompt.text, ...result,
        };
        const history = state.histories[provider.id] || [];
        state.histories[provider.id] = [record, ...history].slice(0, 10);
        await saveState(state);
        const safeResult = { providerId: provider.id, providerName: provider.name, group: provider.group, ...record };
        delete safeResult.promptText;
        mainWindow?.webContents.send('test-progress', safeResult);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, providerIds.length) }, worker));
    return { histories: state.histories };
  } finally {
    running = false;
  }
}

function setupIpc() {
  ipcMain.handle('load-providers', () => extractProviders());
  ipcMain.handle('load-state', () => safeReadState());
  ipcMain.handle('save-state', (_event, next) => saveState(next));
  ipcMain.handle('run-tests', (_event, ids) => runTests(Array.isArray(ids) ? ids : []));
  ipcMain.handle('show-error', (_event, message) => dialog.showErrorBox('CCSwitch Tester', String(message)));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#f5f7fb',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.env.CCSWITCH_TEST_SCREENSHOT) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (process.env.CCSWITCH_TEST_VIEW === 'prompts') {
          await mainWindow.webContents.executeJavaScript("document.querySelector('#prompt-button')?.click()");
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        const image = await mainWindow.capturePage();
        await fsp.writeFile(process.env.CCSWITCH_TEST_SCREENSHOT, image.toPNG());
        app.quit();
      }, 2500);
    });
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  statePath = path.join(app.getPath('userData'), 'state.json');
  if (!fs.existsSync(statePath)) await saveState(defaultState());
  setupIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
