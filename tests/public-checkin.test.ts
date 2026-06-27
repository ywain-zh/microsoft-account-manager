import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';

import {
  parsePublicCheckinRewardAmount,
  registerPublicCheckinRoutes,
  publicCheckinTestHooks
} from '../server/runtime/public-checkin.ts';

process.env.PUBLIC_CHECKIN_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

type MemorySiteRow = {
  id: number;
  name: string;
  url: string;
  platform: 'new-api' | 'one-api' | 'onehub';
  created_at: number;
  updated_at: number;
};

type MemoryAccountRow = {
  id: number;
  site_id: number;
  label: string;
  credential_type: 'password' | 'access_token' | 'cookie';
  credential_data: string;
  api_key_data: string | null;
  balance: number | null;
  balance_updated_at: number | null;
  checkin_enabled: number;
  use_proxy: number;
  status: 'active' | 'disabled' | 'error';
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

type MemoryAnnouncementRow = {
  id: number;
  site_id: number;
  source_key: string;
  title: string;
  content: string;
  level: 'info' | 'warning' | 'error';
  source_url: string | null;
  first_seen_at: number;
  last_seen_at: number;
  read_at: number | null;
};

type MemoryBaselineRow = {
  id: number;
  account_id: number;
  local_date: string;
  baseline_balance: number;
  captured_at: number;
  created_at: number;
  updated_at: number;
};

type MemoryLogRow = {
  id: number;
  account_id: number;
  triggered_by: 'scheduler' | 'manual';
  status: 'success' | 'failed' | 'skipped';
  reward: number | null;
  reward_note: string | null;
  error_message: string | null;
  executed_at: number;
};

class PublicCheckinMemoryStatement implements D1PreparedStatement {
  private readonly database: PublicCheckinMemoryD1Database;
  private readonly query: string;
  private readonly values: unknown[];

  constructor(database: PublicCheckinMemoryD1Database, query: string, values: unknown[] = []) {
    this.database = database;
    this.query = query;
    this.values = values;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new PublicCheckinMemoryStatement(this.database, this.query, values);
  }

  async first<T>(): Promise<T | null> {
    if (/SELECT value FROM app_settings WHERE key = \? LIMIT 1/i.test(this.query)) {
      const value = this.database.appSettings.get(String(this.values[0]));
      return value == null ? null : { value } as T;
    }

    if (/FROM public_checkin_accounts a\s+INNER JOIN public_checkin_sites s/i.test(this.query)) {
      const accountIdMatch = /WHERE a\.id = \?/i.test(this.query);
      const siteIdMatch = /WHERE a\.site_id = \?/i.test(this.query);
      const account = accountIdMatch
        ? this.database.accounts.find((item) => item.id === Number(this.values[0]))
        : siteIdMatch
          ? this.database.accounts
            .filter((item) => item.site_id === Number(this.values[0]))
            .sort((left, right) => right.id - left.id)[0]
          : null;
      return account ? this.database.joinAccount(account) as T : null;
    }

    throw new Error(`Unsupported first query: ${this.query}`);
  }

  async all<T>(): Promise<{ results: T[]; success: boolean; meta: D1Result['meta'] }> {
    if (/SELECT key, value FROM public_checkin_settings/i.test(this.query)) {
      return {
        results: Array.from(this.database.settings.entries()).map(([key, value]) => ({ key, value })) as T[],
        success: true,
        meta: { rows_read: this.database.settings.size }
      };
    }

    if (/FROM public_checkin_announcements\s+WHERE site_id = \?/i.test(this.query)) {
      const siteId = Number(this.values[0]);
      const results = this.database.announcements
        .filter((item) => item.site_id === siteId)
        .sort((left, right) => (right.first_seen_at - left.first_seen_at) || (right.id - left.id));
      return { results: results as T[], success: true, meta: { rows_read: results.length } };
    }

    if (/FROM public_checkin_announcements\s+WHERE read_at IS NULL/i.test(this.query)) {
      const counts = new Map<number, number>();
      for (const item of this.database.announcements) {
        if (item.read_at == null) {
          counts.set(item.site_id, (counts.get(item.site_id) || 0) + 1);
        }
      }
      const results = Array.from(counts.entries()).map(([site_id, count]) => ({ site_id, count }));
      return { results: results as T[], success: true, meta: { rows_read: results.length } };
    }

    if (/FROM public_checkin_daily_balance_baselines/i.test(this.query)) {
      const localDate = String(this.values[0]);
      const results = this.database.baselines.filter((item) => item.local_date === localDate);
      return { results: results as T[], success: true, meta: { rows_read: results.length } };
    }

    if (/FROM public_checkin_logs/i.test(this.query)) {
      let results = this.database.logs.slice();
      if (/account_id = \?/i.test(this.query)) {
        results = results.filter((item) => item.account_id === Number(this.values[0]));
      }
      if (/status = 'success'/i.test(this.query)) {
        results = results.filter((item) => item.status === 'success');
      }
      if (/reward IS NOT NULL/i.test(this.query)) {
        results = results.filter((item) => item.reward != null);
      }
      if (/reward > 0/i.test(this.query)) {
        results = results.filter((item) => typeof item.reward === 'number' && item.reward > 0);
      }
      if (/ORDER BY executed_at DESC, id DESC/i.test(this.query)) {
        results = results.sort((left, right) => (right.executed_at - left.executed_at) || (right.id - left.id));
      }
      return { results: results as T[], success: true, meta: { rows_read: results.length } };
    }

    if (/FROM public_checkin_accounts/i.test(this.query) && /SELECT DISTINCT site_id/i.test(this.query)) {
      const results = Array.from(new Set(this.database.accounts.map((item) => item.site_id)))
        .sort((left, right) => left - right)
        .map((site_id) => ({ site_id }));
      return { results: results as T[], success: true, meta: { rows_read: results.length } };
    }

    if (/FROM public_checkin_accounts a\s+INNER JOIN public_checkin_sites s/i.test(this.query)) {
      const results = this.database.accounts
        .slice()
        .sort((left, right) => left.id - right.id)
        .map((account) => this.database.joinAccount(account));
      return { results: results as T[], success: true, meta: { rows_read: results.length } };
    }

    throw new Error(`Unsupported all query: ${this.query}`);
  }

  async run(): Promise<D1Result> {
    if (/INSERT INTO public_checkin_sites/i.test(this.query)) {
      const row: MemorySiteRow = {
        id: this.database.nextSiteId++,
        name: String(this.values[0]),
        url: String(this.values[1]),
        platform: this.values[2] as MemorySiteRow['platform'],
        created_at: Number(this.values[3]),
        updated_at: Number(this.values[4])
      };
      this.database.sites.push(row);
      return { success: true, meta: { changes: 1, rows_written: 1, last_row_id: row.id } };
    }

    if (/INSERT INTO public_checkin_accounts/i.test(this.query)) {
      const row: MemoryAccountRow = {
        id: this.database.nextAccountId++,
        site_id: Number(this.values[0]),
        label: String(this.values[1]),
        credential_type: this.values[2] as MemoryAccountRow['credential_type'],
        credential_data: String(this.values[3]),
        api_key_data: this.values[4] == null ? null : String(this.values[4]),
        balance: null,
        balance_updated_at: null,
        checkin_enabled: 1,
        use_proxy: 0,
        status: 'active',
        last_error: null,
        created_at: Number(this.values[5]),
        updated_at: Number(this.values[6])
      };
      this.database.accounts.push(row);
      return { success: true, meta: { changes: 1, rows_written: 1, last_row_id: row.id } };
    }

    if (/INSERT INTO public_checkin_announcements/i.test(this.query)) {
      const row: MemoryAnnouncementRow = {
        id: this.database.nextAnnouncementId++,
        site_id: Number(this.values[0]),
        source_key: String(this.values[1]),
        title: String(this.values[2]),
        content: String(this.values[3]),
        level: this.values[4] as MemoryAnnouncementRow['level'],
        source_url: this.values[5] == null ? null : String(this.values[5]),
        first_seen_at: Number(this.values[6]),
        last_seen_at: Number(this.values[7]),
        read_at: null
      };
      this.database.announcements.push(row);
      return { success: true, meta: { changes: 1, rows_written: 1, last_row_id: row.id } };
    }

    if (/INSERT INTO public_checkin_daily_balance_baselines/i.test(this.query)) {
      const accountId = Number(this.values[0]);
      const localDate = String(this.values[1]);
      const existing = this.database.baselines.find((item) => item.account_id === accountId && item.local_date === localDate);
      if (existing) {
        if (/DO NOTHING/i.test(this.query)) {
          return { success: true, meta: { changes: 0, rows_written: 0, last_row_id: existing.id } };
        }
        existing.baseline_balance = Number(this.values[2]);
        existing.captured_at = Number(this.values[3]);
        existing.updated_at = Number(this.values[5]);
        return { success: true, meta: { changes: 1, rows_written: 1, last_row_id: existing.id } };
      }

      const row: MemoryBaselineRow = {
        id: this.database.nextBaselineId++,
        account_id: accountId,
        local_date: localDate,
        baseline_balance: Number(this.values[2]),
        captured_at: Number(this.values[3]),
        created_at: Number(this.values[4]),
        updated_at: Number(this.values[5])
      };
      this.database.baselines.push(row);
      return { success: true, meta: { changes: 1, rows_written: 1, last_row_id: row.id } };
    }

    if (/INSERT INTO public_checkin_logs/i.test(this.query)) {
      const row: MemoryLogRow = {
        id: this.database.nextLogId++,
        account_id: Number(this.values[0]),
        triggered_by: this.values[1] as MemoryLogRow['triggered_by'],
        status: this.values[2] as MemoryLogRow['status'],
        reward: this.values[3] == null ? null : Number(this.values[3]),
        reward_note: this.values[4] == null ? null : String(this.values[4]),
        error_message: this.values[5] == null ? null : String(this.values[5]),
        executed_at: Number(this.values[6])
      };
      this.database.logs.push(row);
      return { success: true, meta: { changes: 1, rows_written: 1, last_row_id: row.id } };
    }

    if (/UPDATE public_checkin_accounts\s+SET balance = \?/i.test(this.query)) {
      const accountId = Number(this.values[3]);
      const row = this.database.accounts.find((item) => item.id === accountId);
      if (row) {
        row.balance = Number(this.values[0]);
        row.balance_updated_at = Number(this.values[1]);
        row.last_error = null;
        row.status = 'active';
        row.updated_at = Number(this.values[2]);
      }
      return { success: true, meta: { changes: row ? 1 : 0, rows_written: row ? 1 : 0 } };
    }

    if (/UPDATE public_checkin_accounts\s+SET last_error = \?/i.test(this.query)) {
      const accountId = Number(this.values[3]);
      const row = this.database.accounts.find((item) => item.id === accountId);
      if (row) {
        row.last_error = this.values[0] == null ? null : String(this.values[0]);
        if (this.values[1] != null) {
          row.status = this.values[1] as MemoryAccountRow['status'];
        }
        row.updated_at = Number(this.values[2]);
      }
      return { success: true, meta: { changes: row ? 1 : 0, rows_written: row ? 1 : 0 } };
    }

    if (/UPDATE public_checkin_announcements\s+SET title = \?/i.test(this.query)) {
      const row = this.database.announcements.find((item) => item.id === Number(this.values[5]));
      if (row) {
        row.title = String(this.values[0]);
        row.content = String(this.values[1]);
        row.level = this.values[2] as MemoryAnnouncementRow['level'];
        row.source_url = this.values[3] == null ? null : String(this.values[3]);
        row.last_seen_at = Number(this.values[4]);
      }
      return { success: true, meta: { changes: row ? 1 : 0, rows_written: row ? 1 : 0 } };
    }

    if (/UPDATE public_checkin_announcements\s+SET read_at = \?/i.test(this.query)) {
      let changes = 0;
      const readAt = Number(this.values[0]);
      const siteId = Number(this.values[1]);
      for (const row of this.database.announcements) {
        if (row.site_id === siteId && row.read_at == null) {
          row.read_at = readAt;
          changes += 1;
        }
      }
      return { success: true, meta: { changes, rows_written: changes } };
    }

    if (/INSERT INTO public_checkin_settings/i.test(this.query)) {
      this.database.settings.set(String(this.values[0]), String(this.values[1]));
      return { success: true, meta: { changes: 1, rows_written: 1 } };
    }

    if (/INSERT INTO app_settings/i.test(this.query)) {
      this.database.appSettings.set(String(this.values[0]), String(this.values[1]));
      return { success: true, meta: { changes: 1, rows_written: 1 } };
    }

    throw new Error(`Unsupported run query: ${this.query}`);
  }
}

class PublicCheckinMemoryD1Database implements D1Database {
  readonly sites: MemorySiteRow[] = [];
  readonly accounts: MemoryAccountRow[] = [];
  readonly announcements: MemoryAnnouncementRow[] = [];
  readonly baselines: MemoryBaselineRow[] = [];
  readonly logs: MemoryLogRow[] = [];
  readonly settings = new Map<string, string>();
  readonly appSettings = new Map<string, string>();
  nextSiteId = 1;
  nextAccountId = 1;
  nextAnnouncementId = 1;
  nextBaselineId = 1;
  nextLogId = 1;

  prepare(query: string): D1PreparedStatement {
    return new PublicCheckinMemoryStatement(this, query);
  }

  async exec(): Promise<D1Result> {
    return { success: true, meta: {} };
  }

  joinAccount(account: MemoryAccountRow): Record<string, unknown> {
    const site = this.sites.find((item) => item.id === account.site_id);
    if (!site) throw new Error(`Missing site ${account.site_id}`);
    return {
      account_id: account.id,
      site_id: account.site_id,
      label: account.label,
      credential_type: account.credential_type,
      credential_data: account.credential_data,
      api_key_data: account.api_key_data,
      balance: account.balance,
      balance_updated_at: account.balance_updated_at,
      checkin_enabled: account.checkin_enabled,
      use_proxy: account.use_proxy,
      status: account.status,
      last_error: account.last_error,
      account_created_at: account.created_at,
      account_updated_at: account.updated_at,
      site_name: site.name,
      site_url: site.url,
      site_platform: site.platform,
      site_created_at: site.created_at,
      site_updated_at: site.updated_at
    };
  }
}

async function createPublicCheckinDb(): Promise<{
  db: PublicCheckinMemoryD1Database;
  cleanup: () => Promise<void>;
}> {
  return {
    db: new PublicCheckinMemoryD1Database(),
    cleanup: async () => {}
  };
}

async function seedPublicCheckinAccount(db: PublicCheckinMemoryD1Database, siteId?: number): Promise<{
  siteId: number;
  accountId: number;
}> {
  const now = Math.floor(Date.now() / 1000);
  const resolvedSiteId = siteId ?? Number((await db.prepare(`
    INSERT INTO public_checkin_sites (name, url, platform, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind('测试公益站', 'https://public.example.test', 'new-api', now, now).run()).meta.last_row_id);

  const credential = publicCheckinTestHooks.encryptCredential(JSON.stringify({
    type: 'access_token',
    accessToken: 'sk-test'
  }));
  const apiKey = publicCheckinTestHooks.encryptCredential('sk-model-test');
  const accountId = Number((await db.prepare(`
    INSERT INTO public_checkin_accounts (
      site_id,
      label,
      credential_type,
      credential_data,
      api_key_data,
      checkin_enabled,
      use_proxy,
      status,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, 1, 0, 'active', ?, ?)
  `).bind(resolvedSiteId, `测试账号 ${now}`, 'access_token', credential, apiKey, now, now).run()).meta.last_row_id);

  return { siteId: resolvedSiteId, accountId };
}

async function withFakeNow<T>(timestampSeconds: number, callback: () => Promise<T> | T): Promise<T> {
  const originalNow = Date.now;
  Date.now = () => timestampSeconds * 1000;
  try {
    return await callback();
  } finally {
    Date.now = originalNow;
  }
}

function setMemoryAccountBalance(
  db: PublicCheckinMemoryD1Database,
  accountId: number,
  balance: number,
  updatedAt: number
): void {
  const account = db.accounts.find((item) => item.id === accountId);
  if (!account) throw new Error(`Missing account ${accountId}`);
  account.balance = balance;
  account.balance_updated_at = updatedAt;
  account.status = 'active';
  account.last_error = null;
  account.updated_at = updatedAt;
}

function addMemoryBaseline(
  db: PublicCheckinMemoryD1Database,
  accountId: number,
  localDate: string,
  balance: number,
  capturedAt: number
): void {
  db.baselines.push({
    id: db.nextBaselineId++,
    account_id: accountId,
    local_date: localDate,
    baseline_balance: balance,
    captured_at: capturedAt,
    created_at: capturedAt,
    updated_at: capturedAt
  });
}

function addMemoryLog(
  db: PublicCheckinMemoryD1Database,
  accountId: number,
  reward: number | null,
  executedAt: number,
  status: MemoryLogRow['status'] = 'success'
): void {
  db.logs.push({
    id: db.nextLogId++,
    account_id: accountId,
    triggered_by: 'manual',
    status,
    reward,
    reward_note: null,
    error_message: null,
    executed_at: executedAt
  });
}

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

test('formats local dates with the configured public checkin timezone', () => {
  const timestamp = Date.UTC(2026, 5, 23, 16, 30, 0) / 1000;

  assert.equal(publicCheckinTestHooks.formatZonedLocalDate(timestamp, 'Asia/Shanghai'), '2026-06-24');
  assert.equal(publicCheckinTestHooks.formatZonedLocalDate(timestamp, 'UTC'), '2026-06-23');
});

test('resolves daily balance display state for reward priority and later usage', () => {
  assert.deepEqual(
    publicCheckinTestHooks.resolveDailyBalanceDisplayState({
      baselineBalance: null,
      currentBalance: 95,
      balanceUpdatedAt: 1000,
      todayRewardTotal: 0,
      latestPositiveReward: null
    }),
    { mode: 'none', amount: null }
  );

  assert.deepEqual(
    publicCheckinTestHooks.resolveDailyBalanceDisplayState({
      baselineBalance: 100,
      currentBalance: 95,
      balanceUpdatedAt: 1000,
      todayRewardTotal: 0,
      latestPositiveReward: null
    }),
    { mode: 'usage', amount: 5 }
  );

  assert.deepEqual(
    publicCheckinTestHooks.resolveDailyBalanceDisplayState({
      baselineBalance: 100,
      currentBalance: 105,
      balanceUpdatedAt: 1090,
      todayRewardTotal: 10,
      latestPositiveReward: { account_id: 1, reward: 10, executed_at: 1100 }
    }),
    { mode: 'reward', amount: 10 }
  );

  assert.deepEqual(
    publicCheckinTestHooks.resolveDailyBalanceDisplayState({
      baselineBalance: 100,
      currentBalance: 100,
      balanceUpdatedAt: 1200,
      todayRewardTotal: 10,
      latestPositiveReward: { account_id: 1, reward: 10, executed_at: 1100 }
    }),
    { mode: 'usage', amount: 10 }
  );

  assert.deepEqual(
    publicCheckinTestHooks.resolveDailyBalanceDisplayState({
      baselineBalance: 100,
      currentBalance: 110,
      balanceUpdatedAt: 1200,
      todayRewardTotal: 10,
      latestPositiveReward: { account_id: 1, reward: 10, executed_at: 1100 }
    }),
    { mode: 'reward', amount: 10 }
  );
});

test('lists daily usage when a same-day baseline exists and no checkin reward has run', async () => {
  const { db, cleanup } = await createPublicCheckinDb();
  const now = Date.UTC(2026, 5, 24, 4, 0, 0) / 1000;

  try {
    const { accountId } = await seedPublicCheckinAccount(db);
    addMemoryBaseline(db, accountId, '2026-06-24', 100, now - 3600);
    setMemoryAccountBalance(db, accountId, 95, now);

    await withFakeNow(now, async () => {
      const accounts = await publicCheckinTestHooks.listAccounts(db);
      assert.equal(accounts[0].dailyBalanceDisplayMode, 'usage');
      assert.equal(accounts[0].dailyBalanceDisplayAmount, 5);
    });
  } finally {
    await cleanup();
  }
});

test('keeps the reward visible right after checkin, then switches to usage after later balance refresh', async () => {
  const { db, cleanup } = await createPublicCheckinDb();
  const now = Date.UTC(2026, 5, 24, 4, 0, 0) / 1000;
  const rewardAt = now - 60;

  try {
    const { accountId } = await seedPublicCheckinAccount(db);
    addMemoryBaseline(db, accountId, '2026-06-24', 100, now - 3600);
    addMemoryLog(db, accountId, 10, rewardAt);

    setMemoryAccountBalance(db, accountId, 105, rewardAt - 1);
    await withFakeNow(now, async () => {
      const accounts = await publicCheckinTestHooks.listAccounts(db);
      assert.equal(accounts[0].dailyBalanceDisplayMode, 'reward');
      assert.equal(accounts[0].dailyBalanceDisplayAmount, 10);
    });

    setMemoryAccountBalance(db, accountId, 100, now);
    await withFakeNow(now, async () => {
      const accounts = await publicCheckinTestHooks.listAccounts(db);
      assert.equal(accounts[0].dailyBalanceDisplayMode, 'usage');
      assert.equal(accounts[0].dailyBalanceDisplayAmount, 10);
    });
  } finally {
    await cleanup();
  }
});

test('hides daily balance helper without a same-day baseline and after day rollover', async () => {
  const { db, cleanup } = await createPublicCheckinDb();
  const now = Date.UTC(2026, 5, 24, 4, 0, 0) / 1000;

  try {
    const { accountId } = await seedPublicCheckinAccount(db);
    addMemoryBaseline(db, accountId, '2026-06-23', 100, now - 86400);
    addMemoryLog(db, accountId, 10, now - 86400);
    setMemoryAccountBalance(db, accountId, 95, now);

    await withFakeNow(now, async () => {
      const accounts = await publicCheckinTestHooks.listAccounts(db);
      assert.equal(accounts[0].dailyBalanceDisplayMode, 'none');
      assert.equal(accounts[0].dailyBalanceDisplayAmount, null);
    });
  } finally {
    await cleanup();
  }
});

test('manual balance refresh recovers a missing daily baseline', async () => {
  const { db, cleanup } = await createPublicCheckinDb();
  const now = Date.UTC(2026, 5, 24, 4, 0, 0) / 1000;

  publicCheckinTestHooks.setAdapterOverride(() => ({
    getBalance: async () => ({ success: true, balance: 88 })
  } as ReturnType<typeof publicCheckinTestHooks.createAdapter>));

  try {
    const { accountId } = await seedPublicCheckinAccount(db);
    await withFakeNow(now, async () => {
      const result = await publicCheckinTestHooks.refreshBalanceForAccount(db, accountId);
      assert.equal(result.success, true);
      assert.equal(result.balance, 88);
    });

    assert.deepEqual(
      db.baselines.map((item) => ({
        account_id: item.account_id,
        local_date: item.local_date,
        baseline_balance: item.baseline_balance
      })),
      [{
        account_id: accountId,
        local_date: '2026-06-24',
        baseline_balance: 88
      }]
    );
    assert.equal(db.accounts.find((item) => item.id === accountId)?.balance, 88);
  } finally {
    publicCheckinTestHooks.setAdapterOverride(null);
    await cleanup();
  }
});

test('recovered baseline subtracts earlier same-day rewards before future usage', async () => {
  const { db, cleanup } = await createPublicCheckinDb();
  const rewardAt = Date.UTC(2026, 5, 24, 2, 0, 0) / 1000;
  const recoveryAt = Date.UTC(2026, 5, 24, 4, 0, 0) / 1000;
  const laterAt = Date.UTC(2026, 5, 24, 5, 0, 0) / 1000;

  publicCheckinTestHooks.setAdapterOverride(() => ({
    getBalance: async () => ({ success: true, balance: 110 })
  } as ReturnType<typeof publicCheckinTestHooks.createAdapter>));

  try {
    const { accountId } = await seedPublicCheckinAccount(db);
    addMemoryLog(db, accountId, 10, rewardAt);

    await withFakeNow(recoveryAt, async () => {
      const result = await publicCheckinTestHooks.refreshBalanceForAccount(db, accountId);
      assert.equal(result.success, true);
    });

    assert.equal(db.baselines[0].baseline_balance, 100);
    await withFakeNow(recoveryAt, async () => {
      const accounts = await publicCheckinTestHooks.listAccounts(db);
      assert.equal(accounts[0].dailyBalanceDisplayMode, 'reward');
      assert.equal(accounts[0].dailyBalanceDisplayAmount, 10);
    });

    setMemoryAccountBalance(db, accountId, 105, laterAt);
    await withFakeNow(laterAt, async () => {
      const accounts = await publicCheckinTestHooks.listAccounts(db);
      assert.equal(accounts[0].dailyBalanceDisplayMode, 'usage');
      assert.equal(accounts[0].dailyBalanceDisplayAmount, 5);
    });
  } finally {
    publicCheckinTestHooks.setAdapterOverride(null);
    await cleanup();
  }
});

test('recovered baseline does not overwrite an existing midnight baseline', async () => {
  const { db, cleanup } = await createPublicCheckinDb();
  const now = Date.UTC(2026, 5, 24, 4, 0, 0) / 1000;

  publicCheckinTestHooks.setAdapterOverride(() => ({
    getBalance: async () => ({ success: true, balance: 95 })
  } as ReturnType<typeof publicCheckinTestHooks.createAdapter>));

  try {
    const { accountId } = await seedPublicCheckinAccount(db);
    addMemoryBaseline(db, accountId, '2026-06-24', 100, now - 3600);

    await withFakeNow(now, async () => {
      const result = await publicCheckinTestHooks.refreshBalanceForAccount(db, accountId);
      assert.equal(result.success, true);
    });

    assert.equal(db.baselines.length, 1);
    assert.equal(db.baselines[0].baseline_balance, 100);
    await withFakeNow(now, async () => {
      const accounts = await publicCheckinTestHooks.listAccounts(db);
      assert.equal(accounts[0].dailyBalanceDisplayMode, 'usage');
      assert.equal(accounts[0].dailyBalanceDisplayAmount, 5);
    });
  } finally {
    publicCheckinTestHooks.setAdapterOverride(null);
    await cleanup();
  }
});

test('daily baseline capture stores only successful balance pulls for the local date', async () => {
  const { db, cleanup } = await createPublicCheckinDb();
  const now = Date.UTC(2026, 5, 23, 16, 5, 0) / 1000;
  const originalWarn = console.warn;
  let calls = 0;

  console.warn = () => {};
  publicCheckinTestHooks.setAdapterOverride(() => ({
    getBalance: async () => {
      calls += 1;
      return calls === 1
        ? { success: true, balance: 100 }
        : { success: false, errorMessage: 'upstream failed' };
    }
  } as ReturnType<typeof publicCheckinTestHooks.createAdapter>));

  try {
    const first = await seedPublicCheckinAccount(db);
    const second = await seedPublicCheckinAccount(db);

    await withFakeNow(now, async () => {
      await publicCheckinTestHooks.captureDailyBalanceBaselines(db, 'Asia/Shanghai');
    });

    assert.equal(calls, 2);
    assert.deepEqual(
      db.baselines.map((item) => ({
        account_id: item.account_id,
        local_date: item.local_date,
        baseline_balance: item.baseline_balance
      })),
      [{
        account_id: first.accountId,
        local_date: '2026-06-24',
        baseline_balance: 100
      }]
    );
    assert.equal(db.accounts.find((item) => item.id === first.accountId)?.balance, 100);
    assert.equal(db.accounts.find((item) => item.id === second.accountId)?.balance, null);
  } finally {
    console.warn = originalWarn;
    publicCheckinTestHooks.setAdapterOverride(null);
    await cleanup();
  }
});

test('carries successful checkin balance details for notifications', () => {
  assert.deepEqual(
    publicCheckinTestHooks.buildCheckinResultForNotification(
      {
        success: true,
        rewardNote: '签到成功'
      },
      'success',
      12.65,
      32.84,
      45.49
    ),
    {
      success: true,
      reward: 12.65,
      rewardNote: '签到成功',
      status: 'success',
      balanceBefore: 32.84,
      balanceAfter: 45.49
    }
  );
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

test('builds an empty public checkin model response without throwing', () => {
  assert.deepEqual(
    publicCheckinTestHooks.buildPublicCheckinModelProbeResponse(7, 'Empty Models', { data: [] }),
    {
      accountId: 7,
      siteName: 'Empty Models',
      items: []
    }
  );
  assert.deepEqual(
    publicCheckinTestHooks.buildPublicCheckinModelProbeResponse(8, 'Unknown Shape', { ok: true }),
    {
      accountId: 8,
      siteName: 'Unknown Shape',
      items: []
    }
  );
});

test('builds sorted public checkin model response items', () => {
  assert.deepEqual(
    publicCheckinTestHooks.buildPublicCheckinModelProbeResponse(9, 'Mixed Models', {
      data: [{ id: 'claude-3.5-sonnet' }, { id: 'gpt-4.1' }, { id: 'gpt-4' }]
    }),
    {
      accountId: 9,
      siteName: 'Mixed Models',
      items: [{ model: 'gpt-4' }, { model: 'gpt-4.1' }, { model: 'claude-3.5-sonnet' }]
    }
  );
});

test('extracts text from OpenAI responses payloads', () => {
  assert.equal(
    publicCheckinTestHooks.extractOpenAiResponseText({
      output_text: 'Hi from top level'
    }),
    'Hi from top level'
  );
  assert.equal(
    publicCheckinTestHooks.extractOpenAiResponseText({
      output: [
        {
          content: [
            { type: 'output_text', text: 'Hi from content' }
          ]
        }
      ]
    }),
    'Hi from content'
  );
});

test('normalizes upstream OpenAI-compatible errors', () => {
  assert.equal(
    publicCheckinTestHooks.normalizeOpenAiCompatibleErrorMessage({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Map(),
      setCookieHeaders: [],
      text: '{"error":{"message":"model not found"}}'
    }),
    'model not found'
  );
  assert.equal(
    publicCheckinTestHooks.normalizeOpenAiCompatibleErrorMessage({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      headers: new Map(),
      setCookieHeaders: [],
      text: 'upstream exploded'
    }),
    'upstream exploded'
  );
});

test('probes a specific OpenAI-compatible model with the clicked model name', async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  publicCheckinTestHooks.setOpenAiCompatibleFetchOverride(async (url, init) => {
    calls.push({
      url,
      body: JSON.parse(String(init.body || '{}')) as Record<string, unknown>
    });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      setCookieHeaders: [],
      text: JSON.stringify({ output_text: 'Hi! How can I help you today?' })
    };
  });

  try {
    const result = await publicCheckinTestHooks.probeOpenAiCompatibleModel(
      'https://public.example.test',
      'sk-model-test',
      'claude-3.5-sonnet',
      false,
      ''
    );

    assert.equal(result.success, true);
    assert.equal(result.responseText, 'Hi! How can I help you today?');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://public.example.test/v1/responses');
    assert.equal(calls[0].body.model, 'claude-3.5-sonnet');
    assert.equal(calls[0].body.input, 'Hi');
  } finally {
    publicCheckinTestHooks.setOpenAiCompatibleFetchOverride(null);
  }
});

test('fails model probe when upstream returns success without text', async () => {
  publicCheckinTestHooks.setOpenAiCompatibleFetchOverride(async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Map([['content-type', 'application/json']]),
    setCookieHeaders: [],
    text: JSON.stringify({ output: [] })
  }));

  try {
    const result = await publicCheckinTestHooks.probeOpenAiCompatibleModel(
      'https://public.example.test',
      'sk-model-test',
      'gpt-5.5',
      false,
      ''
    );
    assert.deepEqual(result, {
      success: false,
      errorMessage: '接口返回成功，但没有可识别的文本回复'
    });
  } finally {
    publicCheckinTestHooks.setOpenAiCompatibleFetchOverride(null);
  }
});

test('public checkin model probe route returns response text for clicked model', async () => {
  const { db, cleanup } = await createPublicCheckinDb();
  const app = new Hono<{ Bindings: { DB: D1Database } }>();
  registerPublicCheckinRoutes(app);

  publicCheckinTestHooks.setOpenAiCompatibleFetchOverride(async (_url, init) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Map([['content-type', 'application/json']]),
    setCookieHeaders: [],
    text: JSON.stringify({
      output_text: `echo:${JSON.parse(String(init.body || '{}')).model}`
    })
  }));

  try {
    const { accountId } = await seedPublicCheckinAccount(db);
    const response = await app.request(
      `http://localhost/api/public-checkin/accounts/${accountId}/models/probe`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gemini-2.5-pro' })
      },
      { DB: db }
    );

    assert.equal(response.status, 200);
    const payload = await response.json() as Record<string, unknown>;
    assert.equal(payload.accountId, accountId);
    assert.equal(payload.siteName, '测试公益站');
    assert.equal(payload.model, 'gemini-2.5-pro');
    assert.equal(payload.success, true);
    assert.equal(payload.prompt, 'Hi');
    assert.equal(payload.responseText, 'echo:gemini-2.5-pro');
    assert.equal(payload.errorMessage, null);
    assert.equal(typeof payload.latencyMs, 'number');
    assert.equal(typeof payload.checkedAt, 'number');
  } finally {
    publicCheckinTestHooks.setOpenAiCompatibleFetchOverride(null);
    await cleanup();
  }
});

