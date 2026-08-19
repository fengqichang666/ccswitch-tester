const app = {
  providers: [],
  state: { prompts: [], histories: {}, modelOverrides: {} },
  group: 'claude',
  selected: new Set(),
  pending: new Set(),
  runTotal: 0,
  historyProviderId: '',
  pendingDeletePromptId: '',
  searchQueries: { claude: '', codex: '' },
  running: false,
  syncPlan: [],
  syncLoaded: false,
  syncSelected: new Set(),
  syncBusy: false,
  syncConfirm: false,
  syncReport: null,
  syncError: '',
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
function visibleProviders() {
  const query = app.searchQueries[app.group].trim().toLocaleLowerCase('zh-CN');
  if (!query) return currentProviders();
  return currentProviders().filter((item) => `${item.name || ''}\n${item.baseUrl || ''}`.toLocaleLowerCase('zh-CN').includes(query));
}
function historiesFor(key) { return app.state.histories?.[key] || []; }

function renderCounts() {
  $('#claude-count').textContent = app.providers.filter((item) => item.group === 'claude').length;
  $('#codex-count').textContent = app.providers.filter((item) => item.group === 'codex').length;
  const count = visibleProviders().filter((item) => app.selected.has(item.id)).length;
  const completed = app.running ? app.runTotal - app.pending.size : 0;
  $('#selection-count').textContent = app.running ? `进度 ${completed}/${app.runTotal}` : count ? `已选择 ${count} 个供应商` : '未选择供应商';
  $('#run-button').disabled = app.running || count === 0;
  $('#run-button').textContent = app.running ? '⏳ 测试进行中' : '▶ 测试选中项';
  $('#refresh-button').disabled = app.running;
  $('#prompt-button').disabled = app.running;
  document.querySelectorAll('.tab').forEach((item) => { item.disabled = app.running; });
  const visibleSupported = visibleProviders().filter((item) => item.supported);
  const selectedVisible = visibleSupported.filter((item) => app.selected.has(item.id)).length;
  const selectAll = $('#select-all');
  selectAll.checked = visibleSupported.length > 0 && selectedVisible === visibleSupported.length;
  selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleSupported.length;
  selectAll.disabled = app.running || visibleSupported.length === 0;
  $('#provider-search').disabled = app.running;
  $('#sync-button').disabled = app.running;
}

const APP_TYPE_LABELS = { codex: 'Codex', 'claude-desktop': 'Claude Desktop', claude: 'Claude Code' };
function appTypeLabel(provider) { return APP_TYPE_LABELS[provider.appType] || (provider.group === 'codex' ? 'Codex' : 'Claude'); }

function renderHistoryItems(provider) {
  const history = historiesFor(provider.providerKey);
  if (!history.length) return '<div class="loading">暂无测试记录</div>';
  return `<div class="history-grid">${history.map((item) => `
    <article class="history-item">
      <div class="history-meta"><span>${escapeHtml(formatTime(item.testedAt))}</span><span>${escapeHtml(item.model)} · ${escapeHtml(formatDuration(item.elapsedMs))}</span></div>
      <div class="history-meta"><span class="${item.ok ? 'status ok' : 'status error'}">${item.ok ? '成功' : '失败'}</span><span>HTTP ${item.status || '—'}</span></div>
      <div class="history-meta"><span>语句：${escapeHtml(item.promptName || '未命名')}</span><span>${escapeHtml(item.networkPath || '未记录网络路径')}</span></div>
      ${item.ok ? `<div class="history-answer">${escapeHtml(item.response || '供应商返回成功，但没有可展示的文本')}</div>` : `<div class="history-error">${escapeHtml(item.errorCategory || '请求失败')}：${escapeHtml(item.error || '没有错误详情')}</div>`}
    </article>`).join('')}</div>`;
}

function renderHistoryModal() {
  const provider = app.providers.find((item) => item.providerKey === app.historyProviderId);
  if (!provider) return;
  $('#history-title').textContent = provider.name;
  $('#history-subtitle').textContent = `${provider.baseUrl || '未配置地址'} · 最近 ${historiesFor(provider.providerKey).length} 条`;
  $('#history-list').innerHTML = renderHistoryItems(provider);
}

function openHistoryModal(id) {
  app.historyProviderId = id;
  renderHistoryModal();
  $('#history-modal').hidden = false;
}

function closeHistoryModal() {
  $('#history-modal').hidden = true;
  app.historyProviderId = '';
}

function renderProviderCard(provider) {
  const history = historiesFor(provider.providerKey);
  const latest = history[0];
  const selected = app.selected.has(provider.providerKey);
  const disabled = !provider.supported;
  const pending = app.pending.has(provider.providerKey);
  const status = pending ? 'pending' : latest ? (latest.ok ? 'ok' : 'error') : 'none';
  const statusText = pending ? '测试中' : latest ? (latest.ok ? '最近一次成功' : '最近一次失败') : '未测试';
  return `<article class="provider-card ${disabled ? 'unsupported' : ''}">
    <div class="provider-row">
      <input class="check provider-check" type="checkbox" data-provider-key="${escapeHtml(provider.providerKey)}" ${selected ? 'checked' : ''} ${disabled || app.running ? 'disabled' : ''} aria-label="选择 ${escapeHtml(provider.name)}" />
      <div class="provider-name">
        <div class="name-line"><strong title="${escapeHtml(provider.name)}">${escapeHtml(provider.name)}</strong><span class="pill ${provider.group}">${escapeHtml(appTypeLabel(provider))}</span></div>
        <div class="provider-id" title="${escapeHtml(provider.id)}">${escapeHtml(provider.id)}</div>
      </div>
      <div class="endpoint"><code title="${escapeHtml(provider.baseUrl || '未配置')}">${escapeHtml(provider.baseUrl || '未配置')}</code><div class="protocol-label">${escapeHtml(provider.protocol)}${provider.unavailableReason ? ` · ${escapeHtml(provider.unavailableReason)}` : ''}</div></div>
      <input class="model-field" data-model-key="${escapeHtml(provider.providerKey)}" value="${escapeHtml(provider.model)}" aria-label="${escapeHtml(provider.name)} 的模型" ${disabled || app.running ? 'disabled' : ''} />
      <div class="key-hint ${provider.hasKey ? '' : 'missing'}">${provider.hasKey ? `key ${escapeHtml(provider.keyHint)}` : '未找到 key'}</div>
      <div class="row-actions"><span class="status ${status}">${statusText}</span><button class="button compact primary row-test-button" data-test-key="${escapeHtml(provider.providerKey)}" type="button" ${disabled || app.running ? 'disabled' : ''}>测试</button><button class="button compact secondary history-button" data-history-key="${escapeHtml(provider.providerKey)}" type="button">历史 ${history.length}</button></div>
    </div>
  </article>`;
}

function renderProviders() {
  const container = $('#provider-list');
  const visible = visibleProviders();
  $('#provider-search').value = app.searchQueries[app.group];
  if (!visible.length && app.searchQueries[app.group].trim()) container.innerHTML = '<div class="empty-state"><div class="empty-icon">⌕</div><h3>没有匹配的供应商</h3><p>请尝试其他供应商名称或 Server URL。</p></div>';
  else if (!visible.length) container.innerHTML = $('#empty-template').innerHTML;
  else container.innerHTML = visible.map(renderProviderCard).join('');
  renderCounts();
}

function renderPrompts() {
  const container = $('#prompt-list');
  container.innerHTML = app.state.prompts.length ? app.state.prompts.map((prompt) => `<div class="prompt-item ${prompt.enabled ? '' : 'disabled'}">
    <input class="prompt-toggle" data-prompt-id="${escapeHtml(prompt.id)}" type="checkbox" ${prompt.enabled ? 'checked' : ''} aria-label="启用 ${escapeHtml(prompt.name)}" />
    <div class="prompt-copy"><strong>${escapeHtml(prompt.name)}</strong><p>${escapeHtml(prompt.text)}</p></div>
    <div class="prompt-actions">${app.pendingDeletePromptId === prompt.id
      ? `<button class="text-button danger confirm-delete-prompt" data-prompt-id="${escapeHtml(prompt.id)}" type="button">确认删除</button><button class="text-button cancel-delete-prompt" type="button">取消</button>`
      : `<button class="text-button edit-prompt" data-prompt-id="${escapeHtml(prompt.id)}" type="button">编辑</button><button class="text-button danger delete-prompt" data-prompt-id="${escapeHtml(prompt.id)}" type="button">删除</button>`}
    </div>
  </div>`).join('') : '<div class="loading">还没有测试语句</div>';
}

function refreshSyncLabel() { $('#last-sync').textContent = `已读取 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`; }

async function loadAll() {
  try {
    app.state = await window.ccswitch.loadState();
    app.providers = await window.ccswitch.loadProviders();
    const validKeys = new Set(app.providers.filter((item) => item.supported).map((item) => item.providerKey));
    app.selected = new Set([...app.selected].filter((key) => validKeys.has(key)));
    setNotice('');
    refreshSyncLabel();
    renderProviders();
    if (app.historyProviderId) renderHistoryModal();
  } catch (error) {
    app.providers = [];
    renderProviders();
    setNotice(error?.message || String(error));
  }
}

async function persistState() { app.state = await window.ccswitch.saveState(app.state); }

function openPromptModal() { renderPrompts(); $('#prompt-modal').hidden = false; $('#prompt-name').focus(); }
function closePromptModal() { $('#prompt-modal').hidden = true; app.pendingDeletePromptId = ''; resetPromptForm(); }
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

async function runProviderIds(requestedIds) {
  const current = new Map(currentProviders().filter((item) => item.supported).map((item) => [item.providerKey, item]));
  const keys = requestedIds.filter((key) => current.has(key));
  if (!keys.length || app.running) return;
  if (!app.state.prompts.some((item) => item.enabled && item.text.trim())) {
    setNotice('请先在“语句管理”中启用至少一条测试语句。');
    openPromptModal();
    return;
  }
  app.running = true;
  app.runTotal = keys.length;
  app.pending = new Set(keys);
  setNotice('');
  renderProviders();
  try {
    await persistState();
    await window.ccswitch.runTests(keys);
    app.state = await window.ccswitch.loadState();
  } catch (error) {
    setNotice(error?.message || String(error));
  } finally {
    app.running = false;
    app.pending.clear();
    app.runTotal = 0;
    renderProviders();
    if (app.historyProviderId) renderHistoryModal();
  }
}

async function runSelected() {
  const keys = visibleProviders().filter((item) => item.supported && app.selected.has(item.providerKey)).map((item) => item.providerKey);
  await runProviderIds(keys);
}

const SYNC_STATUS_CLASSES = { ready: 'ready', 'name-conflict': 'warn', exists: 'exists', unsupported: 'blocked' };

function renderSyncRow(item) {
  const selectable = item.selectable && !app.syncBusy;
  const checked = app.syncSelected.has(item.id);
  const modeBadge = item.mode
    ? `<span class="pill ${item.mode}">${item.mode === 'direct' ? '直连模式' : `本地路由 · ${item.routes.length} 条`}</span>`
    : '';
  const routeLine = item.routes.map((route) => `${route.routeId} → ${route.model}${route.supports1m ? ' · 1M' : ''}`).join('；');
  const details = [
    item.reason,
    item.mode === 'proxy' && item.modeReason ? `改走本地路由：${item.modeReason}` : '',
    routeLine,
  ].filter(Boolean);
  return `<div class="sync-item ${item.selectable ? '' : 'blocked'}">
    <input class="check sync-check" type="checkbox" data-sync-id="${escapeHtml(item.id)}" ${checked ? 'checked' : ''} ${selectable ? '' : 'disabled'} aria-label="同步 ${escapeHtml(item.name)}" />
    <div class="sync-copy">
      <strong>${escapeHtml(item.name)}</strong>
      <code>${escapeHtml(item.baseUrl || '未配置地址')}</code>
      ${details.length ? `<p>${escapeHtml(details.join(' ｜ '))}</p>` : ''}
    </div>
    <div class="sync-badges"><span class="status ${SYNC_STATUS_CLASSES[item.status] || 'blocked'}">${escapeHtml(item.statusLabel || item.status)}</span>${modeBadge}</div>
  </div>`;
}

function renderSyncResult() {
  const panel = $('#sync-result');
  const report = app.syncReport;
  if (app.syncError) {
    panel.hidden = false;
    panel.className = 'sync-result failed';
    panel.innerHTML = `<strong>同步失败</strong>${escapeHtml(app.syncError)}`;
    return;
  }
  if (!report) { panel.hidden = true; panel.innerHTML = ''; return; }
  const lines = [];
  if (report.inserted.length) lines.push(`新增 ${report.inserted.length} 条：${report.inserted.map((item) => `${item.name}（${item.mode === 'direct' ? '直连' : '本地路由'}）`).join('、')}`);
  if (report.skipped.length) lines.push(`跳过 ${report.skipped.length} 条：${report.skipped.map((item) => `${item.name} — ${item.reason}`).join('；')}`);
  if (report.failed.length) lines.push(`失败 ${report.failed.length} 条：${report.failed.map((item) => `${item.name || item.id} — ${item.error}`).join('；')}`);
  if (report.rolledBack) lines.push('本次写入已整体回滚，数据库没有变化。');
  if (report.backupPath) lines.push(`写入前备份：${report.backupPath}`);
  if (report.inserted.length) lines.push('CC Switch 不会热加载外部改动，请重启 CC Switch 后在 Claude Desktop 面板查看。');
  panel.hidden = false;
  panel.className = report.failed.length || report.rolledBack ? 'sync-result failed' : 'sync-result';
  panel.innerHTML = `<strong>${report.failed.length || report.rolledBack ? '同步未完成' : '同步完成'}</strong>${lines.map((line) => escapeHtml(line)).join('<br />')}`;
}

function renderSync() {
  const list = $('#sync-list');
  if (app.syncError && !app.syncPlan.length) list.innerHTML = '<div class="loading">无法读取 CC Switch 配置</div>';
  else if (!app.syncLoaded) list.innerHTML = '<div class="loading">正在比对 CC Switch 配置…</div>';
  else if (!app.syncPlan.length) list.innerHTML = '<div class="loading">没有可比对的 Claude Code 供应商</div>';
  else list.innerHTML = app.syncPlan.map(renderSyncRow).join('');
  const selectable = app.syncPlan.filter((item) => item.selectable);
  const selectedCount = selectable.filter((item) => app.syncSelected.has(item.id)).length;
  const selectAll = $('#sync-select-all');
  selectAll.checked = selectable.length > 0 && selectedCount === selectable.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < selectable.length;
  selectAll.disabled = app.syncBusy || !selectable.length;
  $('#sync-count').textContent = app.syncBusy ? '正在写入…' : selectedCount ? `已选择 ${selectedCount} / ${selectable.length} 条可同步项` : '未选择';
  const runButton = $('#sync-run-button');
  runButton.disabled = app.syncBusy || selectedCount === 0;
  runButton.textContent = app.syncBusy ? '⏳ 写入中' : app.syncConfirm ? `确认写入 ${selectedCount} 条` : '写入 Claude Desktop';
  $('#sync-refresh-button').disabled = app.syncBusy;
  $('#sync-subtitle').textContent = app.syncConfirm
    ? '写入前会自动备份到 CC Switch 的 backups 目录；只新增行，不改动已有桌面配置。再点一次确认。'
    : '按 Base URL 比对，只新增桌面侧缺少的供应商，不改动已有配置。';
  renderSyncResult();
}

async function loadSyncPreview() {
  app.syncPlan = [];
  app.syncLoaded = false;
  app.syncError = '';
  app.syncConfirm = false;
  renderSync();
  try {
    app.syncPlan = await window.ccswitch.syncPreview();
    app.syncLoaded = true;
    app.syncSelected = new Set(app.syncPlan.filter((item) => item.defaultSelected).map((item) => item.id));
  } catch (error) {
    app.syncPlan = [];
    app.syncLoaded = true;
    app.syncError = error?.message || String(error);
  }
  renderSync();
}

function openSyncModal() {
  app.syncReport = null;
  $('#sync-modal').hidden = false;
  loadSyncPreview();
}

function closeSyncModal() {
  if (app.syncBusy) return;
  $('#sync-modal').hidden = true;
  app.syncConfirm = false;
}

async function runSync() {
  const ids = app.syncPlan.filter((item) => item.selectable && app.syncSelected.has(item.id)).map((item) => item.id);
  if (!ids.length || app.syncBusy) return;
  if (!app.syncConfirm) { app.syncConfirm = true; renderSync(); return; }
  app.syncBusy = true;
  app.syncConfirm = false;
  app.syncError = '';
  app.syncReport = null;
  renderSync();
  try {
    app.syncReport = await window.ccswitch.syncToDesktop(ids);
  } catch (error) {
    app.syncError = error?.message || String(error);
  } finally {
    app.syncBusy = false;
  }
  try {
    app.syncPlan = await window.ccswitch.syncPreview();
    app.syncSelected = new Set(app.syncPlan.filter((item) => item.defaultSelected).map((item) => item.id));
  } catch { /* 保留上一次比对结果 */ }
  renderSync();
  await loadAll();
}

document.addEventListener('click', async (event) => {
  const tab = event.target.closest('.tab');
  if (tab) { if (app.running) return; app.group = tab.dataset.group; document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab)); renderProviders(); return; }
  if (event.target.closest('#refresh-button')) { await loadAll(); return; }
  if (event.target.closest('#sync-button')) { openSyncModal(); return; }
  if (event.target.closest('#close-sync-button')) { closeSyncModal(); return; }
  if (event.target.closest('#sync-refresh-button')) { await loadSyncPreview(); return; }
  if (event.target.closest('#sync-run-button')) { await runSync(); return; }
  if (event.target.closest('#prompt-button')) { openPromptModal(); return; }
  if (event.target.closest('#close-prompt-button')) { closePromptModal(); return; }
  if (event.target.closest('#close-history-button')) { closeHistoryModal(); return; }
  if (event.target.closest('#cancel-prompt-button')) { resetPromptForm(); return; }
  if (event.target.closest('#run-button')) { await runSelected(); return; }
  const rowTestButton = event.target.closest('.row-test-button');
  if (rowTestButton) { await runProviderIds([rowTestButton.dataset.testKey]); return; }
  const historyButton = event.target.closest('.history-button');
  if (historyButton) { openHistoryModal(historyButton.dataset.historyKey); return; }
  const editButton = event.target.closest('.edit-prompt');
  if (editButton) { editPrompt(editButton.dataset.promptId); return; }
  const deleteButton = event.target.closest('.delete-prompt');
  if (deleteButton) {
    app.pendingDeletePromptId = deleteButton.dataset.promptId;
    renderPrompts();
    return;
  }
  const cancelDeleteButton = event.target.closest('.cancel-delete-prompt');
  if (cancelDeleteButton) {
    app.pendingDeletePromptId = '';
    renderPrompts();
    return;
  }
  const confirmDeleteButton = event.target.closest('.confirm-delete-prompt');
  if (confirmDeleteButton) {
    const id = confirmDeleteButton.dataset.promptId;
    app.state.prompts = app.state.prompts.filter((item) => item.id !== id);
    if ($('#prompt-id').value === id) resetPromptForm();
    app.pendingDeletePromptId = '';
    await persistState();
    renderPrompts();
    requestAnimationFrame(() => $('#prompt-name').focus());
    return;
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.matches('.sync-check')) {
    const id = event.target.dataset.syncId;
    event.target.checked ? app.syncSelected.add(id) : app.syncSelected.delete(id);
    app.syncConfirm = false;
    renderSync();
    return;
  }
  if (event.target.matches('#sync-select-all')) {
    app.syncPlan.filter((item) => item.selectable).forEach((item) => {
      if (event.target.checked) app.syncSelected.add(item.id);
      else app.syncSelected.delete(item.id);
    });
    app.syncConfirm = false;
    renderSync();
    return;
  }
  if (event.target.matches('.provider-check')) {
    const key = event.target.dataset.providerKey;
    event.target.checked ? app.selected.add(key) : app.selected.delete(key);
    renderCounts();
  }
  if (event.target.matches('#select-all')) {
    visibleProviders().filter((item) => item.supported).forEach((item) => {
      if (event.target.checked) app.selected.add(item.providerKey);
      else app.selected.delete(item.providerKey);
    });
    renderProviders();
  }
  if (event.target.matches('.prompt-toggle')) {
    const item = app.state.prompts.find((prompt) => prompt.id === event.target.dataset.promptId);
    if (item) { item.enabled = event.target.checked; await persistState(); renderPrompts(); }
  }
});

