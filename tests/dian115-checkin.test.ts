import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Hono } from 'hono';

import {
  dian115CheckinTestHooks,
  registerDian115CheckinRoutes,
  runDian115CheckinAll,
  runDian115CheckinForAccount
} from '../server/runtime/dian115-checkin.ts';
import { SQLiteD1Database } from '../server/runtime/sqlite-d1.ts';

process.env.PUBLIC_CHECKIN_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

interface FetchCall {
  url: URL;
  method: string;
  body: string;
  cookie: string;
}

const callLog: FetchCall[] = [];
/** 站点当前积分，签到成功时按 checkinGain 增加，模拟站点侧变化。 */
let points: number = 86;
let checkinGain: number = 0;
/** signin 响应：outcome success / already_signed / 抛错（Cloudflare HTML）。 */
let signinOutcome: 'success' | 'already_signed' | 'cloudflare' = 'success';
let signinStatus: number = 200;
let signinMessage: string = '签到成功';
/** /api/portal/me 返回失败次数，用于测试签到前取数失败的回退。 */
let meFailCount: number = 0;
/** /api/portal/me 返回未登录（无 user 字段）的开关。 */
let meUnauthorized: boolean = false;
let expectedMode: string | null = null;

function resetFetchState(): void {
  callLog.length = 0;
  points = 86;
  checkinGain = 0;
  signinOutcome = 'success';
  signinStatus = 200;
  signinMessage = '签到成功';
  meFailCount = 0;
  meUnauthorized = false;
  expectedMode = null;
}

