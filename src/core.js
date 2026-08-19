const TOML = require('@iarna/toml');
const crypto = require('node:crypto');

const CODEX_ORIGINATOR = 'codex_cli_rs';
const CODEX_USER_AGENT = 'codex_cli_rs/0.148.0-alpha.9 (Windows 11 10.0; x86_64) Codex Desktop';
const CLAUDE_CODE_USER_AGENT = 'claude-cli/2.1.227 (external, cli)';

function parseJson(value, fallback = {}) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function providerKey(appType, id) {
  return `${encodeURIComponent(String(appType || ''))}:${encodeURIComponent(String(id || ''))}`;
}

function parseProviderKey(value) {
  const raw = String(value || '');
  const separator = raw.indexOf(':');
  if (separator <= 0 || separator === raw.length - 1) return null;
  try {
    const appType = decodeURIComponent(raw.slice(0, separator));
    const id = decodeURIComponent(raw.slice(separator + 1));
    return appType && id ? { appType, id } : null;
  } catch {
    return null;
  }
}

function migrateProviderState(state, providers) {
  const next = {
    prompts: Array.isArray(state?.prompts) ? state.prompts : [],
    histories: { ...(state?.histories || {}) },
    modelOverrides: { ...(state?.modelOverrides || {}) },
  };
  const counts = new Map();
  for (const provider of providers || []) counts.set(provider.id, (counts.get(provider.id) || 0) + 1);
  let changed = false;
  for (const provider of providers || []) {
    if (counts.get(provider.id) !== 1) continue;
    const key = provider.providerKey || providerKey(provider.appType, provider.id);
    for (const field of ['histories', 'modelOverrides']) {
      if (!Object.hasOwn(next[field], key) && Object.hasOwn(next[field], provider.id)) {
        next[field][key] = next[field][provider.id];
        delete next[field][provider.id];
        changed = true;
      }
    }
  }
  return { state: next, changed };
}

function parseCodex(settings) {
  const auth = settings?.auth || {};
  const configText = settings?.config || '';
  let config = {};
  try { config = configText ? TOML.parse(configText) : {}; } catch { config = {}; }

  const selectedProvider = config.model_provider;
  const providerConfig = selectedProvider && config.model_providers?.[selectedProvider]
    ? config.model_providers[selectedProvider]
    : {};
  const baseUrl = providerConfig.base_url || settings?.base_url || '';
  const wireApi = String(config.wire_api || providerConfig.wire_api || '').toLowerCase();
  const apiFormat = String(providerConfig.api_format || '').toLowerCase();
  const protocol = wireApi.includes('chat') || wireApi.includes('completion') || apiFormat.includes('chat')
    ? 'openai-chat'
    : 'openai-responses';
  return {
    key: auth.OPENAI_API_KEY || '',
    baseUrl,
    configuredModel: config.model || providerConfig.model || '',
    protocol,
  };
}

function findNestedModel(value) {
  if (!value || typeof value !== 'object') return '';
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && key.toLowerCase().includes('model') && item.trim()) return item.trim();
    if (item && typeof item === 'object') {
      const found = findNestedModel(item);
      if (found) return found;
    }
  }
  return '';
}

function parseClaude(settings, meta, appType) {
  const env = settings?.env || {};
  const configuredModel = env.ANTHROPIC_MODEL || env.ANTHROPIC_DEFAULT_SONNET_MODEL
    || env.ANTHROPIC_DEFAULT_OPUS_MODEL || env.ANTHROPIC_DEFAULT_HAIKU_MODEL
    || (appType === 'claude-desktop' ? findNestedModel(meta) : '');
  return {
    key: env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '',
    keyKind: env.ANTHROPIC_API_KEY ? 'api-key' : 'auth-token',
    baseUrl: env.ANTHROPIC_BASE_URL || '',
    configuredModel,
    protocol: 'anthropic-messages',
  };
}

function defaultModel(group) {
  return group === 'codex' ? 'gpt-5.6-sol' : 'claude-opus-5';
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return `${key.slice(0, 2)}...`;
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function endpointFor(baseUrl, pathSuffix) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return '';
  if (base.endsWith('/v1') && pathSuffix.startsWith('/v1')) return `${base}${pathSuffix.slice(3)}`;
  if (!base.endsWith('/v1') && pathSuffix.startsWith('/v1')) return `${base}${pathSuffix}`;
  if (base.endsWith('/v1') && !pathSuffix.startsWith('/v1')) return `${base}${pathSuffix}`;
  return `${base}/v1${pathSuffix}`;
}

