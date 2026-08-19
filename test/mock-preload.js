const { contextBridge } = require('electron');

let state = {
  prompts: [
    { id: 'one', name: '语句一', text: '请介绍你的能力。', enabled: true },
    { id: 'two', name: '语句二', text: '请给出一个建议。', enabled: true },
  ],
  histories: {
    'claude:shared': [{ id: 'history-1', testedAt: '2026-08-17T00:00:00.000Z', model: 'claude-opus-5', promptName: '语句一', ok: false, status: 0, elapsedMs: 15, errorCategory: 'DNS 解析失败', error: 'ENOTFOUND', networkPath: '直连' }],
  },
  modelOverrides: {},
};
const testRuns = [];
const providers = [
  { id: 'shared', providerKey: 'claude:shared', appType: 'claude', group: 'claude', name: 'Claude 测试供应商', baseUrl: 'https://claude.example/v1', model: 'claude-opus-5', defaultModel: 'claude-opus-5', configuredModel: '', protocol: 'anthropic-messages', keyHint: 'sk-a...test', hasKey: true, supported: true, unavailableReason: '' },
  { id: 'claude-2', providerKey: 'claude:claude-2', appType: 'claude', group: 'claude', name: '另一个 Claude', baseUrl: 'https://other.example/v1', model: 'claude-opus-5', defaultModel: 'claude-opus-5', configuredModel: '', protocol: 'anthropic-messages', keyHint: 'sk-c...test', hasKey: true, supported: true, unavailableReason: '' },
  { id: 'shared', providerKey: 'codex:shared', appType: 'codex', group: 'codex', name: 'Codex 测试供应商', baseUrl: 'https://codex.example/v1', model: 'gpt-5.6-sol', defaultModel: 'gpt-5.6-sol', configuredModel: '', protocol: 'openai-responses', keyHint: 'sk-b...test', hasKey: true, supported: true, unavailableReason: '' },
];

const syncPlan = [
  { id: 'claude-1', name: 'Claude 测试供应商', baseUrl: 'https://claude.example/v1', targetId: 'claude-1-desktop', status: 'ready', statusLabel: '可同步', reason: '', mode: 'direct', modeReason: '', routes: [], selectable: true, defaultSelected: true },
  { id: 'claude-2', name: '另一个 Claude', baseUrl: 'https://other.example/v1', targetId: 'claude-2-desktop', status: 'exists', statusLabel: '已存在', reason: '桌面侧已有相同 Base URL：另一个 Claude', mode: '', modeReason: '', routes: [], selectable: false, defaultSelected: false },
];
let syncEmpty = false;

contextBridge.exposeInMainWorld('ccswitch', {
  loadProviders: async () => structuredClone(providers),
  loadState: async () => structuredClone(state),
  saveState: async (next) => {
    state = structuredClone(next);
    return structuredClone(state);
  },
  runTests: async (ids) => {
    testRuns.push([...ids]);
    return { histories: structuredClone(state.histories) };
  },
  getTestRuns: async () => structuredClone(testRuns),
  syncPreview: async () => structuredClone(syncEmpty ? [] : syncPlan),
  setSyncEmpty: async (value) => { syncEmpty = Boolean(value); },
  syncToDesktop: async (ids) => ({
    backupPath: 'C:/mock/.cc-switch/backups/db_backup_mock.db',
    inserted: syncPlan.filter((item) => ids.includes(item.id) && item.selectable).map((item) => ({ id: item.targetId, sourceId: item.id, name: item.name, baseUrl: item.baseUrl, mode: item.mode, routeCount: 0 })),
    skipped: [],
    failed: [],
    rolledBack: false,
  }),
  onTestProgress: () => () => {},
  showError: async () => {},
});
