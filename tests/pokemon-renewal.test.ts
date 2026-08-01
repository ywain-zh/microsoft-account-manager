import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Hono } from 'hono';
import { FormData as UndiciFormData } from 'undici';

import {
  pokemonRenewalTestHooks,
  registerPokemonRenewalRoutes
} from '../server/runtime/pokemon-renewal.ts';
import { SQLiteD1Database } from '../server/runtime/sqlite-d1.ts';

process.env.PUBLIC_CHECKIN_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const SOURCE = Buffer.from('bnN6e2dBV3JrWGx4MDhKNkVxOlY0W2RlTzFEUVRDd20yb0IzdHk5alNZSV03Uk01YkhpVWFmLGN9S3VQR3BOaFpMdkY=', 'base64').toString('utf8');
const TARGET = Buffer.from('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWjAxMjM0NTY3ODksW117fTo=', 'base64').toString('utf8');

function encodeResponse(value: unknown): string {
  let encoded = JSON.stringify(value);
  for (let round = 0; round < 10; round += 1) {
    encoded = Array.from(encoded, (character) => {
      const index = TARGET.indexOf(character);
      return index >= 0 ? SOURCE[index] : character;
    }).join('');
  }
  return Buffer.from(encoded, 'utf8').toString('base64');
}

function response(value: unknown, status = 200): Response {
  return new Response(encodeResponse(value), { status });
}

function createHarness(): { app: Hono<any>; db: SQLiteD1Database; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'pokemon-renewal-test-'));
  const db = new SQLiteD1Database(join(directory, 'test.db'));
  db.raw.exec(`
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.raw.exec(readFileSync(join(process.cwd(), 'migrations/0022_pokemon_renewal.sql'), 'utf8'));
  const app = new Hono<any>();
  registerPokemonRenewalRoutes(app);
  return {
    app,
    db,
    cleanup() {
      pokemonRenewalTestHooks.reset();
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

async function jsonRequest<T>(app: Hono<any>, db: D1Database, path: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const res = await app.request(`http://localhost${path}`, init, { DB: db });
  return { status: res.status, data: await res.json() as T };
}

test('decodes the site response protocol and calculates the frontend-equivalent discount', () => {
  const input = { data: { auth_data: 'token-test', nested: ['a', 1, true] }, message: 'ok' };
  assert.deepEqual(pokemonRenewalTestHooks.decodeResponse(encodeResponse(input)), input);
  assert.equal(pokemonRenewalTestHooks.calculateDiscountedPrice(880, 0, { type: 1, value: 880 }), 0);
  assert.equal(pokemonRenewalTestHooks.calculateDiscountedPrice(1000, 10, { type: 2, value: 100 }), 0);
  assert.equal(pokemonRenewalTestHooks.calculateDiscountedPrice(1000, 10, { type: 1, value: 100 }), 800);
  assert.throws(() => pokemonRenewalTestHooks.calculateDiscountedPrice(880, 0, { type: 3, value: 1 }), /不受支持/);
});

test('stores passwords and coupon encrypted without returning secrets', async () => {
  const harness = createHarness();
  try {
    const created = await jsonRequest<Record<string, unknown>>(harness.app, harness.db, '/api/public-checkin/pokemon/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'trainer@example.com', password: 'secret-password', enabled: true })
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.email, 'trainer@example.com');
    assert.equal('password' in created.data, false);
    assert.equal('passwordData' in created.data, false);

    const storedAccount = harness.db.raw.prepare('SELECT password_data FROM pokemon_renewal_accounts').get() as { password_data: string };
    assert.doesNotMatch(storedAccount.password_data, /secret-password/);

    const config = await jsonRequest<Record<string, unknown>>(harness.app, harness.db, '/api/public-checkin/pokemon/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ couponCode: 'monthly-code' })
    });
    assert.equal(config.status, 200);
    assert.equal(config.data.couponCode, 'monthly-code');
    const storedConfig = harness.db.raw.prepare("SELECT value FROM app_settings WHERE key = 'pokemon_renewal_config'").get() as { value: string };
    assert.doesNotMatch(storedConfig.value, /monthly-code/);
  } finally {
    harness.cleanup();
  }
});