test('public checkin model probe route validates model name', async () => {
  const { db, cleanup } = await createPublicCheckinDb();
  const app = new Hono<{ Bindings: { DB: D1Database } }>();
  registerPublicCheckinRoutes(app);

  try {
    const { accountId } = await seedPublicCheckinAccount(db);
    const response = await app.request(
      `http://localhost/api/public-checkin/accounts/${accountId}/models/probe`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: '   ' })
      },
      { DB: db }
    );

    assert.equal(response.status, 400);
  } finally {
    await cleanup();
  }
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

test('detects and appends Turnstile checkin tokens', () => {
  assert.equal(publicCheckinTestHooks.isTurnstileTokenMissingMessage('Turnstile token 为空'), true);
  assert.equal(publicCheckinTestHooks.isTurnstileTokenMissingMessage('turnstile token missing'), true);
  assert.equal(publicCheckinTestHooks.isTurnstileTokenMissingMessage('签到失败'), false);
  assert.equal(
    publicCheckinTestHooks.appendTurnstileToRequestPath('/api/user/sign?foo=bar', 'token-value'),
    '/api/user/sign?foo=bar&turnstile=token-value'
  );
  assert.equal(
    publicCheckinTestHooks.withTurnstileRequestBody('{}', 'token-value'),
    '{"turnstile":"token-value"}'
  );
  assert.equal(
    publicCheckinTestHooks.extractYesCaptchaTurnstileToken({ solution: { token: 'solved' } }),
    'solved'
  );
});