function setFetchHarness(): void {
  dian115CheckinTestHooks.setFetch(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method || 'GET').toUpperCase();
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const headers = (init?.headers || {}) as Record<string, string>;
    callLog.push({ url, method, body: bodyText, cookie: headers.cookie || '' });
    const pathname = url.pathname;

    // 浏览器安全会话端点（模拟应用层防爬）
    if (pathname === '/api/portal/auth/browser-challenge') {
      return new Response(JSON.stringify({
        code: 'ok',
        enabled: true,
        proof: 'v2.1788267606.1788268206.6fc49f5ad9537434e96320f718785804.fake-proof-fake-proof-fake-proof-fakeproof',
        ttl: 600,
        expires_at: new Date(Date.now() + 600_000).toISOString()
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (pathname === '/api/portal/auth/browser-session') {
      return new Response(JSON.stringify({
        code: 'ok',
        enabled: true,
        ttl: 1800,
        server_time_ms: Date.now(),
        expires_at: new Date(Date.now() + 1_800_000).toISOString()
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': '__Host-portal_browser=fake-browser-session-cookie; Path=/; Secure; HttpOnly'
        }
      });
    }
    if (pathname === '/api/portal/auth/login') {
      const body = JSON.parse(bodyText || '{}');
      if (body.email === 'dian115-test@example.com' && body.password === 'correct-password') {
        return new Response(JSON.stringify({
          code: 'ok',
          user: { email: 'dian115-test@example.com', nickname: '密码用户', points, vip: false }
        }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-cookie': `__Host-portal_token=fresh-login-token-${Math.random().toString(36).slice(2, 8)}; Path=/; Secure; HttpOnly`
          }
        });
      }
      return new Response(JSON.stringify({ code: 'bad_request', msg: '邮箱或密码错误' }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }

    if (pathname === '/api/portal/me') {
      // 模拟登录态失效：携带 stale-token 的请求返回 401 invalid_token
      if ((headers.cookie || '').includes('__Host-portal_token=stale-token')) {
        return new Response(JSON.stringify({ code: 'invalid_token', msg: '登录已失效' }), {
          status: 401, headers: { 'content-type': 'application/json' }
        });
      }
      if (meFailCount > 0) {
        meFailCount -= 1;
        return new Response('boom', { status: 500 });
      }
      if (meUnauthorized) {
        return new Response(JSON.stringify({ code: 'unauthorized', msg: '请先登录' }), {
          status: 401,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({
        code: 'ok',
        unlock_count: 0,
        unread_msg: 0,
        user: {
          email: 'dian115-test@example.com',
          nickname: '测试用户',
          points,
          last_signin_date: '2026-09-01',
          vip: false
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (pathname === '/api/portal/signin') {
      // 业务请求必须携带浏览器签名头（模拟应用层校验）
      assert.ok(headers['x-portal-browser-sig'], '签到请求应携带 X-Portal-Browser-Sig');
      assert.ok(headers['x-portal-browser-proof'], '签到请求应携带 X-Portal-Browser-Proof');
      assert.ok((headers.cookie || '').includes('__Host-portal_browser='), '签到请求应携带浏览器会话 Cookie');
      const body = JSON.parse(bodyText || '{}');
      if (expectedMode != null) assert.equal(body.mode, expectedMode, '签到模式应随账号配置传递');
      if (signinOutcome === 'success') {
        points += checkinGain;
        return new Response(JSON.stringify({ code: 'ok', msg: signinMessage }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (signinOutcome === 'already_signed') {
        return new Response(JSON.stringify({ code: 'already_signed', msg: '今日已签到' }), {
          status: 409,
          headers: { 'content-type': 'application/json' }
        });
      }
      return new Response('<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head></html>', {
        status: 403,
        headers: { 'content-type': 'text/html; charset=UTF-8' }
      });
    }

    throw new Error(`unexpected path: ${pathname}`);
  });
}

function createHarness(): { app: Hono<any>; db: SQLiteD1Database; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'dian115-checkin-test-'));
  const db = new SQLiteD1Database(join(directory, 'test.db'));
  db.raw.exec(`
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.raw.exec(readFileSync(join(process.cwd(), 'migrations/0017_public_checkin.sql'), 'utf8'));
  db.raw.exec(readFileSync(join(process.cwd(), 'migrations/0026_dian115_checkin.sql'), 'utf8'));
  db.raw.exec(readFileSync(join(process.cwd(), 'migrations/0027_dian115_password_auth.sql'), 'utf8'));
  const app = new Hono<any>();
  registerDian115CheckinRoutes(app);
  return {
    app,
    db,
    cleanup() {
      dian115CheckinTestHooks.reset();
      db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  };
}

async function jsonRequest<T>(app: Hono<any>, db: D1Database, path: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const res = await app.request(`http://localhost${path}`, init, { DB: db });
  return { status: res.status, data: await res.json() as T };
}

const accountPayload = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  label: 'dian115 A',
  cookie: 'portal_session=secret-session; cf_clearance=fake-clearance',
  checkinMode: 'normal',
  checkinEnabled: true,
  useProxy: false,
  ...overrides
});

test('stores cookies encrypted without returning them in responses', async (t) => {
  resetFetchState();
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/dian115/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload()
  });
  assert.equal(created.status, 201);
  assert.notEqual(created.data.id, undefined);
  assert.equal('cookie' in created.data, false);
  assert.equal(created.data.checkinMode, 'normal');

  const row = await db.prepare('SELECT cookie_data FROM dian115_checkin_accounts WHERE id = ?').bind(created.data.id).first<{ cookie_data: string }>();
  assert.ok(row && !row.cookie_data.includes('secret-session'), '密文不应含明文 Cookie');

  const { data: credential } = await jsonRequest<{ cookie: string }>(
    app, db, `/api/public-checkin/dian115/accounts/${created.data.id}/credential`
  );
  assert.ok(credential.cookie.includes('secret-session'), '凭据接口应回解明文 Cookie');
});

test('performs a successful checkin with lucky mode writing points and a success log', async (t) => {
  resetFetchState();
  setFetchHarness();
  points = 100;
  checkinGain = 5;
  signinOutcome = 'success';
  expectedMode = 'lucky';
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/dian115/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ checkinMode: 'lucky' })
  });

  const run = await runDian115CheckinForAccount(db, created.data.id, 'manual');
  assert.equal(run.result?.success, true);
  assert.equal(run.result?.status, 'success');
  assert.equal(run.result?.reward, 5, '奖励应为签到前后积分的真实差值');
  assert.equal(run.result?.balanceBefore, 100);
  assert.equal(run.result?.balanceAfter, 105);
  assert.equal(run.siteName, 'dian115');

  const account = await db.prepare('SELECT points, last_status, status FROM dian115_checkin_accounts WHERE id = ?').bind(created.data.id).first<{ points: number; last_status: string; status: string }>();
  assert.equal(account?.points, 105);
  assert.equal(account?.last_status, 'success');
  assert.equal(account?.status, 'active');

  const log = await db.prepare('SELECT status, reward, error_message FROM dian115_checkin_logs WHERE account_id = ?').bind(created.data.id).first<{ status: string; reward: number; error_message: string | null }>();
  assert.equal(log?.status, 'success');
  assert.equal(log?.reward, 5);

  // 列表应带今日奖励
  const list = await jsonRequest<Array<{ todayRewardPoints: number | null }>>(app, db, '/api/public-checkin/dian115/accounts');
  assert.equal(list.data[0].todayRewardPoints, 5);
});

test('treats already_signed as repeat success without reward', async (t) => {
  resetFetchState();
  setFetchHarness();
  points = 200;
  signinOutcome = 'already_signed';
  signinStatus = 409;
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/dian115/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload()
  });

  const run = await runDian115CheckinForAccount(db, created.data.id, 'scheduler');
  assert.equal(run.result?.success, true);
  assert.equal(run.result?.status, 'success');
  assert.equal(run.result?.reward, null);

  const account = await db.prepare('SELECT last_status FROM dian115_checkin_accounts WHERE id = ?').bind(created.data.id).first<{ last_status: string }>();
  assert.equal(account?.last_status, 'repeat');
});

test('reports cloudflare block as a failed checkin with a clear message', async (t) => {
  resetFetchState();
  setFetchHarness();
  signinOutcome = 'cloudflare';
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/dian115/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload()
  });

  const run = await runDian115CheckinForAccount(db, created.data.id, 'manual');
  assert.equal(run.result?.success, false);
  assert.equal(run.result?.status, 'failed');
  assert.ok(run.result?.errorMessage?.includes('Cloudflare'), '错误信息应提示 Cloudflare 拦截');

  const account = await db.prepare('SELECT status, last_error FROM dian115_checkin_accounts WHERE id = ?').bind(created.data.id).first<{ status: string; last_error: string | null }>();
  assert.equal(account?.status, 'error');
  assert.ok(account?.last_error?.includes('Cloudflare'));

  const log = await db.prepare('SELECT status FROM dian115_checkin_logs WHERE account_id = ?').bind(created.data.id).first<{ status: string }>();
  assert.equal(log?.status, 'failed');
});

