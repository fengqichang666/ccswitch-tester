const { contextBridge } = require('electron');

let state = {
  prompts: [
    { id: 'one', name: '语句一', text: '请介绍你的能力。', enabled: true },
    { id: 'two', name: '语句二', text: '请给出一个建议。', enabled: true },
  ],
  histories: {},
  modelOverrides: {},
};

contextBridge.exposeInMainWorld('ccswitch', {
  loadProviders: async () => [],
  loadState: async () => structuredClone(state),
  saveState: async (next) => {
    state = structuredClone(next);
    return structuredClone(state);
  },
  runTests: async () => ({ histories: {} }),
  onTestProgress: () => () => {},
  showError: async () => {},
});
