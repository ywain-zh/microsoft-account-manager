import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parsePublicCheckinRewardAmount,
  publicCheckinTestHooks
} from '../server/runtime/public-checkin.ts';

process.env.PUBLIC_CHECKIN_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

test('normalizes raw headers into a safe Cookie header', () => {
  const cookie = publicCheckinTestHooks.normalizeCookieHeader(`
    Host: example.test
    Cookie: session=abc; theme=dark
    New-Api-User: 42
    cf_clearance=token
  `);

  assert.equal(cookie, 'session=abc; theme=dark; cf_clearance=token');
});

test('extracts New-Api-User from pasted headers', () => {
  assert.equal(
    publicCheckinTestHooks.extractPlatformUserIdFromHeaders('Cookie: a=b\nNew-Api-User: 10086'),
    10086
  );
});

test('normalizes cookie credential with injected platform user id', () => {
  const credential = publicCheckinTestHooks.normalizeCredentialInput({
    type: 'cookie',
    cookie: 'Cookie: session=abc\nNew-Api-User: 77'
  });

  assert.deepEqual(credential, {
    type: 'cookie',
    cookie: 'session=abc',
    platformUserId: 77
  });
});

test('encrypts and decrypts credentials with AES-256-GCM', () => {
  const plaintext = JSON.stringify({ type: 'access_token', accessToken: 'sk-test' });
  const encrypted = publicCheckinTestHooks.encryptCredential(plaintext);

  assert.notEqual(encrypted, plaintext);
  assert.equal(publicCheckinTestHooks.decryptCredentialText(encrypted), plaintext);
});

test('decrypts stored model api key with the same encryption helper', () => {
  const encrypted = publicCheckinTestHooks.encryptCredential('sk-model-test');

  assert.equal(
    publicCheckinTestHooks.decryptAccountApiKey({ api_key_data: encrypted }),
    'sk-model-test'
  );
  assert.equal(publicCheckinTestHooks.decryptAccountApiKey({ api_key_data: null }), '');
});

test('parses reward amounts from common CheckinHub messages', () => {
  assert.equal(parsePublicCheckinRewardAmount('签到成功，获得 1,024 点额度'), 1024);
  assert.equal(parsePublicCheckinRewardAmount('reward +3.5'), 3.5);
  assert.equal(parsePublicCheckinRewardAmount('今天已经签到过了'), undefined);
});

test('infers checkin reward from positive balance delta', () => {
  assert.equal(publicCheckinTestHooks.inferPublicCheckinRewardFromBalanceDelta(18.00, 18.50), 0.5);
  assert.equal(publicCheckinTestHooks.inferPublicCheckinRewardFromBalanceDelta(18.00, 18.00), null);
  assert.equal(publicCheckinTestHooks.inferPublicCheckinRewardFromBalanceDelta(18.50, 18.00), null);
  assert.equal(publicCheckinTestHooks.inferPublicCheckinRewardFromBalanceDelta(null, 18.50), null);
  assert.equal(publicCheckinTestHooks.inferPublicCheckinRewardFromBalanceDelta(18.00, Number.NaN), null);
  assert.equal(publicCheckinTestHooks.inferPublicCheckinRewardFromBalanceDelta(0.1, 0.3), 0.2);
});

test('parses public checkin balances with NewAPI quota units', () => {
  assert.equal(publicCheckinTestHooks.parseBalancePayload({ success: true, data: { balance: 1000000001319, quota: 9000000 } }), 18);
  assert.equal(publicCheckinTestHooks.parseBalancePayload({ success: true, data: { quota: 500000 } }), 1);
  assert.equal(publicCheckinTestHooks.parseBalancePayload({ success: true, data: { balance: 18.5 } }), 18.5);
  assert.equal(publicCheckinTestHooks.parseBalancePayload({ success: true, data: { balance: 1000000 } }), 2);
  assert.equal(publicCheckinTestHooks.parseBalancePayload({ success: true, data: { balance: null, quota: null } }), undefined);
});

test('extracts OpenAI compatible model ids from mixed payloads', () => {
  assert.deepEqual(
    publicCheckinTestHooks.extractModelIds({
      data: [{ id: 'gpt-5.4' }, { id: 'gpt-5.4-mini' }, { id: 'gpt-5.4' }, 'claude-haiku']
    }),
    ['gpt-5.4', 'gpt-5.4-mini', 'claude-haiku']
  );
});

test('sorts public checkin models by vendor priority then natural order', () => {
  assert.deepEqual(
    publicCheckinTestHooks.sortPublicCheckinModelIds([
      'o4-mini',
      'claude-sonnet-4-20250514',
      'gemini-2.5-pro',
      'gpt-5.5-pro',
      'deepseek-chat',
      'gpt-4.1',
      'claude-opus-4-8',
      'Gemini-2.0-flash',
      'DeepSeek-reasoner',
      'gpt-4',
      'codex-mini'
    ]),
    [
      'gpt-4',
      'gpt-4.1',
      'gpt-5.5-pro',
      'claude-opus-4-8',
      'claude-sonnet-4-20250514',
      'Gemini-2.0-flash',
      'gemini-2.5-pro',
      'deepseek-chat',
      'DeepSeek-reasoner',
      'codex-mini',
      'o4-mini'
    ]
  );
});