test('tests an unsaved cookie without persisting anything', async (t) => {
  resetFetchState();
  setFetchHarness();
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const result = await jsonRequest<{ success: boolean; nickname?: string; email?: string; points?: number | null }>(app, db, '/api/public-checkin/dian115/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cookie: 'portal_session=raw-cookie-for-test', useProxy: false })
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.success, true);
  assert.equal(result.data.nickname, '测试用户');
  assert.equal(result.data.points, 86);

  assert.ok(callLog.some((item) => item.cookie.includes('raw-cookie-for-test')), '检测请求应携带原始 Cookie');
  assert.ok(!callLog.some((item) => item.url.pathname === '/api/portal/signin'), '连接检测不应触发签到');

  const { results } = await db.prepare('SELECT COUNT(*) AS count FROM dian115_checkin_accounts').all<{ count: number }>();
  assert.equal(Number(results[0]?.count || 0), 0, '未保存的检测不应落库');
});

test('saved account connection test syncs points into the store', async (t) => {
  resetFetchState();
  setFetchHarness();
  points = 123;
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/dian115/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload()
  });

  const tested = await jsonRequest<{ success: boolean; points?: number | null }>(app, db, `/api/public-checkin/dian115/accounts/${created.data.id}/test`, {
    method: 'POST'
  });
  assert.equal(tested.data.success, true);
  assert.equal(tested.data.points, 123);

  const account = await db.prepare('SELECT points, status FROM dian115_checkin_accounts WHERE id = ?').bind(created.data.id).first<{ points: number; status: string }>();
  assert.equal(account?.points, 123);
  assert.equal(account?.status, 'active');
});

test('invalid cookie fails the test with a readable message', async (t) => {
  resetFetchState();
  setFetchHarness();
  meUnauthorized = true;
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/dian115/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload()
  });

  const tested = await jsonRequest<{ success: boolean; message: string }>(app, db, `/api/public-checkin/dian115/accounts/${created.data.id}/test`, {
    method: 'POST'
  });
  assert.equal(tested.data.success, false);
  assert.ok(tested.data.message.length > 0);

  const account = await db.prepare('SELECT status FROM dian115_checkin_accounts WHERE id = ?').bind(created.data.id).first<{ status: string }>();
  assert.equal(account?.status, 'error');
});

test('skips disabled or checkin-off accounts in scheduled runs', async (t) => {
  resetFetchState();
  setFetchHarness();
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/dian115/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ checkinEnabled: false })
  });

  const run = await runDian115CheckinForAccount(db, created.data.id, 'scheduler');
  assert.equal(run.result?.success, true);
  assert.equal(run.result?.status, 'skipped');
  assert.ok(!callLog.some((item) => item.url.pathname === '/api/portal/signin'), '未启用签到的账号不应请求签到接口');
});

