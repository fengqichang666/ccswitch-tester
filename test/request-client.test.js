const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { requestProvider } = require('../src/request-client');

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await run(`http://127.0.0.1:${port}/v1`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('sends one Responses request and extracts the answer', async () => {
  let requestCount = 0;
  await withServer((request, response) => {
    requestCount += 1;
    assert.equal(request.url, '/v1/responses');
    assert.equal(request.headers.authorization, 'Bearer secret');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: '测试成功' }] }] }));
  }, async (baseUrl) => {
    const result = await requestProvider({ group: 'codex', protocol: 'openai-responses', baseUrl, key: 'secret' }, 'gpt-5.6-sol', '你好', { timeoutMs: 2000 });
    assert.equal(result.ok, true);
    assert.equal(result.response, '测试成功');
  });
  assert.equal(requestCount, 1);
});

test('keeps provider error details without retrying', async () => {
  let requestCount = 0;
  await withServer((_request, response) => {
    requestCount += 1;
    response.statusCode = 401;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ error: { message: 'invalid key' } }));
  }, async (baseUrl) => {
    const result = await requestProvider({ group: 'claude', baseUrl, key: 'secret', keyKind: 'auth-token' }, 'claude-opus-5', '你好', { timeoutMs: 2000 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(result.errorCategory, '凭证无效或无权限');
    assert.equal(result.error, 'invalid key');
  });
  assert.equal(requestCount, 1);
});

test('returns the underlying connection error and network path', async () => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  const result = await requestProvider({ group: 'codex', protocol: 'openai-responses', baseUrl: `http://127.0.0.1:${port}/v1`, key: 'secret' }, 'gpt-5.6-sol', '你好', { timeoutMs: 2000, proxyLabel: '直连' });
  assert.equal(result.ok, false);
  assert.equal(result.errorCategory, '连接被拒绝');
  assert.match(result.error, /ECONNREFUSED/);
  assert.match(result.error, /网络路径：直连/);
});