function classifyError(error, status) {
  if (status === 401 || status === 403) return '凭证无效或无权限';
  if (status === 404) return '接口路径或模型不存在';
  if (status === 408 || status === 429) return '超时或触发限流';
  if (status >= 500) return '供应商服务端错误';
  if (error?.name === 'AbortError') return '请求超时';
  const code = error?.cause?.code || error?.code || '';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS 解析失败';
  if (code === 'ECONNREFUSED') return '连接被拒绝';
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return '连接被远端重置';
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT') return '连接超时';
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return '网络不可达';
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return 'TLS 证书错误';
  if (error?.message) return '网络请求失败';
  return '请求失败';
}

function networkErrorDetails(error) {
  const cause = error?.cause;
  const code = cause?.code || error?.code || '';
  const outerMessage = String(error?.message || '').trim();
  const causeMessage = String(cause?.message || '').trim();
  const details = [];
  if (code) details.push(code);
  if (causeMessage && causeMessage !== outerMessage) details.push(causeMessage);
  if (outerMessage && outerMessage !== 'fetch failed') details.push(outerMessage);
  return details.length ? [...new Set(details)].join('：') : 'fetch failed（未返回更具体的底层原因）';
}

function proxyUrlFromRule(rule) {
  for (const part of String(rule || '').split(';').map((item) => item.trim())) {
    const match = part.match(/^(?:PROXY|HTTPS?|HTTP)\s+(.+)$/i);
    if (match) return `http://${match[1]}`;
  }
  return '';
}

function responseText(payload) {
  if (!payload) return '';
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload.content)) return payload.content.map((part) => typeof part === 'string' ? part : part?.text || '').join('');
  if (typeof payload.output_text === 'string') return payload.output_text;
  if (Array.isArray(payload.output)) return payload.output.flatMap((item) => item?.content || []).map((part) => part?.text || '').join('');
  if (typeof payload.choices?.[0]?.message?.content === 'string') return payload.choices[0].message.content;
  if (Array.isArray(payload.choices?.[0]?.message?.content)) return payload.choices[0].message.content.map((part) => part?.text || '').join('');
  return '';
}

function buildRequest(provider, model, prompt) {
  const headers = { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'CCSwitch-Tester' };
  let endpoint;
  let body;
  if (provider.group === 'claude') {
    const sessionId = crypto.randomUUID();
    endpoint = endpointFor(provider.baseUrl, '/messages');
    headers['anthropic-version'] = '2023-06-01';
    headers['user-agent'] = CLAUDE_CODE_USER_AGENT;
    headers['x-app'] = 'cli';
    headers['anthropic-client-platform'] = 'claude_code_cli';
    headers['x-claude-code-session-id'] = sessionId;
    if (provider.keyKind === 'api-key') headers['x-api-key'] = provider.key;
    else headers.authorization = `Bearer ${provider.key}`;
    body = { model, max_tokens: 64, messages: [{ role: 'user', content: prompt }] };
  } else if (provider.protocol === 'openai-chat') {
    endpoint = endpointFor(provider.baseUrl, '/chat/completions');
    headers.authorization = `Bearer ${provider.key}`;
    body = { model, max_tokens: 64, stream: false, messages: [{ role: 'user', content: prompt }] };
  } else {
    const requestId = crypto.randomUUID();
    endpoint = endpointFor(provider.baseUrl, '/responses');
    headers.authorization = `Bearer ${provider.key}`;
    headers['user-agent'] = CODEX_USER_AGENT;
    headers.originator = CODEX_ORIGINATOR;
    headers['session-id'] = requestId;
    headers['thread-id'] = requestId;
    headers['x-client-request-id'] = requestId;
    body = { model, max_output_tokens: 64, store: false, input: prompt };
  }
  return { endpoint, headers, body };
}

module.exports = {
  buildRequest,
  classifyError,
  defaultModel,
  endpointFor,
  maskKey,
  migrateProviderState,
  networkErrorDetails,
  normalizeBaseUrl,
  parseClaude,
  parseCodex,
  parseJson,
  parseProviderKey,
  providerKey,
  proxyUrlFromRule,
  responseText,
};