test('runDian115CheckinAll processes enabled accounts sequentially', async (t) => {
  resetFetchState();
  setFetchHarness();
  points = 10;
  checkinGain = 1;
  dian115CheckinTestHooks.setTiming({ betweenAccountsDelayMs: 0 });
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const first = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/dian115/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ label: 'A' })
  });
  await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/dian115/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ label: 'B', checkinEnabled: false })
  });

  const results = await runDian115CheckinAll(db, 'scheduler');
  assert.equal(results.length, 1, '只有启用签到的账号参与批量签到');
  assert.equal(results[0].result?.success, true);
  assert.equal(results[0].result?.balanceAfter, 11);
});

test('updates account label, mode and cookie with empty-cookie semantics', async (t) => {
  resetFetchState();
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/dian115/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload()
  });

  const updated = await jsonRequest<{ label: string; checkinMode: string }>(app, db, `/api/public-checkin/dian115/accounts/${created.data.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label: '改名后的账号', checkinMode: 'lucky', checkinEnabled: true, useProxy: false })
  });
  assert.equal(updated.data.label, '改名后的账号');
  assert.equal(updated.data.checkinMode, 'lucky');

  // 未传 cookie 时不应改动原 Cookie
  const credential = await jsonRequest<{ cookie: string }>(app, db, `/api/public-checkin/dian115/accounts/${created.data.id}/credential`);
  assert.ok(credential.data.cookie.includes('secret-session'));
});

test('deletes accounts and cascades logs', async (t) => {
  resetFetchState();
  setFetchHarness();
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/dian115/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload()
  });
  await runDian115CheckinForAccount(db, created.data.id, 'manual');

  const logCount = await db.prepare('SELECT COUNT(*) AS count FROM dian115_checkin_logs').first<{ count: number }>();
  assert.equal(Number(logCount?.count || 0), 1);

  const res = await app.request(`http://localhost/api/public-checkin/dian115/accounts/${created.data.id}`, { method: 'DELETE' }, { DB: db });
  assert.equal(res.status, 204);

  const afterLogs = await db.prepare('SELECT COUNT(*) AS count FROM dian115_checkin_logs').first<{ count: number }>();
  assert.equal(Number(afterLogs?.count || 0), 0, '删除账号后日志应级联清除');
});

