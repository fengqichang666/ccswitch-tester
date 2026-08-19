const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRequest,
  classifyError,
  defaultModel,
  endpointFor,
  migrateProviderState,
  networkErrorDetails,
  parseClaude,
  parseCodex,
  parseProviderKey,
  providerKey,
  proxyUrlFromRule,
  responseText,
} = require('../src/core');

test('parses Codex TOML and chooses Responses by default', () => {
  const parsed = parseCodex({
    auth: { OPENAI_API_KEY: 'secret' },
    config: 'model_provider = "demo"\nmodel = "configured"\n[model_providers.demo]\nbase_url = "https://example.com/v1"',
  });
  assert.equal(parsed.key, 'secret');
  assert.equal(parsed.baseUrl, 'https://example.com/v1');
  assert.equal(parsed.configuredModel, 'configured');
  assert.equal(parsed.protocol, 'openai-responses');
});

test('parses Claude token and model configuration', () => {
  const parsed = parseClaude({ env: {
    ANTHROPIC_AUTH_TOKEN: 'secret',
    ANTHROPIC_BASE_URL: 'https://claude.example/v1',
    ANTHROPIC_MODEL: 'configured',
  } }, {}, 'claude');
  assert.equal(parsed.keyKind, 'auth-token');
  assert.equal(parsed.baseUrl, 'https://claude.example/v1');
  assert.equal(parsed.configuredModel, 'configured');
});

test('normalizes endpoint paths without duplicating v1', () => {
  assert.equal(endpointFor('https://example.com/v1/', '/responses'), 'https://example.com/v1/responses');
  assert.equal(endpointFor('https://example.com', '/responses'), 'https://example.com/v1/responses');
  assert.equal(endpointFor('https://example.com/v1', '/v1/messages'), 'https://example.com/v1/messages');
});

test('uses user-approved default model ids', () => {
  assert.equal(defaultModel('codex'), 'gpt-5.6-sol');
  assert.equal(defaultModel('claude'), 'claude-opus-5');
});

test('builds Anthropic and OpenAI requests with the expected auth', () => {
  const claude = buildRequest({ group: 'claude', baseUrl: 'https://example.com/v1', key: 'a', keyKind: 'api-key' }, 'claude-opus-5', 'hello');
  assert.equal(claude.endpoint, 'https://example.com/v1/messages');
  assert.equal(claude.headers['x-api-key'], 'a');
  assert.equal(claude.headers['user-agent'], 'claude-cli/2.1.227 (external, cli)');
  assert.equal(claude.headers['x-app'], 'cli');
  assert.equal(claude.headers['anthropic-client-platform'], 'claude_code_cli');
  assert.match(claude.headers['x-claude-code-session-id'], /^[0-9a-f-]{36}$/i);
  assert.equal(claude.body.max_tokens, 64);

  const codex = buildRequest({ group: 'codex', protocol: 'openai-responses', baseUrl: 'https://example.com/v1', key: 'b' }, 'gpt-5.6-sol', 'hello');
  assert.equal(codex.endpoint, 'https://example.com/v1/responses');
  assert.equal(codex.headers.authorization, 'Bearer b');
  assert.match(codex.headers['user-agent'], /^codex_cli_rs\//);
  assert.equal(codex.headers.originator, 'codex_cli_rs');
  assert.equal(codex.headers['session-id'], codex.headers['thread-id']);
  assert.equal(codex.headers['thread-id'], codex.headers['x-client-request-id']);
  assert.equal(codex.body.max_output_tokens, 64);
});

test('reports underlying transport errors instead of plain fetch failed', () => {
  const error = new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND example.invalid'), { code: 'ENOTFOUND' }) });
  assert.equal(classifyError(error, 0), 'DNS 解析失败');
  assert.match(networkErrorDetails(error), /ENOTFOUND/);
  assert.match(networkErrorDetails(error), /example\.invalid/);
});

test('extracts an HTTP proxy from Windows proxy resolution rules', () => {
  assert.equal(proxyUrlFromRule('PROXY 127.0.0.1:7890; DIRECT'), 'http://127.0.0.1:7890');
  assert.equal(proxyUrlFromRule('DIRECT'), '');
});

test('extracts text from supported response shapes', () => {
  assert.equal(responseText({ content: [{ type: 'text', text: 'claude' }] }), 'claude');
  assert.equal(responseText({ output: [{ content: [{ type: 'output_text', text: 'codex' }] }] }), 'codex');
  assert.equal(responseText({ choices: [{ message: { content: 'chat' } }] }), 'chat');
});

test('uses app type and id together as the provider identity', () => {
  const key = providerKey('claude', 'shared:id');
  assert.equal(key, 'claude:shared%3Aid');
  assert.deepEqual(parseProviderKey(key), { appType: 'claude', id: 'shared:id' });
  assert.equal(parseProviderKey('legacy-id'), null);
});

test('migrates legacy provider state only when the id is unambiguous', () => {
  const legacy = {
    prompts: [],
    histories: { unique: [{ id: 'history' }], shared: [{ id: 'ambiguous' }] },
    modelOverrides: { unique: 'custom-model', shared: 'wrong-for-some-provider' },
  };
  const providers = [
    { id: 'unique', appType: 'claude', providerKey: providerKey('claude', 'unique') },
    { id: 'shared', appType: 'claude', providerKey: providerKey('claude', 'shared') },
    { id: 'shared', appType: 'codex', providerKey: providerKey('codex', 'shared') },
  ];
  const migrated = migrateProviderState(legacy, providers);
  assert.equal(migrated.changed, true);
  assert.deepEqual(migrated.state.histories['claude:unique'], [{ id: 'history' }]);
  assert.equal(migrated.state.modelOverrides['claude:unique'], 'custom-model');
  assert.deepEqual(migrated.state.histories.shared, [{ id: 'ambiguous' }]);
  assert.equal(migrated.state.histories['claude:shared'], undefined);
  assert.equal(migrated.state.histories['codex:shared'], undefined);
});