test('serializes login fields with undici FormData and surfaces structured validation errors', async () => {
  const harness = createHarness();
  try {
    await jsonRequest(harness.app, harness.db, '/api/public-checkin/pokemon/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'form@example.com', password: 'multipart-secret', enabled: true })
    });
    await jsonRequest(harness.app, harness.db, '/api/public-checkin/pokemon/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ couponCode: 'free-code' })
    });
    pokemonRenewalTestHooks.setTiming({ betweenAccountsDelayMs: 0 });
    pokemonRenewalTestHooks.setFetch((async (input: string | URL | Request, init?: { body?: unknown }) => {
      const path = new URL(String(input)).pathname;
      assert.match(path, /passport\/auth\/login$/);
      assert.ok(init?.body instanceof UndiciFormData);
      assert.equal(init.body.get('email'), 'form@example.com');
      assert.equal(init.body.get('password'), 'multipart-secret');
      return response({
        message: 'The given data was invalid.',
        errors: { email: ['邮箱不能为空'], password: ['密码不能为空'] }
      }, 422);
    }) as any);

    const started = await jsonRequest<{ id: string }>(harness.app, harness.db, '/api/public-checkin/pokemon/renewal-runs', { method: 'POST' });
    let snapshot: any;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      snapshot = (await jsonRequest<any>(harness.app, harness.db, `/api/public-checkin/pokemon/renewal-runs/${started.data.id}`)).data;
      if (snapshot.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(snapshot.failedCount, 1);
    assert.equal(snapshot.results[0].message, '邮箱不能为空');
  } finally {
    harness.cleanup();
  }
});

test('runs enabled accounts serially, completes a zero order, and skips an already-used coupon', async () => {
  const harness = createHarness();
  const calls: Array<{ path: string; email?: string }> = [];
  const infoCalls = new Map<string, number>();
  let activeEmail = '';
  try {
    for (const email of ['one@example.com', 'two@example.com']) {
      const created = await jsonRequest(harness.app, harness.db, '/api/public-checkin/pokemon/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: `password-${email}`, enabled: true })
      });
      assert.equal(created.status, 201);
    }
    await jsonRequest(harness.app, harness.db, '/api/public-checkin/pokemon/config', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ couponCode: 'shared-code' })
    });

    pokemonRenewalTestHooks.setTiming({ pollIntervalMs: 0, pollTimeoutMs: 100, betweenAccountsDelayMs: 0 });
    pokemonRenewalTestHooks.setFetch((async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      const token = headers.get('authorization') || '';
      if (url.pathname.endsWith('/passport/auth/login')) {
        const form = init?.body as FormData;
        activeEmail = String(form.get('email'));
        calls.push({ path: url.pathname, email: activeEmail });
        return response({ data: { auth_data: `token:${activeEmail}` }, message: '登录成功' });
      }
      const email = token.replace(/^token:/, '') || activeEmail;
      calls.push({ path: url.pathname, email });
      if (url.pathname.endsWith('/user/info')) {
        const count = infoCalls.get(email) || 0;
        infoCalls.set(email, count + 1);
        return response({ data: { expired_at: email.startsWith('one') && count > 0 ? 2_000_000 : 1_000_000, discount: 0 } });
      }
      if (url.pathname.endsWith('/user/order/fetch')) return response({ data: [] });
      if (url.pathname.endsWith('/user/plan/fetch')) return response({ data: { id: 8, month_price: 880 } });
      if (url.pathname.endsWith('/user/coupon/check')) {
        return email.startsWith('two')
          ? response({ data: null, message: '该优惠券每人只能用 1 次' })
          : response({ data: { code: 'shared-code', type: 1, value: 880, limit_period: ['month_price'], limit_plan_ids: ['8'] } });
      }
      if (url.pathname.endsWith('/user/order/save')) return response({ data: 'trade-1' });
      if (url.pathname.endsWith('/user/order/detail')) return response({ data: { trade_no: 'trade-1', total_amount: 0, status: 0 } });
      if (url.pathname.endsWith('/user/order/checkout')) return response({ data: true, message: '订单结账成功' });
      if (url.pathname.endsWith('/user/order/check')) return response({ data: 3 });
      throw new Error(`Unexpected request: ${url.pathname}`);
    }) as any);

    const started = await jsonRequest<{ id: string }>(harness.app, harness.db, '/api/public-checkin/pokemon/renewal-runs', { method: 'POST' });
    assert.equal(started.status, 202);
    let snapshot: any;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      snapshot = (await jsonRequest<any>(harness.app, harness.db, `/api/public-checkin/pokemon/renewal-runs/${started.data.id}`)).data;
      if (snapshot.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(snapshot.status, 'completed');
    assert.deepEqual({ success: snapshot.successCount, skipped: snapshot.skippedCount, failed: snapshot.failedCount }, {
      success: 1, skipped: 1, failed: 0
    });
    assert.equal(snapshot.results[0].status, 'success');
    assert.equal(snapshot.results[0].expiredAtBefore, 1_000_000);
    assert.equal(snapshot.results[0].expiredAtAfter, 2_000_000);
    assert.equal(snapshot.results[1].reasonCode, 'coupon_already_used');
    assert.equal(calls.filter((item) => item.path.endsWith('/user/order/save')).length, 1);
    assert.equal(calls.filter((item) => item.path.endsWith('/user/order/checkout')).length, 1);
    const loginOrder = calls.filter((item) => item.path.endsWith('/passport/auth/login')).map((item) => item.email);
    assert.deepEqual(loginOrder, ['one@example.com', 'two@example.com']);
    assert.doesNotMatch(JSON.stringify(snapshot.logs), /shared-code|password-one|password-two|token:/);
  } finally {
    harness.cleanup();
  }
});