test('stores YesCaptcha client key as a plain system config', async () => {
  const db = new PublicCheckinMemoryD1Database();
  const previousKey = process.env.YESCAPTCHA_CLIENT_KEY;
  const previousCompatKey = process.env.YES_CAPTCHA_CLIENT_KEY;
  delete process.env.YESCAPTCHA_CLIENT_KEY;
  delete process.env.YES_CAPTCHA_CLIENT_KEY;

  try {
    const initial = await publicCheckinTestHooks.getYesCaptchaConfig(db);
    assert.equal(initial.clientKey, '');

    const saved = await publicCheckinTestHooks.updateYesCaptchaConfig(db, { clientKey: 'yes-client-key-123' });
    assert.equal(saved.clientKey, 'yes-client-key-123');
    assert.equal(await publicCheckinTestHooks.getConfiguredYesCaptchaClientKey(db), 'yes-client-key-123');

    const stored = db.appSettings.get('yescaptcha_config') || '';
    assert.equal(stored, '{"clientKey":"yes-client-key-123"}');

    await publicCheckinTestHooks.updateYesCaptchaConfig(db, { clientKey: '' });
    assert.equal(await publicCheckinTestHooks.getConfiguredYesCaptchaClientKey(db), '');
  } finally {
    if (previousKey === undefined) {
      delete process.env.YESCAPTCHA_CLIENT_KEY;
    } else {
      process.env.YESCAPTCHA_CLIENT_KEY = previousKey;
    }
    if (previousCompatKey === undefined) {
      delete process.env.YES_CAPTCHA_CLIENT_KEY;
    } else {
      process.env.YES_CAPTCHA_CLIENT_KEY = previousCompatKey;
    }
  }
});

