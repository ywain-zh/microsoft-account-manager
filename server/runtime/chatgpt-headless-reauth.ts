import type { Sub2ApiReauthLogLevel, Sub2ApiReauthTarget } from './sub2api-reauth.js';

export interface ChatGptHeadlessReauthOptions {
  target: Sub2ApiReauthTarget;
  password?: string;
  headless?: boolean;
  timeoutMs?: number;
  onLog: (level: Sub2ApiReauthLogLevel, message: string, target?: Sub2ApiReauthTarget) => void;
  readVerificationCode: (email: string, startedAt: Date) => Promise<string | null>;
  isAborted?: () => boolean;
}

export interface ChatGptHeadlessReauthResult {
  sessionPayload: unknown;
  accessToken: string;
}

interface BrowserLike {
  newPage(options?: Record<string, unknown>): Promise<PageLike>;
  close(): Promise<void>;
}

interface LocatorLike {
  first(): LocatorLike;
  last(): LocatorLike;
  nth(index: number): LocatorLike;
  or(locator: LocatorLike): LocatorLike;
  locator(selector: string): LocatorLike;
  getByRole(role: string, options?: Record<string, unknown>): LocatorLike;
  count(): Promise<number>;
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  waitFor(options?: { state?: string; timeout?: number }): Promise<void>;
  isVisible(options?: { timeout?: number }): Promise<boolean>;
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  press(key: string): Promise<void>;
}

interface PageLike {
  setDefaultTimeout(timeout: number): void;
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  waitForLoadState(state: string, options?: { timeout?: number }): Promise<unknown>;
  waitForTimeout(timeout: number): Promise<void>;
  getByRole(role: string, options?: Record<string, unknown>): LocatorLike;
  locator(selector: string): LocatorLike;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  waitForURL(predicate: (url: URL) => boolean, options?: { timeout?: number }): Promise<unknown>;
  evaluate<T>(callback: () => Promise<T> | T): Promise<T>;
  keyboard: {
    type(text: string, options?: { delay?: number }): Promise<void>;
    press(key: string): Promise<void>;
  };
}

interface PlaywrightLike {
  chromium: {
    launch(options?: Record<string, unknown>): Promise<BrowserLike>;
  };
}

const CHATGPT_URL = 'https://chatgpt.com/';
const DEFAULT_TIMEOUT_MS = 180000;

export async function runChatGptHeadlessReauth(
  options: ChatGptHeadlessReauthOptions
): Promise<ChatGptHeadlessReauthResult> {
  const email = normalizeEmail(options.target.accountEmail);
  if (!email) {
    throw new Error('目标邮箱不能为空');
  }

  const playwright = await loadPlaywright();
  const startedAt = new Date();
  let browser: BrowserLike | null = null;

  try {
    options.onLog('info', '步骤 1：打开 ChatGPT 官网', options.target);
    browser = await playwright.chromium.launch({
      headless: options.headless !== false,
      args: ['--disable-blink-features=AutomationControlled']
    });
    const page = await browser.newPage({
      viewport: { width: 1365, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    });
    page.setDefaultTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
    options.onLog('success', '步骤 1 完成：ChatGPT 官网已打开', options.target);

    options.onLog('info', `步骤 2：登录并输入邮箱 ${email}`, options.target);
    await startLogin(page);
    await fillEmail(page, email);
    if (options.password) {
      await fillPasswordIfPresent(page, options.password);
    }
    options.onLog('success', '步骤 2 完成：已提交邮箱，等待验证码', options.target);

    options.onLog('info', '步骤 3：从工具箱邮箱读取登录验证码', options.target);
    const code = await waitForVerificationCode(options, email, startedAt);
    if (!code) {
      throw new Error('未读取到 ChatGPT 登录验证码');
    }
    await fillVerificationCode(page, code);
    options.onLog('success', '步骤 3 完成：验证码已提交', options.target);

    options.onLog('info', '步骤 4：读取当前 ChatGPT 会话', options.target);
    await waitForLoggedIn(page);
    const sessionPayload = await readChatGptSession(page);
    const accessToken = normalizeText(readRecord(sessionPayload)?.accessToken ?? readRecord(sessionPayload)?.access_token);
    if (!accessToken) {
      throw new Error('ChatGPT session 中缺少 accessToken');
    }
    options.onLog('success', '步骤 4 准备完成：已获取 ChatGPT 会话，开始交给 Sub2API 导入', options.target);

    return { sessionPayload, accessToken };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function loadPlaywright(): Promise<PlaywrightLike> {
  try {
    const moduleName = 'playwright';
    return await import(moduleName) as PlaywrightLike;
  } catch {
    throw new Error('当前项目尚未安装 Playwright，请先执行 npm install playwright 并安装浏览器依赖');
  }
}

async function startLogin(page: PageLike): Promise<void> {
  const loginButton = page
    .getByRole('button', { name: /^log in$|^登录$/i })
    .or(page.getByRole('link', { name: /^log in$|^登录$/i }))
    .first();
  if (await loginButton.isVisible({ timeout: 30000 }).catch(() => false)) {
    await humanDelay(page, 500, 1200);
    await loginButton.click();
    return;
  }

  const emailInput = await findEmailInput(page);
  if (!emailInput) {
    await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
  }
}

async function fillEmail(page: PageLike, email: string): Promise<void> {
  const input = await waitForEmailInput(page);
  await humanDelay(page, 500, 1200);
  await input.click();
  await input.fill('');
  await typeHuman(page, email, 40, 120);
  await humanDelay(page, 600, 1400);
  await clickEmailContinue(page, input);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
}

async function fillPasswordIfPresent(page: PageLike, password: string): Promise<void> {
  const passwordInput = page.locator('input[type="password"]').first();
  if (!(await passwordInput.isVisible({ timeout: 8000 }).catch(() => false))) {
    return;
  }
  await humanDelay(page, 500, 1200);
  await passwordInput.click();
  await passwordInput.fill('');
  await typeHuman(page, password, 50, 130);
  await humanDelay(page, 600, 1400);
  await passwordInput.press('Enter');
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
}

async function fillVerificationCode(page: PageLike, code: string): Promise<void> {
  const codeInput = page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="code" i]').first();
  if (await codeInput.isVisible({ timeout: 30000 }).catch(() => false)) {
    await humanDelay(page, 500, 1200);
    await codeInput.click();
    await codeInput.fill('');
    await typeHuman(page, code, 60, 160);
    await humanDelay(page, 600, 1400);
    const continueButton = page.getByRole('button', { name: /^continue$|^继续$/i }).last();
    if (await continueButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await continueButton.click();
    } else {
      await codeInput.press('Enter');
    }
    return;
  }

  await typeHuman(page, code, 60, 160);
  await humanDelay(page, 600, 1400);
  await page.keyboard.press('Enter');
}

async function waitForLoggedIn(page: PageLike): Promise<void> {
  await page.waitForURL((url) => url.hostname === 'chatgpt.com' && !/auth|login|email-verification/i.test(url.href), { timeout: 120000 }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
  await humanDelay(page, 1500, 3000);
}

async function readChatGptSession(page: PageLike): Promise<unknown> {
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/auth/session', { credentials: 'include' });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      json,
      textLength: text.length
    };
  });

  const record = readRecord(result);
  if (!record?.ok) {
    throw new Error(`读取 ChatGPT session 失败 (${record?.status ?? 'unknown'})`);
  }
  return record.json;
}