test('does not create an order when the discounted amount is non-zero', async () => {
  const harness = createHarness();
  let orderSaveCalls = 0;
  try {
    await jsonRequest(harness.app, harness.db, '/api/public-checkin/pokemon/accounts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'paid@example.com', password: 'password', enabled: true })
    });
    await jsonRequest(harness.app, harness.db, '/api/public-checkin/pokemon/config', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ couponCode: 'small-discount' })
    });
    pokemonRenewalTestHooks.setTiming({ pollIntervalMs: 0, pollTimeoutMs: 20, betweenAccountsDelayMs: 0 });
    pokemonRenewalTestHooks.setFetch((async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/passport/auth/login')) return response({ data: { auth_data: 'token-paid' } });
      if (path.endsWith('/user/info')) return response({ data: { expired_at: 1_000_000, discount: 0 } });
      if (path.endsWith('/user/order/fetch')) return response({ data: [] });
      if (path.endsWith('/user/plan/fetch')) return response({ data: { id: 8, month_price: 880 } });
      if (path.endsWith('/user/coupon/check')) return response({ data: { type: 1, value: 100, limit_period: ['month_price'] } });
      if (path.endsWith('/user/order/save')) {
        orderSaveCalls += 1;
        return response({ data: 'unexpected' });
      }
      throw new Error(`Unexpected request: ${path}`);
    }) as any);
    const started = await jsonRequest<{ id: string }>(harness.app, harness.db, '/api/public-checkin/pokemon/renewal-runs', { method: 'POST' });
    let snapshot: any;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      snapshot = (await jsonRequest<any>(harness.app, harness.db, `/api/public-checkin/pokemon/renewal-runs/${started.data.id}`)).data;
      if (snapshot.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(snapshot.failedCount, 1);
    assert.equal(snapshot.results[0].reasonCode, 'non_zero_or_invalid_price');
    assert.equal(orderSaveCalls, 0);
  } finally {
    harness.cleanup();
  }
});

