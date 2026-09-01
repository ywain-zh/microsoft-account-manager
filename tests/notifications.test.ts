import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getNotificationConfig,
  notificationTestHooks,
  sendTelegramTestNotification,
  updateNotificationConfig
} from '../server/runtime/notifications.ts';

process.env.NOTIFICATION_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

class MemoryStatement {
  private readonly database: MemoryD1Database;
  private readonly query: string;
  private readonly values: unknown[];

  constructor(database: MemoryD1Database, query: string, values: unknown[] = []) {
    this.database = database;
    this.query = query;
    this.values = values;
  }

  bind(...values: unknown[]): MemoryStatement {
    return new MemoryStatement(this.database, this.query, values);
  }

  async first<T>(): Promise<T | null> {
    if (/SELECT value FROM app_settings/i.test(this.query)) {
      const value = this.database.settings.get(String(this.values[0]));
      return value == null ? null : { value } as T;
    }
    if (/SELECT value FROM public_checkin_settings/i.test(this.query)) {
      const value = this.database.publicCheckinSettings.get(String(this.values[0]));
      return value == null ? null : { value } as T;
    }
    throw new Error(`Unsupported first query: ${this.query}`);
  }

  async run(): Promise<D1Result> {
    if (/INSERT INTO app_settings/i.test(this.query)) {
      this.database.settings.set(String(this.values[0]), String(this.values[1]));
      return { success: true, meta: { changes: 1, rows_written: 1 } };
    }
    throw new Error(`Unsupported run query: ${this.query}`);
  }

  async all<T>(): Promise<{ results: T[]; success: boolean; meta: D1Result['meta'] }> {
    return { results: [], success: true, meta: { rows_read: 0 } };
  }
}

class MemoryD1Database {
  readonly settings = new Map<string, string>();
  readonly publicCheckinSettings = new Map<string, string>();

  prepare(query: string): MemoryStatement {
    return new MemoryStatement(this, query);
  }

  async exec(): Promise<D1Result> {
    return { success: true, meta: {} };
  }

  close(): void {}
}

async function createDb(): Promise<D1Database> {
  return new MemoryD1Database() as unknown as D1Database;
}

test('saves and returns Telegram notification config with hidden-by-default token value', async () => {
  const db = await createDb();
  try {
    const botToken = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';
    const saved = await updateNotificationConfig(db, {
      telegram: {
        enabled: true,
        botToken,
        chatId: '10086',
        useSystemProxy: true
      }
    });

    assert.equal(saved.telegram.enabled, true);
    assert.equal(saved.telegram.botTokenConfigured, true);
    assert.equal(saved.telegram.botToken, botToken);

    const loaded = await getNotificationConfig(db);
    assert.equal(loaded.telegram.botTokenConfigured, true);
    assert.equal(loaded.telegram.botToken, botToken);

    const preserved = await updateNotificationConfig(db, {
      telegram: {
        enabled: true,
        botToken: '',
        chatId: '-1001234567890',
        useSystemProxy: false
      }
    });

    assert.equal(preserved.telegram.botTokenConfigured, true);
    assert.equal(preserved.telegram.botToken, botToken);
    assert.equal(preserved.telegram.chatId, '-1001234567890');
    assert.equal(preserved.telegram.useSystemProxy, false);

    const cleared = await updateNotificationConfig(db, {
      telegram: {
        enabled: false,
        clearBotToken: true,
        chatId: '',
        useSystemProxy: true
      }
    });

    assert.equal(cleared.telegram.botTokenConfigured, false);
    assert.equal(cleared.telegram.botToken, '');
  } finally {
    db.close();
  }
});

test('rejects enabled Telegram config without token or chat id', async () => {
  const db = await createDb();
  try {
    await assert.rejects(
      () => updateNotificationConfig(db, {
        telegram: {
          enabled: true,
          chatId: '10086',
          useSystemProxy: true
        }
      }),
      /Telegram Bot Token/
    );

    await updateNotificationConfig(db, {
      telegram: {
        enabled: false,
        botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef',
        chatId: '',
        useSystemProxy: true
      }
    });
    await assert.rejects(
      () => updateNotificationConfig(db, {
        telegram: {
          enabled: true,
          botToken: '',
          chatId: '',
          useSystemProxy: true
        }
      }),
      /Telegram Chat ID/
    );
  } finally {
    db.close();
  }
});

