import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Hono } from 'hono';

import {
  gladosCheckinTestHooks,
  registerGladosCheckinRoutes,
  runGladosCheckinAll,
  runGladosCheckinForAccount
} from '../server/runtime/glados-checkin.ts';
import { SQLiteD1Database } from '../server/runtime/sqlite-d1.ts';

process.env.PUBLIC_CHECKIN_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

interface FetchCall {
  url: URL;
  method: string;
  body: string;
}

const callLog: FetchCall[] = [];
let statusHandler: ((url: URL) => Record<string, unknown>) | null = null;
let checkinCode: number = 0;
let checkinMessage: string = '';
let points: number = 500;
let exchangeCode: number = 0;
let exchangeMessage: string = '';
let trafficTodayBytes: number = 0;
let trafficFails: boolean = false;

function resetFetchState(): void {
  callLog.length = 0;
  statusHandler = null;
  checkinCode = 0;
  checkinMessage = '';
  points = 500;
  exchangeCode = 0;
  exchangeMessage = '';
  trafficTodayBytes = 0;
  trafficFails = false;
}

function setFetchHarness(): void {
  gladosCheckinTestHooks.setFetch(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method || 'GET').toUpperCase();
    const bodyText = typeof init?.body === 'string' ? init.body : '';
    callLog.push({ url, method, body: bodyText });
    const pathname = url.pathname;

    if (pathname === '/api/user/status') {
      const custom = statusHandler ? statusHandler(url) : {};
      return new Response(JSON.stringify({
        code: 0,
        data: {
          email: 'glados-test@example.com',
          leftDays: '14.0000000000000000',
          userId: 756903,
          configureId: 756903,
          code: 'abc1234',
          port: 266669,
          hashed: 'deadbeefdeadbeef',
          vip: 10,
          system_time: 1787835953500,
          ...custom
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (pathname === '/api/user/traffic') {
      if (trafficFails) return new Response('boom', { status: 500 });
      return new Response(JSON.stringify({ code: 0, data: { limit: 1000, level: 1, today: trafficTodayBytes, throttles: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (pathname === '/api/user/checkin') {
      return new Response(JSON.stringify({ code: checkinCode, message: checkinMessage, points }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (pathname === '/api/user/points') {
      return new Response(JSON.stringify({ code: 0, points }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (pathname === '/api/user/exchange') {
      return new Response(JSON.stringify({ code: exchangeCode, message: exchangeMessage }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error(`unexpected path: ${pathname}`);
  });
}

function createHarness(): { app: Hono<any>; db: SQLiteD1Database; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'glados-checkin-test-'));
  const db = new SQLiteD1Database(join(directory, 'test.db'));
  db.raw.exec(`
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.raw.exec(readFileSync(join(process.cwd(), 'migrations/0023_glados_checkin.sql'), 'utf8'));
  db.raw.exec(readFileSync(join(process.cwd(), 'migrations/0024_glados_subscription.sql'), 'utf8'));
  const app = new Hono<any>();
  registerGladosCheckinRoutes(app);
  return {
    app,
    db,
    cleanup() {
      gladosCheckinTestHooks.reset();
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
  label: 'GLaDOS A',
  cookie: 'koa:sess=secret-value; koa:sess.sig=signature',
  checkinEnabled: true,
  exchangeEnabled: true,
  exchangePlan: 'plan500',
  ...overrides
});

test('stores cookies encrypted without returning them in responses', async (t) => {
  resetFetchState();
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload()
  });
  assert.equal(created.status, 201);
  assert.notEqual(created.data.id, undefined);
  assert.equal('cookie' in created.data, false);

  const row = await db.prepare('SELECT cookie_data FROM glados_checkin_accounts WHERE id = ?').bind(created.data.id).first<{ cookie_data: string }>();
  assert.ok(row && !row.cookie_data.includes('secret-value'), '密文不应含明文 Cookie');
  const { results: list } = await db.prepare('SELECT cookie_data FROM glados_checkin_accounts').all<{ cookie_data: string }>();
  assert.ok(!('cookie' in list[0]), '列表响应不应含 Cookie 明文');

  const { data: credential } = await jsonRequest<{ cookie: string }>(
    app, db, `/api/public-checkin/glados/accounts/${created.data.id}/credential`
  );
  assert.ok(credential.cookie.includes('secret-value'), '凭据接口应回解明文 Cookie');
});

test('performs a successful checkin writing points, leftDays and a success log', async (t) => {
  resetFetchState();
  setFetchHarness();
  checkinCode = 0;
  points = 600;
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload()
  });

  const run = await runGladosCheckinForAccount(db, created.data.id, 'manual');
  assert.equal(run.result?.success, true);
  assert.equal(run.result?.status, 'success');
  assert.equal(run.result?.reward, 1);
  assert.equal(run.result?.balanceAfter, 600);
  assert.ok(run.result?.rewardNote?.includes('签到成功'));

  const row = await db.prepare('SELECT checkin_enabled, points, left_days, last_status, status FROM glados_checkin_accounts WHERE id = ?').bind(created.data.id).first() as any;
  assert.equal(row.points, 600);
  assert.equal(row.left_days, 14);
  assert.equal(row.last_status, 'success');
  assert.equal(row.status, 'active');

  const log = await db.prepare('SELECT * FROM glados_checkin_logs WHERE account_id = ?').bind(created.data.id).first() as any;
  assert.equal(log.status, 'success');
  assert.equal(log.reward, 1);
  assert.equal(log.triggered_by, 'manual');

  const checkinCall = callLog.find((c) => c.url.pathname === '/api/user/checkin');
  assert.ok(checkinCall, '应发起签到请求');
  assert.equal(checkinCall.method, 'POST');
  assert.ok(checkinCall.body.includes('token=glados.cloud'), '签到请求体应含 token');

  const exchangeCall = callLog.find((c) => c.url.pathname === '/api/user/exchange');
  assert.ok(exchangeCall, '积分达标且启用兑换时应触发兑换');
  assert.ok(exchangeCall.body.includes('planType=plan500'));
  assert.ok(run.result?.rewardNote?.includes('兑换成功'));
});

test('treats a repeat checkin (code 1) as normal success', async (t) => {
  resetFetchState();
  setFetchHarness();
  checkinCode = 1;
  checkinMessage = '今日已签到，明天再来吧';
  points = 100;
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ exchangeEnabled: false })
  });

  const run = await runGladosCheckinForAccount(db, created.data.id, 'manual');
  assert.equal(run.result?.success, true);
  assert.equal(run.result?.reward, 0);
  assert.ok(run.result?.rewardNote?.includes('重复'));

  const row = await db.prepare('SELECT last_status, status FROM glados_checkin_accounts WHERE id = ?').bind(created.data.id).first() as any;
  assert.equal(row.last_status, 'repeat');
  assert.equal(row.status, 'active');

  const log = await db.prepare('SELECT * FROM glados_checkin_logs WHERE account_id = ?').bind(created.data.id).first() as any;
  assert.equal(log.status, 'success');
});

test('marks the account failed when checkin returns an error code', async (t) => {
  resetFetchState();
  setFetchHarness();
  checkinCode = -2;
  checkinMessage = '请先登录 GLaDOS 网站获取新的 Cookie';
  points = 0;
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ exchangeEnabled: false })
  });

  const run = await runGladosCheckinForAccount(db, created.data.id, 'manual');
  assert.equal(run.result?.success, false);
  assert.equal(run.result?.status, 'failed');
  assert.ok(run.result?.errorMessage);

  const row = await db.prepare('SELECT last_status, status, last_error FROM glados_checkin_accounts WHERE id = ?').bind(created.data.id).first() as any;
  assert.equal(row.last_status, 'failed');
  assert.equal(row.status, 'error');
  assert.ok(row.last_error);

  const log = await db.prepare('SELECT * FROM glados_checkin_logs WHERE account_id = ?').bind(created.data.id).first() as any;
  assert.equal(log.status, 'failed');
  assert.ok(log.error_message);
});

test('runs enabled accounts serially and skips disabled ones, feeding the scheduler summary shape', async (t) => {
  resetFetchState();
  setFetchHarness();
  checkinCode = 0;
  points = 300;
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);
  gladosCheckinTestHooks.setTiming({ betweenAccountsDelayMs: 1 });

  const a = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ label: 'G1', exchangeEnabled: false })
  });
  const b = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ label: 'G2', exchangeEnabled: false })
  });
  const c = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ label: 'G3-off', checkinEnabled: false, exchangeEnabled: false })
  });

  const results = await runGladosCheckinAll(db, 'scheduler');
  assert.equal(results.length, 2);
  for (const item of results) {
    assert.equal(item.siteName, 'GLaDOS');
    assert.equal(item.result?.status, 'success');
    assert.ok(typeof item.label === 'string');
  }

  const { results: logs } = (await db.prepare('SELECT * FROM glados_checkin_logs ORDER BY id ASC').all()) as { results: any[] };
  assert.equal(logs.length, 2, 'runGladosCheckinAll 只处理启用的账号');
  assert.ok(logs.every((l) => l.status === 'success'), '启用账号均成功');
  assert.ok(logs.every((l) => l.triggered_by === 'scheduler'));
});

test('exchanges points only when enabled and above the threshold', async (t) => {
  resetFetchState();
  setFetchHarness();
  checkinCode = 0;
  points = 600;
  exchangeCode = 0;
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const enabled = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ label: 'exchange-on', exchangeEnabled: true, exchangePlan: 'plan500' })
  });
  const below = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ label: 'below-threshold', exchangeEnabled: true, exchangePlan: 'plan100' })
  });
  const disabled = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ label: 'exchange-off', exchangeEnabled: false })
  });

  points = 600;
  await runGladosCheckinForAccount(db, enabled.data.id, 'manual');
  points = 50;
  await runGladosCheckinForAccount(db, below.data.id, 'manual');
  await runGladosCheckinForAccount(db, disabled.data.id, 'manual');

  const exchangeCalls = callLog.filter((c) => c.url.pathname === '/api/user/exchange');
  assert.equal(exchangeCalls.length, 1, '只有积分达标的启用账号触发一次兑换');
  assert.ok(exchangeCalls[0].body.includes('planType=plan500'));
});

test('serves logs joined with the account label, filterable and paginated', async (t) => {
  resetFetchState();
  setFetchHarness();
  checkinCode = 0;
  points = 100;
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const ok = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ label: 'G-OK', exchangeEnabled: false })
  });
  const bad = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ label: 'G-BAD', exchangeEnabled: false })
  });

  checkinCode = 0;
  await runGladosCheckinForAccount(db, ok.data.id, 'manual');
  checkinCode = -2;
  checkinMessage = '登录失效';
  await runGladosCheckinForAccount(db, bad.data.id, 'scheduler');

  type LogsBody = {
    items: Array<{ accountId: number; accountLabel: string; siteName: string; status: string; triggeredBy: string }>;
    total: number;
    limit: number;
    offset: number;
  };

  const all = await jsonRequest<LogsBody>(app, db, '/api/public-checkin/glados/logs');
  assert.equal(all.status, 200);
  assert.equal(all.data.total, 2);
  assert.equal(all.data.items.length, 2, '默认返回两条日志');
  assert.equal(all.data.limit, 50, '默认 limit 与公益站日志一致');
  assert.equal(all.data.offset, 0);
  for (const item of all.data.items) {
    assert.equal(item.siteName, 'GLaDOS', '响应需带 siteName 供前端表格复用');
    assert.ok(item.accountLabel, '响应需 JOIN 出 accountLabel');
  }

  const okLabel = all.data.items.find((i) => i.accountId === ok.data.id)?.accountLabel;
  assert.equal(okLabel, 'G-OK');

  const successOnly = await jsonRequest<LogsBody>(app, db, '/api/public-checkin/glados/logs?status=success');
  assert.equal(successOnly.data.total, 1);
  assert.equal(successOnly.data.items[0].accountLabel, 'G-OK');

  const failedOnly = await jsonRequest<LogsBody>(app, db, '/api/public-checkin/glados/logs?status=failed');
  assert.equal(failedOnly.data.total, 1);
  assert.equal(failedOnly.data.items[0].triggeredBy, 'scheduler');

  const byAccount = await jsonRequest<LogsBody>(app, db, `/api/public-checkin/glados/logs?accountId=${bad.data.id}`);
  assert.equal(byAccount.data.total, 1);
  assert.equal(byAccount.data.items[0].accountLabel, 'G-BAD');

  const paged = await jsonRequest<LogsBody>(app, db, '/api/public-checkin/glados/logs?limit=1&offset=1');
  assert.equal(paged.data.total, 2, 'total 为筛选后的全量条数，不受分页影响');
  assert.equal(paged.data.items.length, 1);
  assert.equal(paged.data.limit, 1);
  assert.equal(paged.data.offset, 1);

  const future = await jsonRequest<LogsBody>(app, db, '/api/public-checkin/glados/logs?startAt=4102444800');
  assert.equal(future.data.total, 0, 'startAt 晚于所有日志时应为空');
});

test('derives the subscription url, expiry, traffic and plan from the status payload', async (t) => {
  resetFetchState();
  setFetchHarness();
  checkinCode = 0;
  points = 100;
  trafficTodayBytes = 2 * 1_073_741_824; // 2 GiB
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ exchangeEnabled: false })
  });

  await runGladosCheckinForAccount(db, created.data.id, 'manual');

  const row = await db.prepare(
    'SELECT subscription_url, expires_at, traffic_used_bytes, traffic_limit_gb, plan_level FROM glados_checkin_accounts WHERE id = ?'
  ).bind(created.data.id).first() as any;

  assert.equal(
    row.subscription_url,
    'https://update.glados-config.com/mihomo/756903/abc1234/266669/glados.yaml',
    '订阅链接需按站点前端的模板拼接'
  );
  assert.equal(row.traffic_used_bytes, 2 * 1_073_741_824);
  assert.equal(row.traffic_limit_gb, 10, 'vip=10 对应 Free 的 10GB 额度');
  assert.equal(row.plan_level, 'Free');

  // system_time = 1787835953500ms，leftDays = 14 -> 到期为 14 天后
  const expectedExpiry = Math.floor(1787835953500 / 1000) + 14 * 86400;
  assert.equal(row.expires_at, expectedExpiry, '到期时间应基于站点 system_time 而非本地时钟');

  const listed = await jsonRequest<any[]>(app, db, '/api/public-checkin/glados/accounts');
  assert.equal(listed.data[0].subscriptionUrl, row.subscription_url, '列表接口需回传订阅链接');
  assert.equal(listed.data[0].trafficLimitGb, 10);
  assert.equal(listed.data[0].planLevel, 'Free');
  assert.equal(listed.data[0].expiresAt, expectedExpiry);
});

test('maps every documented vip tier to its plan name and traffic budget', async (t) => {
  resetFetchState();
  setFetchHarness();
  checkinCode = 0;
  points = 0;
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const tiers: Array<[number, string, number]> = [
    [0, 'Free', 10],
    [10, 'Free', 10],
    [11, 'Edu', 100],
    [21, 'Basic', 200],
    [31, 'Pro', 500],
    [41, 'Team', 2000],
    [51, 'Enterprise', 5000],
    [999, 'Basic', 0]
  ];

  for (const [vip, level, limitGb] of tiers) {
    const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: accountPayload({ label: `vip-${vip}`, exchangeEnabled: false })
    });
    statusHandler = () => ({ vip });
    await runGladosCheckinForAccount(db, created.data.id, 'manual');
    const row = await db.prepare('SELECT plan_level, traffic_limit_gb FROM glados_checkin_accounts WHERE id = ?')
      .bind(created.data.id).first() as any;
    assert.equal(row.plan_level, level, `vip=${vip} 应映射为 ${level}`);
    assert.equal(row.traffic_limit_gb, limitGb, `vip=${vip} 的额度应为 ${limitGb}GB`);
  }
});

test('omits the subscription url when the status payload lacks code or port', async (t) => {
  resetFetchState();
  setFetchHarness();
  checkinCode = 0;
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ exchangeEnabled: false })
  });

  statusHandler = () => ({ code: '', port: null });
  await runGladosCheckinForAccount(db, created.data.id, 'manual');

  const row = await db.prepare('SELECT subscription_url FROM glados_checkin_accounts WHERE id = ?')
    .bind(created.data.id).first() as any;
  assert.equal(row.subscription_url, null, '参数不全时不应产出半截地址');
});

test('keeps the checkin successful and preserves stored traffic when the traffic api fails', async (t) => {
  resetFetchState();
  setFetchHarness();
  checkinCode = 0;
  points = 100;
  trafficTodayBytes = 5 * 1_073_741_824;
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload({ exchangeEnabled: false })
  });

  // 第一次正常，写入 5GiB
  await runGladosCheckinForAccount(db, created.data.id, 'manual');
  const first = await db.prepare('SELECT traffic_used_bytes FROM glados_checkin_accounts WHERE id = ?')
    .bind(created.data.id).first() as any;
  assert.equal(first.traffic_used_bytes, 5 * 1_073_741_824);

  // 第二次流量接口失败，签到仍应成功且旧值不被覆盖
  trafficFails = true;
  const run = await runGladosCheckinForAccount(db, created.data.id, 'manual');
  assert.equal(run.result?.success, true, '流量接口失败不应影响签到结果');

  const second = await db.prepare('SELECT traffic_used_bytes, status FROM glados_checkin_accounts WHERE id = ?')
    .bind(created.data.id).first() as any;
  assert.equal(second.traffic_used_bytes, 5 * 1_073_741_824, '流量查询失败时应保留库中旧值');
  assert.equal(second.status, 'active');
});

test('does not overwrite the stored cookie when editing leaves it empty', async (t) => {
  resetFetchState();
  setFetchHarness();
  const { app, db, cleanup } = createHarness();
  t.after(cleanup);

  const created = await jsonRequest<{ id: number }>(app, db, '/api/public-checkin/glados/accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: accountPayload()
  });

  const updated = await jsonRequest<any>(app, db, `/api/public-checkin/glados/accounts/${created.data.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'Renamed', cookie: '', exchangeEnabled: false })
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.label, 'Renamed');

  const { data: credential } = await jsonRequest<{ cookie: string }>(
    app, db, `/api/public-checkin/glados/accounts/${created.data.id}/credential`
  );
  assert.ok(credential.cookie.includes('secret-value'), '留空 Cookie 不应覆盖原密文');
});