test('YesCaptcha config route reads and writes plain client key', async () => {
  const db = new PublicCheckinMemoryD1Database();
  const app = new Hono<{ Bindings: { DB: D1Database } }>();
  registerPublicCheckinRoutes(app);

  const saved = await app.request(
    'http://localhost/api/system/yescaptcha-config',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: 'plain-client-key' })
    },
    { DB: db }
  );
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { item: { clientKey: 'plain-client-key' } });

  const loaded = await app.request('http://localhost/api/system/yescaptcha-config', {}, { DB: db });
  assert.equal(loaded.status, 200);
  assert.deepEqual(await loaded.json(), { item: { clientKey: 'plain-client-key' } });
});

test('retries checkin with solved Turnstile token when upstream requires it', async () => {
  const adapter = publicCheckinTestHooks.createAdapter('new-api', 'https://ioll.pp.ua', {});
  const calls: Array<{ path: string; body?: string }> = [];
  (adapter as unknown as { resolveTurnstileToken: () => Promise<string> }).resolveTurnstileToken = async () => 'solved-token';
  (adapter as unknown as {
    fetchJson: (path: string, init: { body?: string }) => Promise<Record<string, unknown>>;
  }).fetchJson = async (path, init) => {
    calls.push({ path, body: init.body });
    if (!path.includes('turnstile=solved-token')) {
      return { success: false, message: 'Turnstile token 为空' };
    }
    return { success: true, message: '签到成功，获得 25 额度', data: { reward: 25 } };
  };

  const result = await adapter.checkin({ type: 'access_token', accessToken: 'sk-test' });

  assert.equal(result.success, true);
  assert.equal(result.reward, 25);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, '/api/user/checkin');
  assert.equal(calls[1].path, '/api/user/checkin?turnstile=solved-token');
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

test('extracts notification and system announcement payloads into one announcement flow', () => {
  const items = publicCheckinTestHooks.extractAnnouncementsFromNoticePayload({
    data: {
      notice: '常规通知内容',
      systemNotice: '<b>系统公告内容</b>',
      announcements: [
        {
          id: 'upstream-1',
          title: '额度规则更新',
          content: '规则正文',
          url: 'https://public.example.test/notice/1'
        },
        {
          id: 'upstream-1',
          title: '额度规则更新重复',
          content: '规则正文重复'
        }
      ]
    }
  });

  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((item) => [item.title, item.level]),
    [
      ['通知', 'info'],
      ['系统公告', 'warning'],
      ['额度规则更新', 'info']
    ]
  );
  assert.equal(items[2].sourceKey, 'id:upstream-1');
  assert.equal(items[2].sourceUrl, 'https://public.example.test/notice/1');
});

