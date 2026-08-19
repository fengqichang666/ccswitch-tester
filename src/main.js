const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage, session, Tray } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const initSqlJs = require('sql.js');
const {
  buildRequest,
  defaultModel,
  maskKey,
  migrateProviderState,
  parseClaude,
  parseCodex,
  parseJson,
  parseProviderKey,
  providerKey,
  proxyUrlFromRule,
} = require('./core');
const { requestProvider } = require('./request-client');
const { previewSync, syncToDesktop } = require('./ccswitch-write');

if (process.env.CCSWITCH_TEST_USER_DATA) app.setPath('userData', path.resolve(process.env.CCSWITCH_TEST_USER_DATA));

const DEFAULT_PROMPTS = [
  { id: 'intro', name: '自我介绍', text: '你好，请用两三句话介绍你能帮我做什么，并给出一个具体例子。', enabled: true },
  { id: 'engineering', name: '工程建议', text: '我有一个小项目需要提高稳定性，请给出一条具体、可执行的建议。', enabled: true },
  { id: 'planning', name: '方案判断', text: '请帮我快速判断一个技术方案是否可行，并说明最需要注意的一点。', enabled: true },
];

let mainWindow;
let tray;
let sqlJs;
let statePath;
let running = false;
let isQuitting = false;
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

async function getProxyConfig(appType, targetUrl) {
  const dbPath = ccswitchDbPath();
  let db;
  try {
    db = await readDatabase(dbPath);
    const row = db.exec(`SELECT app_type, proxy_enabled, enabled, listen_address, listen_port FROM proxy_config WHERE app_type = '${appType}'`)[0]?.values?.[0];
    if (row && Number(row[1]) === 1 && Number(row[2]) === 1) return { proxyUrl: `http://${row[3]}:${row[4]}`, label: 'CCSwitch 代理' };
  } catch { /* Fall back to environment proxies. */ }
  finally { db?.close(); }
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
  if (envProxy) return { proxyUrl: envProxy, label: '环境代理' };
  try {
    const rule = await session.defaultSession.resolveProxy(targetUrl);
    const systemProxy = proxyUrlFromRule(rule);
    if (systemProxy) return { proxyUrl: systemProxy, label: 'Windows 系统代理' };
  } catch { /* Fall back to a direct connection. */ }
  return { proxyUrl: '', label: '直连' };
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
  const providers = rows.map(([id, appType, name, settingsConfig, websiteUrl, category, metaText]) => {
    const settings = parseJson(settingsConfig);
    const meta = parseJson(metaText);
    const parsed = appType === 'codex' ? parseCodex(settings) : parseClaude(settings, meta, appType);
    const group = appType === 'codex' ? 'codex' : 'claude';
    const providerDefaultModel = defaultModel(group);
    const supported = Boolean(parsed.key && parsed.baseUrl && category !== 'official');
    return {
      id, providerKey: providerKey(appType, id), appType, group, name: name || id, baseUrl: parsed.baseUrl, websiteUrl: websiteUrl || '',
      model: providerDefaultModel, defaultModel: providerDefaultModel, configuredModel: parsed.configuredModel || '', protocol: parsed.protocol, keyHint: maskKey(parsed.key), hasKey: Boolean(parsed.key),
      supported, unavailableReason: category === 'official' ? '官方配置没有可读取的自定义 key' : !parsed.key ? '缺少 key' : !parsed.baseUrl ? '缺少服务地址' : '',
    };
  });
  const { state } = migrateProviderState(safeReadState(), providers);
  for (const provider of providers) provider.model = state.modelOverrides[provider.providerKey] || provider.defaultModel;
  return providers;
}

async function getProviderSecrets(key) {
  const ref = parseProviderKey(key);
  if (!ref) throw new Error('供应商标识无效，请刷新配置后重试');
  const db = await readDatabase(ccswitchDbPath());
  const safeId = ref.id.replaceAll("'", "''");
  const safeAppType = ref.appType.replaceAll("'", "''");
  const result = db.exec(`SELECT id, app_type, name, settings_config, website_url, category, meta FROM providers WHERE id = '${safeId}' AND app_type = '${safeAppType}' LIMIT 1`);
  db.close();
  const row = result[0]?.values?.[0];
  if (!row) throw new Error('找不到供应商配置');
  const [providerId, appType, name, settingsConfig, websiteUrl, category, metaText] = row;
  const settings = parseJson(settingsConfig);
  const meta = parseJson(metaText);
  const parsed = appType === 'codex' ? parseCodex(settings) : parseClaude(settings, meta, appType);
  return { id: providerId, providerKey: providerKey(appType, providerId), appType, group: appType === 'codex' ? 'codex' : 'claude', name, websiteUrl, category, ...parsed };
}