test('keeps non-gpt OpenAI models in the fallback group', () => {
  assert.deepEqual(
    publicCheckinTestHooks.sortPublicCheckinModelIds([
      'o3-deep-research',
      'claude-3.5-sonnet',
      'gpt-5-mini',
      'codex-1',
      'gemini-1.5-pro'
    ]),
    [
      'gpt-5-mini',
      'claude-3.5-sonnet',
      'gemini-1.5-pro',
      'codex-1',
      'o3-deep-research'
    ]
  );
});

test('normalizes system proxy urls before request usage', () => {
  assert.equal(publicCheckinTestHooks.getProxyUrl('http:/127.0.0.1:7897'), 'http://127.0.0.1:7897/');
  assert.equal(publicCheckinTestHooks.getProxyUrl('https://127.0.0.1:7897'), 'https://127.0.0.1:7897/');
});

test('preserves upstream JSON message without HTTP prefix', () => {
  assert.throws(
    () => publicCheckinTestHooks.parseJsonResponsePayload({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Map(),
      text: '{"message":"无权进行此操作，New-Api-User 格式错误","success":false}'
    }),
    { message: '无权进行此操作，New-Api-User 格式错误' }
  );
});

test('preserves upstream nested error message without HTTP prefix', () => {
  assert.throws(
    () => publicCheckinTestHooks.parseJsonResponsePayload({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Map(),
      text: '{"error":{"message":"access token 无效"}}'
    }),
    { message: 'access token 无效' }
  );
});

test('falls back to HTTP status when upstream JSON has no message', () => {
  assert.throws(
    () => publicCheckinTestHooks.parseJsonResponsePayload({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      headers: new Map(),
      setCookieHeaders: [],
      text: '{"success":false}'
    }),
    { message: 'HTTP 502: Bad Gateway' }
  );
});

test('merges shield Set-Cookie values into existing cookie header', () => {
  const merged = publicCheckinTestHooks.mergeSetCookieValues(
    'session=abc; acw_tc=old; acw_sc__v2=oldv2',
    [
      'acw_tc=new; Path=/; HttpOnly',
      'cdn_sec_tc=cdn; Path=/',
      'acw_sc__v2=newv2; Path=/'
    ]
  );

  const values = Object.fromEntries(
    merged.split(';').map((part) => {
      const [name, ...rest] = part.trim().split('=');
      return [name, rest.join('=')];
    })
  );
  assert.deepEqual(values, {
    session: 'abc',
    acw_tc: 'new',
    cdn_sec_tc: 'cdn',
    acw_sc__v2: 'newv2'
  });
});

test('infers Any Router platform from name or URL', () => {
  assert.equal(
    publicCheckinTestHooks.inferPublicCheckinPlatform({
      name: 'Any Router',
      url: 'https://anyrouter.top',
      platform: 'new-api'
    }),
    'anyrouter'
  );
});

test('stores Any Router sites as NewAPI-compatible platform', () => {
  assert.equal(publicCheckinTestHooks.toStoredPublicCheckinPlatform('anyrouter'), 'new-api');
  assert.equal(publicCheckinTestHooks.toStoredPublicCheckinPlatform('new-api'), 'new-api');
  assert.equal(publicCheckinTestHooks.toStoredPublicCheckinPlatform('one-api'), 'one-api');
  assert.equal(publicCheckinTestHooks.toStoredPublicCheckinPlatform('onehub'), 'onehub');
});

test('Any Router cookie auth only sends Cookie and New-Api-User', () => {
  const adapter = publicCheckinTestHooks.createAdapter('anyrouter', 'https://anyrouter.top', {});
  const headers = (adapter as unknown as {
    buildAuthHeaders(credential: unknown): Record<string, string>;
  }).buildAuthHeaders({
    type: 'cookie',
    cookie: 'session=abc; acw_sc__v2=shield',
    platformUserId: 174837
  });

  assert.deepEqual(headers, {
    Cookie: 'session=abc; acw_sc__v2=shield',
    'New-Api-User': '174837'
  });
});

test('Any Router adapter is still selected when stored platform is NewAPI', () => {
  const adapter = publicCheckinTestHooks.createAdapter('new-api', 'https://example.com', {}, 'Any Router');
  const headers = (adapter as unknown as {
    buildAuthHeaders(credential: unknown): Record<string, string>;
  }).buildAuthHeaders({
    type: 'cookie',
    cookie: 'session=abc; acw_sc__v2=shield',
    platformUserId: 174837
  });

  assert.deepEqual(headers, {
    Cookie: 'session=abc; acw_sc__v2=shield',
    'New-Api-User': '174837'
  });
});

test('NewAPI auth does not duplicate New-Api-User with case variants', () => {
  const adapter = publicCheckinTestHooks.createAdapter('new-api', 'https://ai.venlacy.com', {});
  const headers = (adapter as unknown as {
    buildAuthHeaders(credential: unknown): Record<string, string>;
  }).buildAuthHeaders({
    type: 'access_token',
    accessToken: 'sk-test',
    platformUserId: 4203
  });

  assert.equal(headers['New-Api-User'], '4203');
  assert.equal(headers['New-API-User'], undefined);
});

test('validates supported cron expressions', () => {
  assert.equal(publicCheckinTestHooks.validateCronExpression('0 8 * * *'), true);
  assert.equal(publicCheckinTestHooks.validateCronExpression('*/15 0-23 * * 1-5'), true);
  assert.equal(publicCheckinTestHooks.validateCronExpression('invalid cron'), false);
});
