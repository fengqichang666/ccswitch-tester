const { normalizeBaseUrl, parseJson } = require('./core');

const CLAUDE_APP_TYPE = 'claude';
const DESKTOP_APP_TYPE = 'claude-desktop';
const ONE_M_CONTEXT_MARKER = '[1m]';
const CLAUDE_ROUTE_PREFIXES = ['anthropic/claude-', 'claude-'];
const CLAUDE_ROLE_PREFIXES = ['sonnet-', 'opus-', 'haiku-', 'fable-'];
const PROXY_ONLY_PROVIDER_TYPES = ['github_copilot', 'codex_oauth', 'xai_oauth'];
const MODEL_ENV_KEYS = ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL'];
// 与上游 claude_desktop_config.rs 的 DEFAULT_PROXY_ROUTES 顺序一致：fable 放最后。
const DEFAULT_PROXY_ROUTES = [
  { routeId: 'claude-sonnet-5', envKey: 'ANTHROPIC_DEFAULT_SONNET_MODEL' },
  { routeId: 'claude-opus-5', envKey: 'ANTHROPIC_DEFAULT_OPUS_MODEL' },
  { routeId: 'claude-haiku-4-5', envKey: 'ANTHROPIC_DEFAULT_HAIKU_MODEL' },
  { routeId: 'claude-fable-5', envKey: 'ANTHROPIC_DEFAULT_FABLE_MODEL' },
];

function normalizeUrlKey(value) { return normalizeBaseUrl(value).toLowerCase(); }
function normalizeNameKey(value) { return String(value || '').trim().toLocaleLowerCase('zh-CN'); }
function desktopIdFor(sourceId) { return `${sourceId}-desktop`; }

function normalizeProviderRow(row) {
  return {
    id: String(row.id),
    appType: String(row.app_type),
    name: row.name || String(row.id),
    settingsConfig: parseJson(row.settings_config),
    websiteUrl: row.website_url ?? null,
    category: row.category ?? null,
    createdAt: row.created_at ?? null,
    sortIndex: row.sort_index ?? null,
    notes: row.notes ?? null,
    icon: row.icon ?? null,
    iconColor: row.icon_color ?? null,
    meta: parseJson(row.meta),
    isCurrent: Number(row.is_current) ? 1 : 0,
    inFailoverQueue: Number(row.in_failover_queue) ? 1 : 0,
    costMultiplier: row.cost_multiplier ?? '1.0',
    limitDailyUsd: row.limit_daily_usd ?? null,
    limitMonthlyUsd: row.limit_monthly_usd ?? null,
    providerType: row.provider_type ?? null,
  };
}

function envOf(row) {
  const env = row?.settingsConfig?.env;
  return env && typeof env === 'object' && !Array.isArray(env) ? env : null;
}

