const app = {
  providers: [],
  state: { prompts: [], histories: {}, modelOverrides: {} },
  group: 'claude',
  selected: new Set(),
  expanded: new Set(),
  pending: new Set(),
  runTotal: 0,
  running: false,
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
const formatDuration = (value) => value ? `${(value / 1000).toFixed(1)}s` : '—';

function setNotice(message = '') {
  const notice = $('#page-notice');
  notice.textContent = message;
  notice.hidden = !message;
}

function currentProviders() { return app.providers.filter((item) => item.group === app.group); }
function historiesFor(id) { return app.state.histories?.[id] || []; }

function renderCounts() {
  $('#claude-count').textContent = app.providers.filter((item) => item.group === 'claude').length;
  $('#codex-count').textContent = app.providers.filter((item) => item.group === 'codex').length;
  const count = app.selected.size;
  const completed = app.running ? app.runTotal - app.pending.size : 0;
  $('#selection-count').textContent = app.running ? `进度 ${completed}/${app.runTotal}` : count ? `已选择 ${count} 个供应商` : '未选择供应商';
  $('#run-button').disabled = app.running || count === 0;
  $('#run-button').textContent = app.running ? '⏳ 测试进行中' : '▶ 测试选中项';
  $('#refresh-button').disabled = app.running;
  $('#prompt-button').disabled = app.running;
  const visibleSupported = currentProviders().filter((item) => item.supported);
  const selectedVisible = visibleSupported.filter((item) => app.selected.has(item.id)).length;
  const selectAll = $('#select-all');
  selectAll.checked = visibleSupported.length > 0 && selectedVisible === visibleSupported.length;
  selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleSupported.length;
  selectAll.disabled = app.running || visibleSupported.length === 0;
}

function renderHistory(provider) {
  const history = historiesFor(provider.id);
  if (!app.expanded.has(provider.id)) return '';
  if (!history.length) return '<div class="history"><div class="history-grid"><div class="loading">暂无测试记录</div></div></div>';
  return `<div class="history"><div class="history-grid">${history.map((item) => `
    <article class="history-item">
      <div class="history-meta"><span>${escapeHtml(formatTime(item.testedAt))}</span><span>${escapeHtml(item.model)} · ${escapeHtml(formatDuration(item.elapsedMs))}</span></div>
      <div class="history-meta"><span class="${item.ok ? 'status ok' : 'status error'}">${item.ok ? '成功' : '失败'}</span><span>HTTP ${item.status || '—'}</span></div>
      <div class="history-meta"><span>语句：${escapeHtml(item.promptName || '未命名')}</span></div>
      ${item.ok ? `<div class="history-answer">${escapeHtml(item.response || '供应商返回成功，但没有可展示的文本')}</div>` : `<div class="history-error">${escapeHtml(item.errorCategory || '请求失败')}：${escapeHtml(item.error || '没有错误详情')}</div>`}
    </article>`).join('')}</div></div>`;
}

function renderProviderCard(provider) {
  const history = historiesFor(provider.id);
  const latest = history[0];
  const selected = app.selected.has(provider.id);
  const disabled = !provider.supported;
  const pending = app.pending.has(provider.id);
  const status = pending ? 'pending' : latest ? (latest.ok ? 'ok' : 'error') : 'none';
  const statusText = pending ? '测试中' : latest ? (latest.ok ? '最近一次成功' : '最近一次失败') : '未测试';
  return `<article class="provider-card ${disabled ? 'unsupported' : ''}">
    <div class="provider-row">
      <input class="check provider-check" type="checkbox" data-provider-id="${escapeHtml(provider.id)}" ${selected ? 'checked' : ''} ${disabled || app.running ? 'disabled' : ''} aria-label="选择 ${escapeHtml(provider.name)}" />
      <div class="provider-name">
        <div class="name-line"><strong title="${escapeHtml(provider.name)}">${escapeHtml(provider.name)}</strong><span class="pill ${provider.group}">${provider.group === 'claude' ? 'Claude' : 'Codex'}</span></div>
        <div class="provider-id" title="${escapeHtml(provider.id)}">${escapeHtml(provider.id)}</div>
      </div>
      <div class="endpoint"><code title="${escapeHtml(provider.baseUrl || '未配置')}">${escapeHtml(provider.baseUrl || '未配置')}</code><div class="protocol-label">${escapeHtml(provider.protocol)}${provider.unavailableReason ? ` · ${escapeHtml(provider.unavailableReason)}` : ''}</div></div>
      <input class="model-field" data-model-id="${escapeHtml(provider.id)}" value="${escapeHtml(provider.model)}" aria-label="${escapeHtml(provider.name)} 的模型" ${disabled || app.running ? 'disabled' : ''} />
      <div class="key-hint ${provider.hasKey ? '' : 'missing'}">${provider.hasKey ? `key ${escapeHtml(provider.keyHint)}` : '未找到 key'}</div>
      <div class="row-actions"><span class="status ${status}">${statusText}</span><button class="icon-button history-button" data-history-id="${escapeHtml(provider.id)}" type="button" title="查看最近 10 次记录">${app.expanded.has(provider.id) ? '⌃' : '⌄'}</button></div>
    </div>
    ${renderHistory(provider)}
  </article>`;
}

function renderProviders() {
  const container = $('#provider-list');
  const visible = currentProviders();
  if (!visible.length) container.innerHTML = $('#empty-template').innerHTML;
  else container.innerHTML = visible.map(renderProviderCard).join('');
  renderCounts();
}

function renderPrompts() {
  const container = $('#prompt-list');
  container.innerHTML = app.state.prompts.length ? app.state.prompts.map((prompt) => `<div class="prompt-item ${prompt.enabled ? '' : 'disabled'}">
    <input class="prompt-toggle" data-prompt-id="${escapeHtml(prompt.id)}" type="checkbox" ${prompt.enabled ? 'checked' : ''} aria-label="启用 ${escapeHtml(prompt.name)}" />
    <div class="prompt-copy"><strong>${escapeHtml(prompt.name)}</strong><p>${escapeHtml(prompt.text)}</p></div>
    <div class="prompt-actions"><button class="text-button edit-prompt" data-prompt-id="${escapeHtml(prompt.id)}" type="button">编辑</button><button class="text-button danger delete-prompt" data-prompt-id="${escapeHtml(prompt.id)}" type="button">删除</button></div>
  </div>`).join('') : '<div class="loading">还没有测试语句</div>';
}

function refreshSyncLabel() { $('#last-sync').textContent = `已读取 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`; }

async function loadAll() {
  try {
    app.state = await window.ccswitch.loadState();
    app.providers = await window.ccswitch.loadProviders();
    const validIds = new Set(app.providers.filter((item) => item.supported).map((item) => item.id));
    app.selected = new Set([...app.selected].filter((id) => validIds.has(id)));
    setNotice('');
    refreshSyncLabel();
    renderProviders();
  } catch (error) {
    app.providers = [];
    renderProviders();
    setNotice(error?.message || String(error));
  }
}

async function persistState() { app.state = await window.ccswitch.saveState(app.state); }

function openPromptModal() { renderPrompts(); $('#prompt-modal').hidden = false; $('#prompt-name').focus(); }
function closePromptModal() { $('#prompt-modal').hidden = true; resetPromptForm(); }
function resetPromptForm() { $('#prompt-id').value = ''; $('#prompt-name').value = ''; $('#prompt-text').value = ''; $('#cancel-prompt-button').style.visibility = 'hidden'; }

function editPrompt(id) {
  const prompt = app.state.prompts.find((item) => item.id === id);
  if (!prompt) return;
  $('#prompt-id').value = prompt.id;
  $('#prompt-name').value = prompt.name;
  $('#prompt-text').value = prompt.text;
  $('#cancel-prompt-button').style.visibility = 'visible';
  $('#prompt-name').focus();
}

async function handlePromptSubmit(event) {
  event.preventDefault();
  const id = $('#prompt-id').value || crypto.randomUUID();
  const previous = app.state.prompts.find((item) => item.id === id);
  const next = { id, name: $('#prompt-name').value.trim(), text: $('#prompt-text').value.trim(), enabled: previous?.enabled ?? true };
  if (!next.name || !next.text) return;
  const index = app.state.prompts.findIndex((item) => item.id === id);
  if (index >= 0) app.state.prompts[index] = { ...app.state.prompts[index], ...next };
  else app.state.prompts.push(next);
  await persistState();
  renderPrompts();
  resetPromptForm();
}

async function runSelected() {
  const ids = [...app.selected];
  if (!ids.length || app.running) return;
  if (!app.state.prompts.some((item) => item.enabled && item.text.trim())) {
    setNotice('请先在“语句管理”中启用至少一条测试语句。');
    openPromptModal();
    return;
  }
  app.running = true;
  app.runTotal = ids.length;
  app.pending = new Set(ids);
  setNotice('');
  renderProviders();
  try {
    await persistState();
    await window.ccswitch.runTests(ids);
    app.state = await window.ccswitch.loadState();
  } catch (error) {
    setNotice(error?.message || String(error));
  } finally {
    app.running = false;
    app.pending.clear();
    app.runTotal = 0;
    renderProviders();
  }
}

document.addEventListener('click', async (event) => {
  const tab = event.target.closest('.tab');
  if (tab) { app.group = tab.dataset.group; document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab)); renderProviders(); return; }
  if (event.target.closest('#refresh-button')) { await loadAll(); return; }
  if (event.target.closest('#prompt-button')) { openPromptModal(); return; }
  if (event.target.closest('#close-prompt-button')) { closePromptModal(); return; }
  if (event.target.closest('#cancel-prompt-button')) { resetPromptForm(); return; }
  if (event.target.closest('#run-button')) { await runSelected(); return; }
  const historyButton = event.target.closest('.history-button');
  if (historyButton) { const id = historyButton.dataset.historyId; app.expanded.has(id) ? app.expanded.delete(id) : app.expanded.add(id); renderProviders(); return; }
  const editButton = event.target.closest('.edit-prompt');
  if (editButton) { editPrompt(editButton.dataset.promptId); return; }
  const deleteButton = event.target.closest('.delete-prompt');
  if (deleteButton) {
    if (!window.confirm('删除这条测试语句？')) return;
    app.state.prompts = app.state.prompts.filter((item) => item.id !== deleteButton.dataset.promptId);
    await persistState(); renderPrompts(); return;
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.matches('.provider-check')) {
    const id = event.target.dataset.providerId;
    event.target.checked ? app.selected.add(id) : app.selected.delete(id);
    renderCounts();
  }
  if (event.target.matches('#select-all')) {
    currentProviders().filter((item) => item.supported).forEach((item) => {
      if (event.target.checked) app.selected.add(item.id);
      else app.selected.delete(item.id);
    });
    renderProviders();
  }
  if (event.target.matches('.prompt-toggle')) {
    const item = app.state.prompts.find((prompt) => prompt.id === event.target.dataset.promptId);
    if (item) { item.enabled = event.target.checked; await persistState(); renderPrompts(); }
  }
});

document.addEventListener('input', async (event) => {
  if (!event.target.matches('.model-field')) return;
  const id = event.target.dataset.modelId;
  app.state.modelOverrides[id] = event.target.value.trim();
  const provider = app.providers.find((item) => item.id === id);
  if (provider) provider.model = event.target.value.trim() || provider.defaultModel;
  clearTimeout(event.target._saveTimer);
  event.target._saveTimer = setTimeout(() => persistState(), 350);
});

$('#prompt-form').addEventListener('submit', handlePromptSubmit);
$('#cancel-prompt-button').style.visibility = 'hidden';
window.ccswitch.onTestProgress((result) => {
  const existing = app.state.histories[result.providerId] || [];
  app.state.histories[result.providerId] = [result, ...existing.filter((item) => item.id !== result.id)].slice(0, 10);
  app.pending.delete(result.providerId);
  app.expanded.add(result.providerId);
  renderProviders();
});
loadAll();