test('refreshes browser proof and retries when the session expires mid-flight', async (t) => {
  resetFetchState();
  setFetchHarness();
  points = 300;
  // 首次业务请求返回 proof 失效，应重置会话并重试
  let proofFailures = 1;
  const originalHandler = null;
  dian115CheckinTestHooks.setFetch(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method || 'GET').toUpperCase();
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    const headers = (init?.headers || {}) as Record<string, string>;
    const pathname = url.pathname;
    if (pathname === '/api/portal/auth/browser-challenge') {
      return new Response(JSON.stringify({
        code: 'ok', enabled: true,
        proof: `v2.${Math.floor(Date.now() / 1000)}.${Math.floor(Date.now() / 1000) + 600}.deadbeefdeadbeefdeadbeefdeadbeef.retry-proof-retry-proof-retry-proof-retr`,
        ttl: 600,
        expires_at: new Date(Date.now() + 600_000).toISOString()
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (pathname === '/api/portal/auth/browser-session') {
      return new Response(JSON.stringify({
        code: 'ok', enabled: true, ttl: 1800, server_time_ms: Date.now(),
        expires_at: new Date(Date.now() + 1_800_000).toISOString()
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'set-cookie': `__Host-portal_browser=session-${Math.random().toString(36).slice(2)}; Path=/; Secure; HttpOnly`
        }
      });
    }
    if (pathname === '/api/portal/me') {
      if (proofFailures > 0) {
        proofFailures -= 1;
        return new Response(JSON.stringify({ code: 'browser_proof_invalid', msg: 'browser proof invalid' }), {
          status: 403, headers: { 'content-type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({
        code: 'ok', user: { email: 'retry@example.com', nickname: '重试用户', points, last_signin_date: null }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected path: ${pathname}`);
  });

  const { db, cleanup } = createHarness();
  t.after(cleanup);

  const cookie = 'portal_session=retry-session';
  // 直接调用模块内私有函数不可行，改用公开的 testDian115Cookie 验证重试链路
  const { testDian115Cookie } = await import('../server/runtime/dian115-checkin.ts');
  const result = await testDian115Cookie(db, { cookie, useProxy: false });
  assert.equal(result.success, true, 'proof 失效后应自动重建会话并重试成功');
  assert.equal(result.points, 300);
});

test('lists logs with account labels and site name', async (t) => {
  resetFetchState();
  setFetchHarness();
  checkinGain = 7;
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/dian115/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload()
  });
  await runDian115CheckinForAccount(db, created.data.id, 'manual');

  const logs = await jsonRequest<{ items: Array<{ accountLabel: string; siteName: string; reward: number | null; status: string }>; total: number }>(
    app, db, '/api/public-checkin/dian115/logs?limit=10'
  );
  assert.equal(logs.data.total, 1);
  assert.equal(logs.data.items[0].accountLabel, 'dian115 A');
  assert.equal(logs.data.items[0].siteName, 'dian115');
  assert.equal(logs.data.items[0].reward, 7);
  assert.equal(logs.data.items[0].status, 'success');
});

test('creates a password-mode account by logging in immediately', async (t) => {
  resetFetchState();
  setFetchHarness();
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number; credentialType: string; email: string | null }>(app, db, '/api/public-checkin/dian115/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      label: '密码账号',
      credentialType: 'password',
      email: 'dian115-test@example.com',
      password: 'correct-password',
      checkinMode: 'normal',
      checkinEnabled: true,
      useProxy: false
    })
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.credentialType, 'password');
  assert.equal(created.data.email, 'dian115-test@example.com');

  const row = await db.prepare('SELECT cookie_data, password_data FROM dian115_checkin_accounts WHERE id = ?').bind(created.data.id).first<{ cookie_data: string; password_data: string }>();
  assert.ok(row && !row.cookie_data.includes('correct-password'), '库中不应出现明文密码');
  assert.ok(row && !row.password_data.includes('correct-password'), '密码应加密保存');
  assert.ok(row!.cookie_data.length > 0, '登录后应存下发的 token');
});

test('rejects password-mode creation with wrong credentials', async (t) => {
  resetFetchState();
  setFetchHarness();
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const res = await app.request('http://localhost/api/public-checkin/dian115/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      label: '错误密码',
      credentialType: 'password',
      email: 'dian115-test@example.com',
      password: 'wrong-password',
      checkinMode: 'normal',
      checkinEnabled: true,
      useProxy: false
    })
  }, { DB: db });
  assert.equal(res.status, 400);
  assert.ok((await res.text()).includes('邮箱或密码错误'));
  const { results } = await db.prepare('SELECT COUNT(*) AS count FROM dian115_checkin_accounts').all<{ count: number }>();
  assert.equal(Number(results[0]?.count || 0), 0, '登录失败不应落库');
});

test('re-login automatically when the stored token expires in password mode', async (t) => {
  resetFetchState();
  setFetchHarness();
  points = 55;
  checkinGain = 2;
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/dian115/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      label: '自动续期账号',
      credentialType: 'password',
      email: 'dian115-test@example.com',
      password: 'correct-password',
      checkinMode: 'normal',
      checkinEnabled: true,
      useProxy: false
    })
  });

  // 把库里的 token 置为过期值，模拟 24 小时后 token 失效
  const { encryptPublicCheckinSecret } = await import('../server/runtime/public-checkin.ts');
  await db.prepare('UPDATE dian115_checkin_accounts SET cookie_data = ? WHERE id = ?')
    .bind(encryptPublicCheckinSecret('__Host-portal_token=stale-token'), created.data.id)
    .run();

  const run = await runDian115CheckinForAccount(db, created.data.id, 'manual');
  assert.equal(run.result?.success, true, 'token 失效后应自动重新登录并完成签到');
  assert.equal(run.result?.status, 'success');
  assert.equal(run.result?.balanceBefore, 55);
  assert.equal(run.result?.balanceAfter, 57);

  // 库里的 token 应已更新为登录下发的新值
  const row = await db.prepare('SELECT cookie_data FROM dian115_checkin_accounts WHERE id = ?').bind(created.data.id).first<{ cookie_data: string }>();
  const { decryptPublicCheckinSecret } = await import('../server/runtime/public-checkin.ts');
  assert.ok(decryptPublicCheckinSecret(row!.cookie_data).includes('fresh-login-token'), '新 token 应已落库');
});