async function runTests(providerKeys) {
  if (running) throw new Error('已有测试正在运行');
  const state = safeReadState();
  const prompts = state.prompts.filter((item) => item.enabled && item.text.trim());
  if (!prompts.length) throw new Error('请先在语句管理中启用至少一条测试语句');
  running = true;
  try {
    const queue = [...providerKeys];
    const worker = async () => {
      while (queue.length) {
        const requestedKey = queue.shift();
        if (!requestedKey) return;
        const prompt = prompts[Math.floor(Math.random() * prompts.length)];
        let provider;
        let result;
        try {
          provider = await getProviderSecrets(requestedKey);
          const model = state.modelOverrides[provider.providerKey] || defaultModel(provider.group);
          const endpoint = buildRequest(provider, model, prompt.text).endpoint;
          const proxy = await getProxyConfig(provider.group, endpoint);
          result = await requestProvider(provider, model, prompt.text, { proxyUrl: proxy.proxyUrl, proxyLabel: proxy.label });
          result.model = model;
        } catch (error) {
          provider = provider || { id: requestedKey, providerKey: requestedKey, name: requestedKey, group: 'unknown' };
          result = { ok: false, status: 0, elapsedMs: 0, response: '', errorCategory: '配置读取失败', error: String(error?.message || error).slice(0, 500), model: state.modelOverrides[requestedKey] || '' };
        }
        const record = {
          id: crypto.randomUUID(), testedAt: new Date().toISOString(), model: result.model, promptId: prompt.id, promptName: prompt.name,
          promptText: prompt.text, ...result,
        };
        const history = state.histories[provider.providerKey] || [];
        state.histories[provider.providerKey] = [record, ...history].slice(0, 10);
        await saveState(state);
        const safeResult = { providerKey: provider.providerKey, providerId: provider.id, providerName: provider.name, group: provider.group, ...record };
        delete safeResult.promptText;
        mainWindow?.webContents.send('test-progress', safeResult);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, providerKeys.length) }, worker));
    return { histories: state.histories };
  } finally {
    running = false;
  }
}

function setupIpc() {
  ipcMain.handle('load-providers', () => extractProviders());
  ipcMain.handle('load-state', async () => {
    const providers = await extractProviders();
    const migrated = migrateProviderState(safeReadState(), providers);
    if (migrated.changed) await saveState(migrated.state);
    return migrated.state;
  });
  ipcMain.handle('save-state', (_event, next) => saveState(next));
  ipcMain.handle('run-tests', (_event, ids) => runTests(Array.isArray(ids) ? ids : []));
  ipcMain.handle('sync-preview', () => previewSync({ dbPath: ccswitchDbPath() }));
  ipcMain.handle('sync-desktop', (_event, ids) => syncToDesktop(Array.isArray(ids) ? ids : [], { dbPath: ccswitchDbPath() }));
  ipcMain.handle('show-error', (_event, message) => dialog.showErrorBox('CCSwitch Tester', String(message)));
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  const image = nativeImage.createFromPath(iconPath).resize({ width: 24, height: 24 });
  tray = new Tray(image);
  tray.setToolTip('CCSwitch 供应商测试器');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主窗口', click: showMainWindow },
    { type: 'separator' },
    { label: '退出应用', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', showMainWindow);
  tray.on('click', showMainWindow);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#f5f7fb',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.env.CCSWITCH_TEST_SCREENSHOT) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (process.env.CCSWITCH_TEST_VIEW === 'prompts') {
          await mainWindow.webContents.executeJavaScript("document.querySelector('#prompt-button')?.click()");
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (process.env.CCSWITCH_TEST_VIEW === 'history') {
          await mainWindow.webContents.executeJavaScript("document.querySelector('.history-button')?.click()");
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        const image = await mainWindow.capturePage();
        await fsp.writeFile(process.env.CCSWITCH_TEST_SCREENSHOT, image.toPNG());
        app.quit();
      }, 2500);
    });
  }
  if (process.env.CCSWITCH_TEST_TRAY) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        mainWindow.close();
        const result = { hidden: !mainWindow.isVisible(), alive: !mainWindow.isDestroyed(), trayCreated: Boolean(tray) };
        console.log(JSON.stringify(result));
        isQuitting = true;
        app.exit(result.hidden && result.alive && result.trayCreated ? 0 : 1);
      }, 300);
    });
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else {
  app.on('second-instance', showMainWindow);
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    statePath = path.join(app.getPath('userData'), 'state.json');
    if (!fs.existsSync(statePath)) await saveState(defaultState());
    setupIpc();
    createWindow();
    createTray();
    app.on('activate', showMainWindow);
  });
}

app.on('before-quit', () => { isQuitting = true; });
