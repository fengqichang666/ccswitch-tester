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
    const initialRows = [...document.querySelectorAll('.provider-row')].slice(0, 2);
    const columnPositions = initialRows.map((row) => ['.provider-name', '.endpoint', '.model-field', '.last-tested', '.row-actions']
      .map((selector) => Math.round(row.querySelector(selector).getBoundingClientRect().left)));
    const columnsAligned = columnPositions.length === 2 && columnPositions[0].every((value, index) => value === columnPositions[1][index]);
    const metadataHidden = !document.querySelector('.provider-id, .protocol-label, .key-hint');
    const search = document.querySelector('#provider-search');
    search.value = 'claude.example';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const filteredClaudeKeys = [...document.querySelectorAll('.provider-check')].map((item) => item.dataset.providerKey);
    document.querySelector('#select-all').click();
    const claudeCheckbox = document.querySelector('.provider-check');
    document.querySelector('[data-group="codex"]').click();
    document.querySelector('.provider-check').click();
    document.querySelector('[data-group="claude"]').click();
    const restoredClaudeQuery = document.querySelector('#provider-search').value;
    const selectionCount = document.querySelector('#selection-count').textContent;
    const runButtonEnabled = !document.querySelector('#run-button').disabled;
    const latestTestedText = document.querySelector('.last-tested time')?.textContent || '';
    document.querySelector('#run-button').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('.row-test-button').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('.history-button').click();
    const historyModalOpen = !document.querySelector('#history-modal').hidden;
    const historyTitle = document.querySelector('#history-title').textContent;
    document.querySelector('#close-history-button').click();
    await window.ccswitch.setSyncEmpty(true);
    document.querySelector('#sync-button').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const emptySyncText = document.querySelector('#sync-list').textContent.trim();
    document.querySelector('#close-sync-button').click();
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
      columnsAligned,
      metadataHidden,
      promptsRemaining: document.querySelectorAll('.prompt-item').length,
      testRuns: await window.ccswitch.getTestRuns(),
      historyModalOpen,
      historyTitle,
      filteredClaudeKeys,
      restoredClaudeQuery,
      selectionCount,
      runButtonEnabled,
      latestTestedText,
      emptySyncText,
    };
  })()`);
  const currentTabOnly = result.testRuns.length >= 1 && result.testRuns.every((keys) => keys.length === 1 && keys[0] === 'claude:shared');
  const searchWorks = result.filteredClaudeKeys.length === 1 && result.filteredClaudeKeys[0] === 'claude:shared' && result.restoredClaudeQuery === 'claude.example';
  const selectionWorks = result.selectionCount === '已选择 1 个供应商' && result.runButtonEnabled;
  const latestTimeWorks = result.latestTestedText === '2026/8/17 08:00:00';
  const emptySyncWorks = result.emptySyncText === '没有可比对的 Claude Code 供应商';
  if (!result.focused || result.value !== '删除后仍可输入' || !result.columnsAligned || !result.metadataHidden || result.promptsRemaining !== 1 || !currentTabOnly || !searchWorks || !selectionWorks || !latestTimeWorks || !emptySyncWorks || !result.historyModalOpen || result.historyTitle !== 'Claude 测试供应商') {
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
