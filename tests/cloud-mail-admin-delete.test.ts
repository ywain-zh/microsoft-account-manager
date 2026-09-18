import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import app from '../server/app.js';

async function createHarness(
  t: TestContext,
  options: { identity?: unknown; identityCode?: number; deleteCode?: number } = {}
) {
  const writes: Array<{ query: string; values: unknown[] }> = [];
  const remoteCalls: Array<{ path: string; method: string; userIds: string | null }> = [];
  const config = {
    apiBaseUrl: 'https://cloud-mail.example.test',
    adminEmail: 'admin@example.test',
    adminPassword: 'test-password',
    availableDomains: ['example.test']
  };
  const database = {
    prepare(query: string) {
      function statement(values: unknown[] = []) {
        return {
          bind: (...bound: unknown[]) => statement(bound),
          async first() {
            assert.match(query, /SELECT value FROM app_settings/);
            assert.deepEqual(values, ['cloud_mail_config']);
            return { value: JSON.stringify(config) };
          },
          async run() {
            writes.push({ query, values });
            return { success: true, results: [], meta: { changes: 1 } };
          }
        };
      }
      return statement();
    }
  };
  const env = {
    DB: database as unknown as D1Database,
    ASSETS: { fetch: async () => new Response('', { status: 404 }) },
    ADMIN_USERNAME: 'test-admin',
    ADMIN_PASSWORD: 'test-login-password',
    SESSION_SECRET: 'test-session-secret-for-admin-deletion'
  };

  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, config.apiBaseUrl);
    remoteCalls.push({ path: url.pathname, method: init?.method ?? 'GET', userIds: url.searchParams.get('userIds') });
    if (url.pathname === '/api/login') {
      return Response.json({ code: 200, data: 'test-admin-token' });
    }
    assert.equal(new Headers(init?.headers).get('Authorization'), 'test-admin-token');
    if (url.pathname === '/api/my/loginUserInfo') {
      const identity = Object.hasOwn(options, 'identity')
        ? options.identity
        : { userId: 477, email: config.adminEmail };
      return Response.json({ code: options.identityCode ?? 200, data: identity, message: 'identity unavailable' });
    }
    assert.equal(url.pathname, '/api/user/delete');
    assert.equal(init?.method, 'DELETE');
    return Response.json({ code: options.deleteCode ?? 200, message: '管理员邮箱禁止删除' });
  });

  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD })
  }, env);
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);

  return {
    writes,
    remoteCalls,
    deleteAccounts: (userIds: number[]) => app.request('/api/cloud-mail/accounts/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ userIds })
    }, env)
  };
}

function assertNothingDeleted(harness: Awaited<ReturnType<typeof createHarness>>) {
  assert.equal(harness.remoteCalls.some(call => call.method === 'DELETE'), false);
  assert.deepEqual(harness.writes, []);
}

test('rejects deleting the administrator without forwarding or clearing local data', async t => {
  const harness = await createHarness(t);
  const response = await harness.deleteAccounts([477]);
  assert.equal(response.status, 403);
  assert.match((await response.json()).message, /管理员邮箱禁止删除/);
  assertNothingDeleted(harness);
});

test('rejects the entire mixed batch before any ordinary user is deleted', async t => {
  const harness = await createHarness(t);
  const response = await harness.deleteAccounts([177, 477, 178]);
  assert.equal(response.status, 403);
  assertNothingDeleted(harness);
});

test('protects the live administrator ID after account recreation and normalizes its email', async t => {
  const harness = await createHarness(t, { identity: { userId: 900, email: ' ADMIN@EXAMPLE.TEST ' } });
  const response = await harness.deleteAccounts([900]);
  assert.equal(response.status, 403);
  assertNothingDeleted(harness);
});

test('still forwards ordinary deletions and cleans their cache, remarks, and shares', async t => {
  const harness = await createHarness(t);
  const response = await harness.deleteAccounts([177, 178]);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, total: 2, deleted: 2, skipped: 0 });
  assert.deepEqual(harness.remoteCalls.map(call => call.path), [
    '/api/login', '/api/my/loginUserInfo', '/api/user/delete'
  ]);
  assert.equal(harness.remoteCalls.at(-1)?.userIds, '177,178');
  assert.equal(harness.writes.length, 3);
  assert.match(harness.writes[0].query, /DELETE FROM cloud_mail_account_cache/);
  assert.match(harness.writes[1].query, /DELETE FROM cloud_mail_account_remarks/);
  assert.match(harness.writes[2].query, /UPDATE cloud_mail_shares/);
  for (const write of harness.writes) {
    assert.deepEqual(write.values.slice(-2), [177, 178]);
  }
});

for (const [name, identity] of [
  ['missing', null],
  ['invalid ID', { userId: '477bad', email: 'admin@example.test' }],
  ['wrong email', { userId: 477, email: 'member@example.test' }]
] as const) {
  test(`refuses deletion when the administrator identity is ${name}`, async t => {
    const harness = await createHarness(t, { identity });
    const response = await harness.deleteAccounts([177]);
    assert.equal(response.status, 502);
    assertNothingDeleted(harness);
  });
}

test('does not delete anything when the administrator lookup fails', async t => {
  const harness = await createHarness(t, { identityCode: 401 });
  const response = await harness.deleteAccounts([177]);
  assert.equal(response.status, 400);
  assertNothingDeleted(harness);
});

test('preserves local data when Cloud Mail refuses a forwarded deletion', async t => {
  const harness = await createHarness(t, { deleteCode: 403 });
  const response = await harness.deleteAccounts([177]);
  assert.equal(response.status, 400);
  assert.deepEqual(harness.writes, []);
});