test('skips a pending order without cancelling or creating another order', async () => {
  const harness = createHarness();
  let mutationCalls = 0;
  try {
    await jsonRequest(harness.app, harness.db, '/api/public-checkin/pokemon/accounts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'pending@example.com', password: 'password', enabled: true })
    });
    await jsonRequest(harness.app, harness.db, '/api/public-checkin/pokemon/config', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ couponCode: 'coupon' })
    });
    pokemonRenewalTestHooks.setTiming({ pollIntervalMs: 0, pollTimeoutMs: 20, betweenAccountsDelayMs: 0 });
    pokemonRenewalTestHooks.setFetch((async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/passport/auth/login')) return response({ data: { auth_data: 'token' } });
      if (path.endsWith('/user/info')) return response({ data: { expired_at: 1_000_000, discount: 0 } });
      if (path.endsWith('/user/order/fetch')) return response({ data: [{ trade_no: 'pending-order', status: 0 }] });
      if (/order\/(save|cancel|checkout)$/.test(path)) mutationCalls += 1;
      throw new Error(`Unexpected request: ${path}`);
    }) as any);
    const started = await jsonRequest<{ id: string }>(harness.app, harness.db, '/api/public-checkin/pokemon/renewal-runs', { method: 'POST' });
    let snapshot: any;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      snapshot = (await jsonRequest<any>(harness.app, harness.db, `/api/public-checkin/pokemon/renewal-runs/${started.data.id}`)).data;
      if (snapshot.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(snapshot.skippedCount, 1);
    assert.equal(snapshot.results[0].reasonCode, 'pending_order');
    assert.equal(mutationCalls, 0);
  } finally {
    harness.cleanup();
  }
});

test('blocks a duplicate run and reports an order confirmation timeout', async () => {
  const harness = createHarness();
  try {
    await jsonRequest(harness.app, harness.db, '/api/public-checkin/pokemon/accounts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'timeout@example.com', password: 'password', enabled: true })
    });
    await jsonRequest(harness.app, harness.db, '/api/public-checkin/pokemon/config', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ couponCode: 'free-code' })
    });
    pokemonRenewalTestHooks.setTiming({ pollIntervalMs: 1, pollTimeoutMs: 8, betweenAccountsDelayMs: 0 });
    pokemonRenewalTestHooks.setFetch((async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/passport/auth/login')) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return response({ data: { auth_data: 'token' } });
      }
      if (path.endsWith('/user/info')) return response({ data: { expired_at: 1_000_000, discount: 0 } });
      if (path.endsWith('/user/order/fetch')) return response({ data: [] });
      if (path.endsWith('/user/plan/fetch')) return response({ data: { id: 8, month_price: 880 } });
      if (path.endsWith('/user/coupon/check')) return response({ data: { type: 1, value: 880, limit_period: ['month_price'] } });
      if (path.endsWith('/user/order/save')) return response({ data: 'trade-timeout' });
      if (path.endsWith('/user/order/detail')) return response({ data: { total_amount: 0, status: 0 } });
      if (path.endsWith('/user/order/checkout')) return response({ data: true });
      if (path.endsWith('/user/order/check')) return response({ data: 0 });
      throw new Error(`Unexpected request: ${path}`);
    }) as any);
    const started = await jsonRequest<{ id: string }>(harness.app, harness.db, '/api/public-checkin/pokemon/renewal-runs', { method: 'POST' });
    const duplicate = await harness.app.request('http://localhost/api/public-checkin/pokemon/renewal-runs', { method: 'POST' }, { DB: harness.db });
    assert.equal(duplicate.status, 409);
    assert.match(await duplicate.text(), /正在运行/);
    let snapshot: any;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      snapshot = (await jsonRequest<any>(harness.app, harness.db, `/api/public-checkin/pokemon/renewal-runs/${started.data.id}`)).data;
      if (snapshot.status !== 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(snapshot.failedCount, 1);
    assert.equal(snapshot.results[0].reasonCode, 'order_timeout');
  } finally {
    harness.cleanup();
  }
});