test('test notification reports incomplete saved configuration', async () => {
  const db = await createDb();
  try {
    assert.deepEqual(await getNotificationConfig(db), {
      telegram: {
        enabled: false,
        botToken: '',
        botTokenConfigured: false,
        clearBotToken: false,
        chatId: '',
        useSystemProxy: true
      }
    });

    assert.deepEqual(await sendTelegramTestNotification(db), {
      ok: false,
      message: 'Telegram 通知未启用'
    });
  } finally {
    db.close();
  }
});

test('builds public checkin summary message with failures and reward total', () => {
  const message = notificationTestHooks.buildPublicCheckinSummaryMessage([
    {
      accountId: 1,
      siteName: '站点 A',
      result: {
        success: true,
        status: 'success',
        reward: 2.5
      }
    },
    {
      accountId: 2,
      siteName: '站点 B',
      result: {
        success: false,
        status: 'failed',
        errorMessage: 'access token 无效'
      }
    },
    {
      accountId: 3,
      siteName: '站点 C',
      result: {
        success: true,
        status: 'skipped',
        errorMessage: '已有签到任务在进行中'
      }
    }
  ], new Date('2026-06-19T00:00:00Z'));

  assert.match(message, /公益站每日签到汇总/);
  assert.match(message, /时间：2026\/6\/19 08:00:00/);
  assert.match(message, /总数：3/);
  assert.match(message, /成功：1/);
  assert.match(message, /失败：1/);
  assert.match(message, /跳过：1/);
  assert.match(message, /奖励合计：2.50/);
  assert.match(message, /站点 B：access token 无效/);
  assert.match(message, /站点 C：已有签到任务在进行中/);
  assert.match(message, /<blockquote expandable>/);
  assert.match(message, /1\. 站点 A：总额度 -，今日新增 \+2\.50/);
  assert.match(message, /<\/blockquote>/);
});

test('renders a GLaDOS run in the shared summary with its real points increment', () => {
  const message = notificationTestHooks.buildPublicCheckinSummaryMessage([
    {
      accountId: 7,
      label: 'GLaDOS A',
      siteName: 'GLaDOS',
      result: {
        success: true,
        status: 'success',
        reward: 3,
        balanceBefore: 41,
        balanceAfter: 44
      }
    }
  ], new Date('2026-09-01T02:00:00Z'));

  assert.match(message, /GLaDOS A：总额度 44\.00，今日新增 \+3\.00/);
});

test('builds collapsed public checkin success details with balances and HTML escaping', () => {
  const message = notificationTestHooks.buildPublicCheckinSummaryMessage([
    {
      accountId: 1,
      siteName: '站点 <A> & Co',
      result: {
        success: true,
        status: 'success',
        reward: 12.65,
        balanceBefore: 32.84,
        balanceAfter: 45.49
      }
    },
    {
      accountId: 2,
      siteName: '站点 B',
      result: {
        success: true,
        status: 'success',
        reward: null,
        balanceBefore: 10,
        balanceAfter: 11.25
      }
    },
    {
      accountId: 3,
      siteName: '站点 C',
      result: {
        success: true,
        status: 'success',
        reward: null,
        balanceBefore: null,
        balanceAfter: null
      }
    }
  ], new Date('2026-06-19T00:00:00Z'));

  assert.match(message, /成功明细：\n<blockquote expandable>/);
  assert.match(message, /1\. 站点 &lt;A&gt; &amp; Co：总额度 45\.49，今日新增 \+12\.65/);
  assert.match(message, /2\. 站点 B：总额度 11\.25，今日新增 \+1\.25/);
  assert.match(message, /3\. 站点 C：总额度 -，今日新增 -/);
});

