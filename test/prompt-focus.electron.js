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
    };
  })()`);
  if (!result.focused || result.value !== '删除后仍可输入' || result.promptsRemaining !== 1) {
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