test('syncs public checkin announcements by site with insert-only notifications and read state', async () => {
  const { db, cleanup } = await createPublicCheckinDb();
  const notifications: Array<{ siteName: string; title: string; content: string; sourceUrl?: string | null }> = [];
  let fetchCount = 0;

  publicCheckinTestHooks.setAdapterOverride(() => ({
    getAnnouncements: async () => {
      fetchCount += 1;
      return [
        {
          sourceKey: 'notice-1',
          title: fetchCount === 1 ? '首次公告' : '首次公告已更新',
          content: fetchCount === 1 ? '第一版正文' : '第二版正文',
          level: 'info',
          sourceUrl: 'https://public.example.test/notice'
        }
      ];
    }
  } as ReturnType<typeof publicCheckinTestHooks.createAdapter>));
  publicCheckinTestHooks.setAnnouncementNotificationSenderOverride(async (_db, item) => {
    notifications.push(item);
  });

  try {
    const { siteId, accountId } = await seedPublicCheckinAccount(db);
    await seedPublicCheckinAccount(db, siteId);

    const firstSync = await publicCheckinTestHooks.syncAnnouncementsForSite(db, siteId);
    assert.equal(fetchCount, 1);
    assert.equal(firstSync.length, 1);
    assert.equal(firstSync[0].title, '首次公告');
    assert.equal(firstSync[0].readAt, null);
    assert.deepEqual(notifications.map((item) => item.title), ['首次公告']);

    const secondSync = await publicCheckinTestHooks.syncAnnouncementsForSite(db, siteId);
    assert.equal(fetchCount, 2);
    assert.equal(secondSync.length, 1);
    assert.equal(secondSync[0].title, '首次公告已更新');
    assert.equal(secondSync[0].content, '第二版正文');
    assert.equal(notifications.length, 1);

    const accountAnnouncements = await publicCheckinTestHooks.listAnnouncementsForAccount(db, accountId);
    assert.equal(accountAnnouncements.length, 1);
    assert.equal(accountAnnouncements[0].readAt, null);

    await publicCheckinTestHooks.markAnnouncementsReadForSite(db, siteId);
    const readAnnouncements = await publicCheckinTestHooks.listAnnouncementsForAccount(db, accountId);
    assert.ok(readAnnouncements[0].readAt);
  } finally {
    publicCheckinTestHooks.setAdapterOverride(null);
    publicCheckinTestHooks.setAnnouncementNotificationSenderOverride(null);
    await cleanup();
  }
});

test('public checkin settings route saves announcement polling interval', async () => {
  const { db, cleanup } = await createPublicCheckinDb();
  const app = new Hono<{ Bindings: { DB: D1Database } }>();
  registerPublicCheckinRoutes(app);

  try {
    const response = await app.request(
      'http://localhost/api/public-checkin/settings',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkinTime: '09:30',
          timezone: 'Asia/Shanghai',
          announcementPollingIntervalMinutes: 15
        })
      },
      { DB: db }
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      checkinCron: '30 9 * * *',
      checkinTime: '09:30',
      timezone: 'Asia/Shanghai',
      announcementPollingIntervalMinutes: 15
    });

    const loaded = await app.request('http://localhost/api/public-checkin/settings', {}, { DB: db });
    assert.equal(loaded.status, 200);
    assert.equal((await loaded.json()).announcementPollingIntervalMinutes, 15);

    const invalid = await app.request(
      'http://localhost/api/public-checkin/settings',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkinTime: '09:30',
          timezone: 'Asia/Shanghai',
          announcementPollingIntervalMinutes: 10
        })
      },
      { DB: db }
    );
    assert.equal(invalid.status, 400);
  } finally {
    await cleanup();
  }
});