document.addEventListener('input', async (event) => {
  if (event.target.matches('#provider-search')) {
    app.searchQueries[app.group] = event.target.value;
    renderProviders();
    $('#provider-search').focus();
    return;
  }
  if (!event.target.matches('.model-field')) return;
  const key = event.target.dataset.modelKey;
  app.state.modelOverrides[key] = event.target.value.trim();
  const provider = app.providers.find((item) => item.providerKey === key);
  if (provider) provider.model = event.target.value.trim() || provider.defaultModel;
  clearTimeout(event.target._saveTimer);
  event.target._saveTimer = setTimeout(() => persistState(), 350);
});

$('#prompt-form').addEventListener('submit', handlePromptSubmit);
$('#cancel-prompt-button').style.visibility = 'hidden';
window.ccswitch.onTestProgress((result) => {
  const existing = app.state.histories[result.providerKey] || [];
  app.state.histories[result.providerKey] = [result, ...existing.filter((item) => item.id !== result.id)].slice(0, 10);
  app.pending.delete(result.providerKey);
  renderProviders();
  if (app.historyProviderId === result.providerKey) renderHistoryModal();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!$('#history-modal').hidden) closeHistoryModal();
  else if (!$('#sync-modal').hidden) closeSyncModal();
  else if (!$('#prompt-modal').hidden) closePromptModal();
});
loadAll();