function envValue(env, key) {
  const value = env?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function baseUrlOf(row) { return envValue(envOf(row), 'ANTHROPIC_BASE_URL'); }
function keyOf(row) { return envValue(envOf(row), 'ANTHROPIC_AUTH_TOKEN') || envValue(envOf(row), 'ANTHROPIC_API_KEY'); }
function providerTypeOf(row) { return String(row?.meta?.provider_type || row?.providerType || '').trim(); }

// 上游 claude_desktop_config.rs::is_claude_safe_model_id
function isClaudeSafeModelId(model) {
  const normalized = String(model || '').trim().toLowerCase();
  if (!normalized || normalized.includes(ONE_M_CONTEXT_MARKER)) return false;
  const prefix = CLAUDE_ROUTE_PREFIXES.find((item) => normalized.startsWith(item));
  if (!prefix) return false;
  const tail = normalized.slice(prefix.length);
  return CLAUDE_ROLE_PREFIXES.some((role) => tail.startsWith(role) && tail.length > role.length);
}

// Claude Code env 用 `[1M]` 后缀声明 1M 上下文，桌面 schema 改用 supports1m 字段。
function stripOneMMarker(model) {
  const raw = String(model || '').trim();
  const has1m = raw.toLowerCase().endsWith(ONE_M_CONTEXT_MARKER);
  return { model: has1m ? raw.slice(0, -ONE_M_CONTEXT_MARKER.length).trimEnd() : raw, has1m };
}

function claudeModelsAreSafe(row) {
  const env = envOf(row);
  if (!env) return true;
  return MODEL_ENV_KEYS.map((key) => envValue(env, key)).filter(Boolean).every(isClaudeSafeModelId);
}

// 上游 validate_direct_provider + claude_provider_models_are_claude_safe；返回空串表示可直连。
function directBlockReason(row) {
  const settings = row?.settingsConfig;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return '配置不是 JSON 对象';
  const meta = row.meta || {};
  const apiFormat = String(meta.apiFormat || '').trim();
  if (apiFormat && apiFormat !== 'anthropic') return `直连只支持 anthropic 接口格式（当前 ${apiFormat}）`;
  if (String(meta.claudeDesktopMode || '') === 'proxy') return '源配置已标记为本地路由模式';
  if (PROXY_ONLY_PROVIDER_TYPES.includes(providerTypeOf(row))) return '该供应商类型必须走本地路由';
  if (meta.isFullUrl === true) return '直连不支持完整 URL 端点';
  const routes = meta.claudeDesktopModelRoutes;
  if (routes && typeof routes === 'object') {
    for (const [rawRouteId, route] of Object.entries(routes)) {
      const routeId = String(rawRouteId || '').trim();
      if (!routeId) continue;
      if (!isClaudeSafeModelId(routeId)) return `路由 ${routeId} 不是 claude-* 名称`;
      const upstreamModel = String(route?.model || '').trim();
      if (upstreamModel && upstreamModel !== routeId) return `直连不能映射模型：${routeId} → ${upstreamModel}`;
    }
  }
  const env = envOf(row);
  if (!env) return '缺少 env 配置';
  if (!envValue(env, 'ANTHROPIC_BASE_URL')) return '缺少 ANTHROPIC_BASE_URL';
  if (!envValue(env, 'ANTHROPIC_AUTH_TOKEN')) return '直连需要 ANTHROPIC_AUTH_TOKEN';
  if (!claudeModelsAreSafe(row)) return 'env 里的模型名不是 claude-* 角色名';
  return '';
}

function canGoDirect(row) { return directBlockReason(row) === ''; }

// 上游 provider.rs::suggested_claude_desktop_routes 的 add_route
function addRoute(routes, env, routeId, envKey, supports1mDefault) {
  const raw = envValue(env, envKey);
  if (!raw) return;
  const { model, has1m } = stripOneMMarker(raw);
  if (!model) return;
  const supports1m = supports1mDefault || has1m;
  const explicitLabel = envValue(env, `${envKey}_NAME`);
  const labelOverride = explicitLabel || (isClaudeSafeModelId(model) ? '' : model);
  const mergeInto = (existing) => {
    existing.supports1m = Boolean(existing.supports1m) || supports1m;
    if (!existing.labelOverride || explicitLabel || existing.labelOverride === model) {
      if (labelOverride) existing.labelOverride = labelOverride;
      else delete existing.labelOverride;
    }
  };
  const sameModel = Object.values(routes).find((existing) => existing.model === model);
  if (sameModel) return mergeInto(sameModel);
  if (routes[routeId]) return mergeInto(routes[routeId]);
  routes[routeId] = labelOverride ? { model, labelOverride, supports1m } : { model, supports1m };
}

function suggestRoutes(row) {
  const env = envOf(row);
  if (!env) return null;
  const supports1mDefault = !PROXY_ONLY_PROVIDER_TYPES.includes(providerTypeOf(row));
  const routes = {};
  for (const spec of DEFAULT_PROXY_ROUTES) addRoute(routes, env, spec.routeId, spec.envKey, supports1mDefault);
  if (!Object.keys(routes).length) addRoute(routes, env, DEFAULT_PROXY_ROUTES[0].routeId, 'ANTHROPIC_MODEL', supports1mDefault);
  return Object.keys(routes).length ? routes : null;
}

function decideDesktopMode(row) {
  const blockReason = directBlockReason(row);
  if (!blockReason) return { mode: 'direct', routes: null, modeReason: '' };
  const routes = suggestRoutes(row);
  if (routes) return { mode: 'proxy', routes, modeReason: blockReason };
  return null;
}

function buildDesktopRow(row, decision) {
  const meta = { ...(row.meta || {}) };
  meta.claudeDesktopMode = decision.mode;
  if (decision.mode === 'proxy') meta.claudeDesktopModelRoutes = decision.routes;
  else delete meta.claudeDesktopModelRoutes;
  return { ...row, id: desktopIdFor(row.id), appType: DESKTOP_APP_TYPE, meta, isCurrent: 0, inFailoverQueue: 0 };
}

const STATUS_LABELS = { ready: '可同步', exists: '已存在', 'name-conflict': '同名待确认', unsupported: '不可同步' };

function routePreview(routes) {
  const entries = Object.entries(routes || {});
  const order = DEFAULT_PROXY_ROUTES.map((spec) => spec.routeId);
  entries.sort((left, right) => {
    const leftIndex = order.indexOf(left[0]);
    const rightIndex = order.indexOf(right[0]);
    return (leftIndex < 0 ? order.length : leftIndex) - (rightIndex < 0 ? order.length : rightIndex);
  });
  return entries.map(([routeId, route]) => ({ routeId, model: route.model, labelOverride: route.labelOverride || '', supports1m: Boolean(route.supports1m) }));
}

function planItemFor(row, index) {
  const baseUrl = baseUrlOf(row);
  const item = {
    id: row.id, name: row.name, baseUrl, targetId: desktopIdFor(row.id),
    status: 'ready', statusLabel: STATUS_LABELS.ready, reason: '',
    mode: '', modeReason: '', routes: [], selectable: true, defaultSelected: true, desktopRow: null,
  };
  const finish = (status, reason) => {
    item.status = status;
    item.statusLabel = STATUS_LABELS[status];
    item.reason = reason;
    item.selectable = status === 'ready' || status === 'name-conflict';
    item.defaultSelected = status === 'ready';
    return item;
  };

  if (row.category === 'official') return finish('unsupported', '官方配置没有可搬运的地址和 key');
  if (!baseUrl) return finish('unsupported', '缺少 ANTHROPIC_BASE_URL');
  if (!keyOf(row)) return finish('unsupported', '缺少 ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY');

  const urlKey = normalizeUrlKey(baseUrl);
  if (index.takenUrlKeys.has(urlKey)) return finish('exists', index.urlOwners.get(urlKey) || '桌面侧已有相同 Base URL');
  if (index.takenIds.has(row.id) || index.takenIds.has(item.targetId)) return finish('exists', '桌面侧已有相同 id 的供应商');

  const decision = decideDesktopMode(row);
  if (!decision) return finish('unsupported', '既不能直连，也推不出模型路由');
  item.mode = decision.mode;
  item.modeReason = decision.modeReason;
  item.routes = routePreview(decision.routes);
  item.desktopRow = buildDesktopRow(row, decision);

  index.takenUrlKeys.add(urlKey);
  index.urlOwners.set(urlKey, `桌面侧已有相同 Base URL：${row.name}`);
  index.takenIds.add(item.targetId);

  const nameKey = normalizeNameKey(row.name);
  const conflictUrl = index.nameOwners.get(nameKey);
  if (conflictUrl) return finish('name-conflict', `桌面侧已有同名供应商，但地址是 ${conflictUrl}`);
  index.nameOwners.set(nameKey, baseUrl);
  return item;
}

function buildSyncPlan({ claudeRows = [], desktopRows = [] } = {}) {
  const index = { takenUrlKeys: new Set(), takenIds: new Set(), urlOwners: new Map(), nameOwners: new Map() };
  for (const row of desktopRows) {
    index.takenIds.add(row.id);
    const urlKey = normalizeUrlKey(baseUrlOf(row));
    if (urlKey && !index.takenUrlKeys.has(urlKey)) {
      index.takenUrlKeys.add(urlKey);
      index.urlOwners.set(urlKey, `桌面侧已有相同 Base URL：${row.name}`);
    }
    const nameKey = normalizeNameKey(row.name);
    if (nameKey && !index.nameOwners.has(nameKey)) index.nameOwners.set(nameKey, baseUrlOf(row) || '（未配置地址）');
  }
  return claudeRows
    .filter((row) => !row.appType || row.appType === CLAUDE_APP_TYPE)
    .map((row) => planItemFor(row, index));
}

// 界面只需要展示字段，desktopRow 里带着 token，绝不跨 IPC。
function toPlanView(item) {
  const { desktopRow, ...view } = item;
  return view;
}

module.exports = {
  CLAUDE_APP_TYPE,
  DEFAULT_PROXY_ROUTES,
  DESKTOP_APP_TYPE,
  baseUrlOf,
  buildDesktopRow,
  buildSyncPlan,
  canGoDirect,
  claudeModelsAreSafe,
  decideDesktopMode,
  desktopIdFor,
  directBlockReason,
  isClaudeSafeModelId,
  normalizeProviderRow,
  normalizeUrlKey,
  stripOneMMarker,
  suggestRoutes,
  toPlanView,
};

