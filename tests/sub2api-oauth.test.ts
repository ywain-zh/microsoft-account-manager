import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOpenAiCredentials,
  generateSub2ApiOpenAiOAuth,
  parseLocalhostCallback,
  submitSub2ApiOpenAiOAuthCallback,
  type Sub2ApiOAuthDraft
} from '../server/runtime/sub2api-oauth.ts';

const config = {
  baseUrl: 'https://sub2api.example',
  adminApiKey: 'admin-secret'
};

const reauthConfig = {
  authMode: 'admin-api-key' as const,
  adminEmail: '',
  adminPassword: '',
  groupNames: ['openai-plus'],
  defaultProxyName: '',
  accountPriority: 7,
  updateExisting: true,
  autoPauseOnExpired: true,
  verifyAfterImport: true,
  strictEmailMatch: true,
  allowAccessTokenOnly: false
};

const draft: Sub2ApiOAuthDraft = {
  oauthUrl: 'https://auth.openai.com/oauth?state=expected-state',
  sessionId: 'session-1',
  oauthState: 'expected-state',
  groupIds: [11, 12],
  groupLabel: 'openai-plus（#11）',
  draftName: 'openai-plus-draft',
  proxyId: 5,
  proxyLabel: 'proxy #5'
};

test('parseLocalhostCallback accepts localhost auth callback', () => {
  const callback = parseLocalhostCallback('http://localhost:1455/auth/callback?code=code-1&state=state-1');
  assert.equal(callback.code, 'code-1');
  assert.equal(callback.state, 'state-1');
});

test('parseLocalhostCallback rejects state-less callbacks', () => {
  assert.throws(
    () => parseLocalhostCallback('http://localhost:1455/auth/callback?code=code-1'),
    /缺少 code 或 state/
  );
});

test('buildOpenAiCredentials requires access token', () => {
  assert.throws(() => buildOpenAiCredentials({ refresh_token: 'refresh' }), /未返回 access_token/);
  assert.deepEqual(buildOpenAiCredentials({
    access_token: 'access',
    refresh_token: 'refresh',
    ignored: 'nope'
  }), {
    access_token: 'access',
    refresh_token: 'refresh'
  });
});

test('generateSub2ApiOpenAiOAuth resolves groups, proxy, and auth url draft', async () => {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init = {}) => {
    const headers = new Headers(init.headers);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as unknown : init.body;
    calls.push({
      url: String(url),
      body,
      headers: Object.fromEntries(headers.entries())
    });

    const pathname = new URL(String(url)).pathname;
    if (pathname === '/api/v1/admin/groups/all') {
      return jsonResponse({
        code: 0,
        data: [
          { id: 11, name: 'openai-plus', platform: 'openai' },
          { id: 22, name: 'other', platform: 'openai' }
        ]
      });
    }
    if (pathname === '/api/v1/admin/proxies/all') {
      return jsonResponse({
        code: 0,
        data: [
          { id: 5, name: 'proxy-main', protocol: 'http', host: '127.0.0.1', port: '7890', status: 'active' }
        ]
      });
    }
    if (pathname === '/api/v1/admin/openai/generate-auth-url') {
      return jsonResponse({
        code: 0,
        data: {
          auth_url: 'https://auth.openai.com/oauth?state=state-from-url',
          session_id: 'session-1'
        }
      });
    }
    return jsonResponse({ code: 1, message: `unexpected ${pathname}` }, 404);
  }) as typeof fetch;

  try {
    const draftResult = await generateSub2ApiOpenAiOAuth({
      sub2apiConfig: config,
      reauthConfig: {
        ...reauthConfig,
        defaultProxyName: 'proxy-main'
      },
      onLog: () => undefined
    });

    assert.equal(draftResult.oauthUrl, 'https://auth.openai.com/oauth?state=state-from-url');
    assert.equal(draftResult.sessionId, 'session-1');
    assert.equal(draftResult.oauthState, 'state-from-url');
    assert.deepEqual(draftResult.groupIds, [11]);
    assert.equal(draftResult.proxyId, 5);
    assert.equal(calls.length, 3);
    assert.equal(calls[0]?.headers['x-api-key'], 'admin-secret');
    assert.deepEqual(calls[2]?.body, {
      redirect_uri: 'http://localhost:1455/auth/callback',
      proxy_id: 5
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('submitSub2ApiOpenAiOAuthCallback exchanges code and creates account', async () => {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init = {}) => {
    const headers = new Headers(init.headers);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) as unknown : init.body;
    calls.push({
      url: String(url),
      body,
      headers: Object.fromEntries(headers.entries())
    });

    const pathname = new URL(String(url)).pathname;
    if (pathname === '/api/v1/admin/openai/exchange-code') {
      return jsonResponse({
        code: 0,
        data: {
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          email: 'target@example.com',
          name: 'Target'
        }
      });
    }
    if (pathname === '/api/v1/admin/accounts') {
      return jsonResponse({ code: 0, data: { id: 99, name: 'target@example.com' } });
    }
    return jsonResponse({ code: 1, message: `unexpected ${pathname}` }, 404);
  }) as typeof fetch;

  try {
    const result = await submitSub2ApiOpenAiOAuthCallback({
      sub2apiConfig: config,
      reauthConfig,
      draft,
      callbackUrl: 'http://localhost:1455/auth/callback?code=callback-code&state=expected-state',
      accountEmail: 'target@example.com',
      onLog: () => undefined
    });

    assert.equal(result.accountId, 99);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.headers['x-api-key'], 'admin-secret');
    assert.deepEqual(calls[0]?.body, {
      session_id: 'session-1',
      code: 'callback-code',
      state: 'expected-state',
      proxy_id: 5
    });
    assert.deepEqual(calls[1]?.body, {
      name: 'target@example.com',
      notes: '',
      platform: 'openai',
      type: 'oauth',
      credentials: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        email: 'target@example.com'
      },
      concurrency: 10,
      priority: 7,
      rate_multiplier: 1,
      group_ids: [11, 12],
      auto_pause_on_expired: true,
      proxy_id: 5,
      extra: {
        email: 'target@example.com',
        name: 'Target'
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('submitSub2ApiOpenAiOAuthCallback rejects mismatched state before remote calls', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return jsonResponse({});
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => submitSub2ApiOpenAiOAuthCallback({
        sub2apiConfig: config,
        reauthConfig,
        draft,
        callbackUrl: 'http://localhost:1455/auth/callback?code=callback-code&state=wrong-state',
        accountEmail: 'target@example.com',
        onLog: () => undefined
      }),
      /state 与步骤 4 生成的 state 不一致/
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
