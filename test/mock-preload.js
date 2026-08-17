const { contextBridge } = require('electron');

let state = {
  prompts: [
    { id: 'one', name: '语句一', text: '请介绍你的能力。', enabled: true },
    { id: 'two', name: '语句二', text: '请给出一个建议。', enabled: true },
  ],
  histories: {
    'claude-1': [{ id: 'history-1', testedAt: '2026-08-17T00:00:00.000Z', model: 'claude-opus-5', promptName: '语句一', ok: false, status: 0, elapsedMs: 15, errorCategory: 'DNS 解析失败', error: 'ENOTFOUND', networkPath: '直连' }],
  },
  modelOverrides: {},
};
const testRuns = [];
const providers = [
  { id: 'claude-1', appType: 'claude', group: 'claude', name: 'Claude 测试供应商', baseUrl: 'https://claude.example/v1', model: 'claude-opus-5', defaultModel: 'claude-opus-5', configuredModel: '', protocol: 'anthropic-messages', keyHint: 'sk-a...test', hasKey: true, supported: true, unavailableReason: '' },
  { id: 'codex-1', appType: 'codex', group: 'codex', name: 'Codex 测试供应商', baseUrl: 'https://codex.example/v1', model: 'gpt-5.6-sol', defaultModel: 'gpt-5.6-sol', configuredModel: '', protocol: 'openai-responses', keyHint: 'sk-b...test', hasKey: true, supported: true, unavailableReason: '' },
];

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
  onTestProgress: () => () => {},
  showError: async () => {},
});
