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
  assert.match(message, /总数：3/);
  assert.match(message, /成功：1/);
  assert.match(message, /失败：1/);
  assert.match(message, /跳过：1/);
  assert.match(message, /奖励合计：2.50/);
  assert.match(message, /站点 B：access token 无效/);
  assert.match(message, /站点 C：已有签到任务在进行中/);
});

test('limits Telegram message length', () => {
  const message = notificationTestHooks.limitTelegramText('x'.repeat(5000), 80);
  assert.equal(message.length, 80);
  assert.match(message, /已截断$/);
});
