const { fetch, ProxyAgent } = require('undici');
const { buildRequest, classifyError, networkErrorDetails, responseText } = require('./core');

async function requestProvider(provider, model, prompt, options = {}) {
  const timeoutMs = options.timeoutMs || 120000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const { endpoint, headers, body } = buildRequest(provider, model, prompt);
  const dispatcher = options.proxyUrl ? new ProxyAgent(options.proxyUrl) : undefined;
  const started = Date.now();
  try {
    const requestOptions = { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal };
    if (dispatcher) requestOptions.dispatcher = dispatcher;
    const response = await fetch(endpoint, requestOptions);
    const raw = await response.text();
    let payload;
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = raw; }
    const elapsedMs = Date.now() - started;
    if (!response.ok) {
      const message = typeof payload === 'string' ? payload : payload?.error?.message || payload?.message || `HTTP ${response.status}`;
      return { ok: false, status: response.status, elapsedMs, errorCategory: classifyError(null, response.status), error: String(message).slice(0, 500), response: '', networkPath: options.proxyLabel || '直连' };
    }
    return { ok: true, status: response.status, elapsedMs, response: responseText(payload).slice(0, 500), error: '', errorCategory: '', networkPath: options.proxyLabel || '直连' };
  } catch (error) {
    const details = networkErrorDetails(error);
    const networkPath = options.proxyLabel || '直连';
    return { ok: false, status: 0, elapsedMs: Date.now() - started, errorCategory: classifyError(error, 0), error: `${details}；网络路径：${networkPath}`.slice(0, 500), response: '', networkPath };
  } finally {
    clearTimeout(timeout);
    if (dispatcher) await dispatcher.close();
  }
}

module.exports = { requestProvider };
