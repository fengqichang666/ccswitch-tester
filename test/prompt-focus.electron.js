const { app, BrowserWindow } = require('electron');
const path = require('node:path');

async function run() {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'mock-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const result = await window.webContents.executeJavaScript(`(async () => {
    const search = document.querySelector('#provider-search');
    search.value = 'claude.example';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const filteredClaudeIds = [...document.querySelectorAll('.provider-check')].map((item) => item.dataset.providerId);
    document.querySelector('#select-all').click();
    const claudeCheckbox = document.querySelector('.provider-check');
    document.querySelector('[data-group="codex"]').click();
    document.querySelector('.provider-check').click();
    document.querySelector('[data-group="claude"]').click();
    const restoredClaudeQuery = document.querySelector('#provider-search').value;
    document.querySelector('#run-button').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('.row-test-button').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('.history-button').click();
    const historyModalOpen = !document.querySelector('#history-modal').hidden;
    const historyTitle = document.querySelector('#history-title').textContent;
    document.querySelector('#close-history-button').click();
    document.querySelector('#prompt-button').click();
    document.querySelector('.delete-prompt').click();
    document.querySelector('.confirm-delete-prompt').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const input = document.querySelector('#prompt-name');
    input.click();
    input.focus();
    input.value = '删除后仍可输入';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      focused: document.activeElement === input,
      value: input.value,
      promptsRemaining: document.querySelectorAll('.prompt-item').length,
      testRuns: await window.ccswitch.getTestRuns(),
      historyModalOpen,
      historyTitle,
      filteredClaudeIds,
      restoredClaudeQuery,
    };
  })()`);
  const currentTabOnly = result.testRuns.length === 2 && result.testRuns.every((ids) => ids.length === 1 && ids[0] === 'claude-1');
  const searchWorks = result.filteredClaudeIds.length === 1 && result.filteredClaudeIds[0] === 'claude-1' && result.restoredClaudeQuery === 'claude.example';
  if (!result.focused || result.value !== '删除后仍可输入' || result.promptsRemaining !== 1 || !currentTabOnly || !searchWorks || !result.historyModalOpen || result.historyTitle !== 'Claude 测试供应商') {
    throw new Error(`语句删除后的输入框回归失败：${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));
}

app.whenReady().then(async () => {
  try {
    await run();
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