async function waitForVerificationCode(
  options: ChatGptHeadlessReauthOptions,
  email: string,
  startedAt: Date
): Promise<string | null> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (options.isAborted?.()) {
      return null;
    }
    const code = await options.readVerificationCode(email, startedAt);
    if (code) {
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return null;
}

async function waitForEmailInput(page: PageLike) {
  const existing = await findEmailInput(page);
  if (existing) {
    return existing;
  }

  await page.waitForSelector('input[type="email"], input[name="email"], input[autocomplete="email"], input[placeholder*="Email" i]', { timeout: 60000 });
  const input = await findEmailInput(page);
  if (!input) {
    throw new Error('未找到 ChatGPT 邮箱输入框');
  }
  return input;
}

async function findEmailInput(page: PageLike) {
  const dialog = page.getByRole('dialog').first();
  if (await dialog.isVisible({ timeout: 1000 }).catch(() => false)) {
    const input = dialog.locator('input[type="email"], input[name="email"], input[autocomplete="email"], input[placeholder*="Email" i]').last();
    if (await input.isVisible({ timeout: 1000 }).catch(() => false)) {
      return input;
    }
  }

  const selectors = ['input[type="email"]', 'input[name="email"]', 'input[autocomplete="email"]', 'input[placeholder*="Email" i]'];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 1000 }).catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function clickEmailContinue(page: PageLike, emailInput: LocatorLike): Promise<void> {
  const emailBox = await emailInput.boundingBox().catch(() => null);
  const dialog = page.getByRole('dialog').first();
  const scope = await dialog.isVisible({ timeout: 1000 }).catch(() => false) ? dialog : page.locator('body').first();
  const buttons = scope.getByRole('button', { name: /^continue$|^继续$/i });
  const count = await buttons.count().catch(() => 0);

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const box = await button.boundingBox().catch(() => null);
    if (emailBox && box && box.y > emailBox.y) {
      await button.click();
      return;
    }
  }

  await emailInput.press('Enter');
}

async function typeHuman(page: PageLike, text: string, minDelay: number, maxDelay: number): Promise<void> {
  await page.keyboard.type(text, { delay: randomInteger(minDelay, maxDelay) });
}

async function humanDelay(page: PageLike, minMs: number, maxMs: number): Promise<void> {
  await page.waitForTimeout(randomInteger(minMs, maxMs));
}

function randomInteger(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function normalizeEmail(value: unknown): string {
  const email = normalizeText(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}