test('keeps abnormal public checkin details visible outside collapsed success block', () => {
  const message = notificationTestHooks.buildPublicCheckinSummaryMessage([
    {
      accountId: 1,
      siteName: '站点 A',
      result: {
        success: true,
        status: 'success',
        reward: 1,
        balanceAfter: 2
      }
    },
    {
      accountId: 2,
      siteName: '坏站 <B>',
      result: {
        success: false,
        status: 'failed',
        errorMessage: 'token <失效>'
      }
    }
  ], new Date('2026-06-19T00:00:00Z'));
  const abnormalIndex = message.indexOf('异常明细：');
  const collapsedIndex = message.indexOf('<blockquote expandable>');

  assert.ok(abnormalIndex >= 0);
  assert.ok(collapsedIndex > abnormalIndex);
  assert.match(message, /坏站 &lt;B&gt;：token &lt;失效&gt;/);
});

test('builds Telegram send payload with HTML parse mode', () => {
  assert.deepEqual(
    notificationTestHooks.buildTelegramSendMessageBody({
      chatId: '-100123',
      text: '<b>hello</b>'
    }),
    {
      chat_id: '-100123',
      text: '<b>hello</b>',
      parse_mode: 'HTML',
      disable_web_page_preview: true
    }
  );
});

test('limits overlong public checkin summary messages', () => {
  const items = Array.from({ length: 500 }, (_, index) => ({
    accountId: index + 1,
    siteName: `站点 ${index + 1}`,
    result: {
      success: true,
      status: 'success' as const,
      reward: 1,
      balanceAfter: 100 + index
    }
  }));
  const message = notificationTestHooks.buildPublicCheckinSummaryMessage(items);

  assert.ok(message.length <= 3900);
  assert.match(message, /还有 \d+ 条成功未展示。/);
  assert.match(message, /<\/blockquote>$/);
});

test('uses configured public checkin timezone for notification timestamps', async () => {
  const db = await createDb();
  try {
    (db as unknown as MemoryD1Database).publicCheckinSettings.set('timezone', 'Asia/Shanghai');
    const timezone = await notificationTestHooks.getPublicCheckinNotificationTimezone(db);
    const message = notificationTestHooks.buildPublicCheckinSummaryMessage(
      [],
      new Date('2026-06-19T00:00:00Z'),
      timezone
    );

    assert.equal(timezone, 'Asia/Shanghai');
    assert.match(message, /时间：2026\/6\/19 08:00:00/);
  } finally {
    db.close();
  }
});

test('formats public checkin error notification with configured timezone', () => {
  const message = notificationTestHooks.buildPublicCheckinErrorMessage(
    new Error('boom'),
    new Date('2026-06-19T00:00:00Z'),
    'Asia/Shanghai'
  );

  assert.match(message, /公益站定时签到异常/);
  assert.match(message, /时间：2026\/6\/19 08:00:00/);
});

test('formats public checkin announcement notification with escaping and source link', () => {
  const message = notificationTestHooks.buildPublicCheckinAnnouncementMessage(
    {
      siteName: '公益站 <A> & Co',
      title: '通知 <升级>',
      content: `<b>新公告</b> ${'x'.repeat(420)}`,
      sourceUrl: 'https://public.example.test/notice?id=1&from=bot',
      discoveredAt: Math.floor(Date.parse('2026-06-22T00:00:00Z') / 1000)
    },
    new Date('2026-06-22T00:00:00Z'),
    'Asia/Shanghai'
  );

  assert.match(message, /公益站新公告/);
  assert.match(message, /发现时间：2026\/6\/22 08:00:00/);
  assert.match(message, /站点：公益站 &lt;A&gt; &amp; Co/);
  assert.match(message, /标题：通知 &lt;升级&gt;/);
  assert.doesNotMatch(message, /<b>新公告<\/b>/);
  assert.match(message, /摘要：新公告 x+/);
  assert.match(message, /来源：https:\/\/public\.example\.test\/notice\?id=1&amp;from=bot/);
  assert.ok(message.length <= 3900);
});

test('limits Telegram message length', () => {
  const message = notificationTestHooks.limitTelegramText('x'.repeat(5000), 80);
  assert.equal(message.length, 80);
  assert.match(message, /已截断$/);
});
