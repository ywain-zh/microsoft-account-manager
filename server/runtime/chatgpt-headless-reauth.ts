import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { Sub2ApiReauthLogLevel, Sub2ApiReauthTarget } from './sub2api-reauth.js';

export interface ChatGptHeadlessReauthOptions {
  target: Sub2ApiReauthTarget;
  password?: string;
  headless?: boolean;
  timeoutMs?: number;
  onLog: (level: Sub2ApiReauthLogLevel, message: string, target?: Sub2ApiReauthTarget) => void;
  readVerificationCode: (email: string, startedAt: Date) => Promise<string | null>;
  oauthUrl?: string;
  isAborted?: () => boolean;
}

export interface ChatGptHeadlessReauthResult {
  sessionPayload?: unknown;
  accessToken?: string;
  oauthCallbackUrl?: string;
}

interface BrowserLike {
  newPage(options?: Record<string, unknown>): Promise<PageLike>;
  version?(): Promise<string> | string;
  close(): Promise<void>;
}

interface BrowserContextLike {
  pages(): PageLike[];
  newPage(): Promise<PageLike>;
  browser?(): BrowserLike | null;
  close(): Promise<void>;
}

interface BrowserSessionLike {
  page: PageLike;
  info: BrowserSessionInfo;
  close(): Promise<void>;
  browserVersion(): Promise<number>;
}

interface BrowserSessionInfo {
  headless: boolean;
  persistentProfile: boolean;
  profileDir: string | null;
  channel: string;
}

interface BrowserProfile {
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
  userAgent: string;
  locale: string;
  timezoneId: string;
  colorScheme: 'light' | 'dark';
  deviceScaleFactor: number;
  reducedMotion: 'no-preference' | 'reduce';
  typingDelay: { min: number; max: number };
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
  addInitScript(script: string): Promise<void>;
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  waitForLoadState(state: string, options?: { timeout?: number }): Promise<unknown>;
  waitForTimeout(timeout: number): Promise<void>;
  getByRole(role: string, options?: Record<string, unknown>): LocatorLike;
  locator(selector: string): LocatorLike;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  waitForURL(predicate: (url: URL) => boolean, options?: { timeout?: number }): Promise<unknown>;
  url?(): string;
  evaluate<T>(callback: () => Promise<T> | T): Promise<T>;
  title(): Promise<string>;
  content(): Promise<string>;
  screenshot(options?: Record<string, unknown>): Promise<Buffer>;
  keyboard: {
    type(text: string, options?: { delay?: number }): Promise<void>;
    press(key: string): Promise<void>;
  };
  mouse: {
    move(x: number, y: number, options?: { steps?: number }): Promise<void>;
    click(x: number, y: number, options?: { delay?: number }): Promise<void>;
  };
}

interface PlaywrightLike {
  chromium: {
    launch(options?: Record<string, unknown>): Promise<BrowserLike>;
    launchPersistentContext(userDataDir: string, options?: Record<string, unknown>): Promise<BrowserContextLike>;
  };
}

const CHATGPT_URL = 'https://chatgpt.com/';
const DEFAULT_TIMEOUT_MS = 180000;
const VERIFICATION_CODE_POLL_INTERVAL_MS = 2000;
const DEFAULT_PROFILE_BASE_DIR = 'data/browser-profiles/chatgpt';
const DEFAULT_DEBUG_BASE_DIR = 'data/reauth-debug';

export async function runChatGptHeadlessReauth(
  options: ChatGptHeadlessReauthOptions
): Promise<ChatGptHeadlessReauthResult> {
  const email = normalizeEmail(options.target.accountEmail);
  if (!email) {
    throw new Error('目标邮箱不能为空');
  }

  const playwright = await loadPlaywright();
  const startedAt = new Date();
  let session: BrowserSessionLike | null = null;
  let page: PageLike | null = null;

  try {
    options.onLog('info', '步骤 1：点击登录前打开 ChatGPT 官网', options.target);
    const profile = createBrowserProfile();
    session = await createBrowserSession(playwright, profile, email, options);
    profile.userAgent = createWindowsChromeUserAgent(await session.browserVersion());
    page = session.page;
    options.onLog('info', `浏览器模式：${session.info.headless ? '后台 headless' : '可视化 headful'}，${session.info.persistentProfile ? '持久化 profile' : '临时 profile'}${session.info.channel ? `，channel=${session.info.channel}` : ''}`, options.target);
    if (session.info.profileDir) {
      options.onLog('info', `浏览器 profile：${session.info.profileDir}`, options.target);
    }
    options.onLog('info', `浏览器画像：${profile.locale} / ${profile.timezoneId} / ${profile.viewport.width}x${profile.viewport.height} / DPR ${profile.deviceScaleFactor}`, options.target);
    page.setDefaultTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    await installBrowserProfileScript(page, profile);
    await warmUpPage(page, profile);
    await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
    await logPageState(options, page, '步骤 1 页面状态');
    options.onLog('success', '步骤 1 完成：ChatGPT 官网已打开，准备点击登录', options.target);

    const existingSession = await tryReadExistingChatGptSession(page, email);
    if (existingSession) {
      options.onLog('success', '检测到持久化 profile 中已有有效 ChatGPT 会话，跳过邮箱验证码登录', options.target);
      if (options.oauthUrl) {
        return { oauthCallbackUrl: await completeOAuthAuthorization(page, options) };
      }
      return existingSession;
    }

    options.onLog('info', `步骤 2：输入邮箱 ${email}`, options.target);
    await startLogin(page);
    await fillEmail(page, email, profile);
    await logPageState(options, page, '步骤 2 提交邮箱后页面状态');
    if (options.password) {
      await fillPasswordIfPresent(page, options.password, profile);
    }
    await assertReadyForVerificationCode(page);
    options.onLog('success', '步骤 2 完成：已提交邮箱，等待验证码', options.target);

    options.onLog('info', '步骤 3：从工具箱邮箱读取登录验证码', options.target);
    const code = await waitForVerificationCode(options, email, startedAt);
    if (!code) {
      throw new Error('未读取到 ChatGPT 登录验证码');
    }
    await fillVerificationCode(page, code, profile);
    options.onLog('success', '步骤 3 完成：验证码已提交', options.target);

    await waitForLoggedIn(page);
    if (options.oauthUrl) {
      return { oauthCallbackUrl: await completeOAuthAuthorization(page, options) };
    }

    options.onLog('info', '步骤 4：读取当前 ChatGPT 会话', options.target);
    const sessionPayload = await readChatGptSession(page);
    const accessToken = normalizeText(readRecord(sessionPayload)?.accessToken ?? readRecord(sessionPayload)?.access_token);
    if (!accessToken) {
      throw new Error('ChatGPT session 中缺少 accessToken');
    }
    options.onLog('success', '步骤 4 准备完成：已获取 ChatGPT 会话，开始交给 Sub2API 导入', options.target);

    return { sessionPayload, accessToken };
  } catch (error) {
    if (page) {
      const debugDir = await saveDebugArtifacts(page, email, getErrorMessage(error)).catch(() => '');
      if (debugDir) {
        options.onLog('warning', `已保存登录失败调试快照：${debugDir}`, options.target);
      }
    }
    throw error;
  } finally {
    await session?.close().catch(() => undefined);
  }
}

async function completeOAuthAuthorization(page: PageLike, options: ChatGptHeadlessReauthOptions): Promise<string> {
  const oauthUrl = normalizeText(options.oauthUrl);
  if (!oauthUrl) {
    throw new Error('缺少 SUB2API OAuth 登录地址');
  }

  options.onLog('info', '步骤 4：刷新 OAuth并登录，正在打开 SUB2API OAuth 地址', options.target);
  await page.goto(oauthUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => undefined);
  await logPageState(options, page, '步骤 4 OAuth 页面状态');

  options.onLog('info', '步骤 5：自动确认 OAuth，正在查找授权继续按钮并监听 localhost 回调', options.target);
  const callbackPromise = waitForLocalhostCallback(page, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  await clickOAuthConsentContinue(page);
  const callbackUrl = await callbackPromise;
  options.onLog('success', `步骤 5 完成：已捕获 localhost OAuth 回调：${redactCallbackUrl(callbackUrl)}`, options.target);
  return callbackUrl;
}

async function clickOAuthConsentContinue(page: PageLike): Promise<void> {
  const buttons = [
    page.getByRole('button', { name: /^(continue|authorize|allow|accept|继续|授权|允许|同意)$/i }).first(),
    page.locator('button:has-text("Continue"), button:has-text("继续"), button:has-text("Authorize"), button:has-text("授权"), button:has-text("Allow"), button:has-text("允许")').first(),
    page.locator('input[type="submit"], button[type="submit"]').first()
  ];

  for (let round = 1; round <= 3; round += 1) {
    for (const button of buttons) {
      if (await button.isVisible({ timeout: 5000 }).catch(() => false)) {
        await humanClick(page, button);
        return;
      }
    }
    await page.waitForTimeout(1200);
  }

  throw new Error('步骤 5 失败：未找到 OAuth 授权继续按钮');
}

async function waitForLocalhostCallback(page: PageLike, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + Math.max(30000, timeoutMs);
  while (Date.now() < deadline) {
    const currentUrl = typeof page.url === 'function' ? page.url() : await page.evaluate(() => location.href).catch(() => '');
    if (isLocalhostOAuthCallbackUrl(currentUrl)) {
      return currentUrl;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`步骤 5 失败：${Math.round(Math.max(30000, timeoutMs) / 1000)} 秒内未捕获到 localhost OAuth 回调`);
}

function isLocalhostOAuthCallbackUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return ['localhost', '127.0.0.1'].includes(url.hostname)
      && ['/auth/callback', '/codex/callback'].includes(url.pathname)
      && Boolean(url.searchParams.get('code'))
      && Boolean(url.searchParams.get('state'));
  } catch {
    return false;
  }
}

function redactCallbackUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.searchParams.has('code')) {
      url.searchParams.set('code', '[REDACTED]');
    }
    return url.toString();
  } catch {
    return '[invalid callback url]';
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

async function createBrowserSession(
  playwright: PlaywrightLike,
  profile: BrowserProfile,
  email: string,
  options: ChatGptHeadlessReauthOptions
): Promise<BrowserSessionLike> {
  const headless = resolveBrowserHeadless(options);
  const channel = normalizeText(process.env.CHATGPT_REAUTH_BROWSER_CHANNEL);
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-default-browser-check',
    '--no-first-run',
    `--window-size=${profile.viewport.width},${profile.viewport.height}`
  ];
  const contextOptions = createContextOptions(profile, false);
  const launchOptions = {
    headless,
    args,
    ...(channel ? { channel } : {})
  };

  if (shouldUsePersistentProfile()) {
    const userDataDir = resolveProfileDirectory(email);
    await mkdir(userDataDir, { recursive: true });
    const context = await playwright.chromium.launchPersistentContext(userDataDir, {
      ...launchOptions,
      ...contextOptions
    });
    const page = context.pages()[0] ?? await context.newPage();
    return {
      page,
      info: { headless, persistentProfile: true, profileDir: userDataDir, channel },
      close: () => context.close(),
      browserVersion: () => readChromiumMajorVersion(context.browser?.() ?? null)
    };
  }

  const browser = await playwright.chromium.launch(launchOptions);
  profile.userAgent = createWindowsChromeUserAgent(await readChromiumMajorVersion(browser));
  const page = await browser.newPage(createContextOptions(profile, true));
  return {
    page,
    info: { headless, persistentProfile: false, profileDir: null, channel },
    close: () => browser.close(),
    browserVersion: () => readChromiumMajorVersion(browser)
  };
}

function createContextOptions(profile: BrowserProfile, includeUserAgent: boolean): Record<string, unknown> {
  return {
    viewport: profile.viewport,
    screen: profile.screen,
    ...(includeUserAgent ? { userAgent: profile.userAgent } : {}),
    locale: profile.locale,
    timezoneId: profile.timezoneId,
    colorScheme: profile.colorScheme,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: false,
    hasTouch: false,
    reducedMotion: profile.reducedMotion,
    extraHTTPHeaders: {
      'Accept-Language': `${profile.locale},en-US;q=0.9,en;q=0.8`
    }
  };
}

function resolveBrowserHeadless(options: ChatGptHeadlessReauthOptions): boolean {
  const configured = normalizeText(process.env.CHATGPT_REAUTH_HEADLESS).toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(configured)) {
    return false;
  }
  if (['1', 'true', 'yes', 'on'].includes(configured)) {
    return true;
  }
  return options.headless !== false;
}

function shouldUsePersistentProfile(): boolean {
  const configured = normalizeText(process.env.CHATGPT_REAUTH_PERSISTENT_PROFILE).toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(configured);
}

function resolveProfileDirectory(email: string): string {
  const baseDir = normalizeText(process.env.CHATGPT_REAUTH_PROFILE_DIR) || DEFAULT_PROFILE_BASE_DIR;
  return resolve(baseDir, sanitizePathPart(email));
}

async function startLogin(page: PageLike): Promise<void> {
  const loginButton = page
    .getByRole('button', { name: /^log in$|^登录$/i })
    .or(page.getByRole('link', { name: /^log in$|^登录$/i }))
    .first();
  if (await loginButton.isVisible({ timeout: 30000 }).catch(() => false)) {
    await humanDelay(page, 500, 1200);
    await humanClick(page, loginButton);
    return;
  }

  const emailInput = await findEmailInput(page);
  if (!emailInput) {
    await page.goto(CHATGPT_URL, { waitUntil: 'domcontentloaded' });
  }
}

async function fillEmail(page: PageLike, email: string, profile: BrowserProfile): Promise<void> {
  const input = await waitForEmailInput(page);
  await humanDelay(page, 500, 1200);
  await humanClick(page, input);
  await input.fill('');
  await typeHuman(page, email, profile.typingDelay.min, profile.typingDelay.max);
  await humanDelay(page, 600, 1400);
  await clickEmailContinue(page, input);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
}

async function assertReadyForVerificationCode(page: PageLike): Promise<void> {
  await page.waitForTimeout(3000);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);

  const codeInput = page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="code" i]').first();
  if (await codeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    return;
  }

  const state = await readLoginPageState(page);
  if (state.url.includes('/api/auth/error') || state.url.includes('/auth/error')) {
    throw new Error('步骤 2 失败：ChatGPT 登录返回 auth error，未进入验证码页面，验证码不会发送');
  }
  if (state.hasCloudflareChallenge) {
    throw new Error('步骤 2 失败：ChatGPT 登录被 Cloudflare 验证拦截，未进入验证码页面，验证码不会发送');
  }
  if (state.hasTurnstileChallenge) {
    throw new Error('步骤 2 失败：ChatGPT 登录被 Turnstile 人机验证拦截，未进入验证码页面，验证码不会发送');
  }
  if (state.textSignals.length > 0) {
    throw new Error(`步骤 2 失败：ChatGPT 未进入验证码页面（${state.textSignals.join('；')}），验证码不会发送`);
  }

  throw new Error('步骤 2 失败：ChatGPT 未出现验证码输入框，验证码可能未发送');
}

async function readLoginPageState(page: PageLike): Promise<{
  url: string;
  title: string;
  hasCloudflareChallenge: boolean;
  hasTurnstileChallenge: boolean;
  textSignals: string[];
}> {
  return await page.evaluate(() => {
    const text = document.body?.innerText ?? '';
    const scriptAndFrameText = Array.from(document.querySelectorAll('script[src], iframe[src]'))
      .map((item) => item.getAttribute('src') ?? '')
      .join('\n');
    const combined = `${location.href}\n${text}\n${scriptAndFrameText}`;
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => /cloudflare|turnstile|verifying|verify you are human|checking your browser|captcha|challenge|error|验证码|人机|验证/i.test(line))
      .slice(0, 5);

    return {
      url: location.href,
      title: document.title,
      hasCloudflareChallenge: /cloudflare|cdn-cgi\/challenge-platform|challenges\.cloudflare\.com|checking your browser/i.test(combined),
      hasTurnstileChallenge: /turnstile|verify you are human|captcha|人机验证/i.test(combined),
      textSignals: lines
    };
  });
}

async function logPageState(options: ChatGptHeadlessReauthOptions, page: PageLike, label: string): Promise<void> {
  const state = await readLoginPageState(page).catch(() => null);
  if (!state) {
    options.onLog('warning', `${label}：读取失败`, options.target);
    return;
  }
  const signals = [
    state.hasCloudflareChallenge ? 'Cloudflare' : '',
    state.hasTurnstileChallenge ? 'Turnstile' : '',
    ...state.textSignals
  ].filter(Boolean);
  options.onLog('info', `${label}：${state.url}，标题：${state.title || '-'}${signals.length ? `，信号：${signals.join(' / ')}` : ''}`, options.target);
}

async function saveDebugArtifacts(page: PageLike, email: string, reason: string): Promise<string> {
  const baseDir = normalizeText(process.env.CHATGPT_REAUTH_DEBUG_DIR) || DEFAULT_DEBUG_BASE_DIR;
  const debugDir = resolve(baseDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${sanitizePathPart(email)}`);
  await mkdir(debugDir, { recursive: true });

  const [state, title, html, screenshot] = await Promise.all([
    readLoginPageState(page).catch(() => null),
    page.title().catch(() => ''),
    page.content().catch(() => ''),
    page.screenshot({ fullPage: true }).catch(() => null)
  ]);

  await writeFile(join(debugDir, 'state.json'), JSON.stringify({
    savedAt: new Date().toISOString(),
    email,
    reason,
    title,
    state
  }, null, 2), 'utf8');

  if (html) {
    await writeFile(join(debugDir, 'page.html'), html, 'utf8');
  }
  if (screenshot) {
    await writeFile(join(debugDir, 'screenshot.png'), screenshot);
  }

  return debugDir;
}

async function fillPasswordIfPresent(page: PageLike, password: string, profile: BrowserProfile): Promise<void> {
  const passwordInput = page.locator('input[type="password"]').first();
  if (!(await passwordInput.isVisible({ timeout: 8000 }).catch(() => false))) {
    return;
  }
  await humanDelay(page, 500, 1200);
  await humanClick(page, passwordInput);
  await passwordInput.fill('');
  await typeHuman(page, password, profile.typingDelay.min + 10, profile.typingDelay.max + 20);
  await humanDelay(page, 600, 1400);
  await passwordInput.press('Enter');
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => undefined);
}

async function fillVerificationCode(page: PageLike, code: string, profile: BrowserProfile): Promise<void> {
  const codeInput = page.locator('input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="code" i]').first();
  if (await codeInput.isVisible({ timeout: 30000 }).catch(() => false)) {
    await humanDelay(page, 500, 1200);
    await humanClick(page, codeInput);
    await codeInput.fill('');
    await typeHuman(page, code, profile.typingDelay.min + 20, profile.typingDelay.max + 40);
    await humanDelay(page, 600, 1400);
    const continueButton = page.getByRole('button', { name: /^continue$|^继续$/i }).last();
    if (await continueButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await humanClick(page, continueButton);
    } else {
      await codeInput.press('Enter');
    }
    return;
  }

  await typeHuman(page, code, profile.typingDelay.min + 20, profile.typingDelay.max + 40);
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

async function tryReadExistingChatGptSession(page: PageLike, expectedEmail: string): Promise<ChatGptHeadlessReauthResult | null> {
  const sessionPayload = await readChatGptSession(page).catch(() => null);
  const session = readRecord(sessionPayload);
  const accessToken = normalizeText(session?.accessToken ?? session?.access_token);
  if (!accessToken) {
    return null;
  }

  const authorizedEmail = extractSessionEmail(sessionPayload);
  if (authorizedEmail && authorizedEmail !== expectedEmail) {
    throw new Error(`持久化 profile 当前登录邮箱为 ${authorizedEmail}，与目标邮箱 ${expectedEmail} 不一致`);
  }

  return { sessionPayload, accessToken };
}

function extractSessionEmail(sessionPayload: unknown): string {
  const session = readRecord(sessionPayload);
  const user = readRecord(session?.user);
  const account = readRecord(session?.account);
  return normalizeEmail(user?.email ?? account?.email ?? session?.email ?? session?.userEmail ?? session?.accountEmail);
}

async function waitForVerificationCode(
  options: ChatGptHeadlessReauthOptions,
  email: string,
  startedAt: Date
): Promise<string | null> {
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let attempts = 0;
  while (Date.now() < deadline) {
    if (options.isAborted?.()) {
      return null;
    }
    attempts += 1;
    options.onLog('info', `步骤 3：第 ${attempts} 次检查验证码邮箱`, options.target);
    const code = await options.readVerificationCode(email, startedAt);
    if (code) {
      options.onLog('success', `步骤 3：第 ${attempts} 次检查已获取验证码`, options.target);
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, VERIFICATION_CODE_POLL_INTERVAL_MS));
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
      await humanClick(page, button);
      return;
    }
  }

  await emailInput.press('Enter');
}

async function typeHuman(page: PageLike, text: string, minDelay: number, maxDelay: number): Promise<void> {
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomInteger(minDelay, maxDelay) });
    if (Math.random() < 0.08) {
      await page.waitForTimeout(randomInteger(120, 420));
    }
  }
}

async function humanDelay(page: PageLike, minMs: number, maxMs: number): Promise<void> {
  await page.waitForTimeout(randomInteger(minMs, maxMs));
}

async function humanClick(page: PageLike, locator: LocatorLike): Promise<void> {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) {
    await locator.click();
    return;
  }

  const x = box.x + box.width * randomFloat(0.35, 0.65);
  const y = box.y + box.height * randomFloat(0.35, 0.65);
  await page.mouse.move(x + randomInteger(-30, 30), y + randomInteger(-16, 16), { steps: randomInteger(4, 9) });
  await page.waitForTimeout(randomInteger(80, 260));
  await page.mouse.move(x, y, { steps: randomInteger(3, 7) });
  await page.waitForTimeout(randomInteger(60, 180));
  await page.mouse.click(x, y, { delay: randomInteger(35, 110) });
}

async function warmUpPage(page: PageLike, profile: BrowserProfile): Promise<void> {
  await page.mouse.move(
    randomInteger(80, Math.max(120, profile.viewport.width - 120)),
    randomInteger(80, Math.max(120, profile.viewport.height - 120)),
    { steps: randomInteger(5, 12) }
  ).catch(() => undefined);
  await humanDelay(page, 250, 900);
}

async function installBrowserProfileScript(page: PageLike, profile: BrowserProfile): Promise<void> {
  await page.addInitScript(`(() => {
    const defineGetter = (target, key, value) => {
      try { Object.defineProperty(target, key, { get: () => value, configurable: true }); } catch {}
    };
    defineGetter(Navigator.prototype, 'webdriver', undefined);
    defineGetter(Navigator.prototype, 'platform', 'Win32');
    defineGetter(Navigator.prototype, 'hardwareConcurrency', 8);
    defineGetter(Navigator.prototype, 'deviceMemory', 8);
    defineGetter(Navigator.prototype, 'languages', ['${profile.locale}', 'en-US', 'en']);
    defineGetter(Navigator.prototype, 'plugins', [1, 2, 3, 4, 5]);
    defineGetter(screen, 'width', ${profile.screen.width});
    defineGetter(screen, 'height', ${profile.screen.height});
    defineGetter(screen, 'availWidth', ${profile.viewport.width});
    defineGetter(screen, 'availHeight', ${profile.viewport.height});
    try { window.chrome ||= { runtime: {} }; } catch {}
  })();`);
}

function createBrowserProfile(): BrowserProfile {
  const viewports = [
    { width: 1365, height: 768, screenWidth: 1366, screenHeight: 768 },
    { width: 1440, height: 900, screenWidth: 1440, screenHeight: 900 },
    { width: 1536, height: 864, screenWidth: 1536, screenHeight: 864 },
    { width: 1600, height: 900, screenWidth: 1600, screenHeight: 900 }
  ];
  const viewport = pickRandom(viewports);
  const locale = pickRandom(['zh-CN', 'en-US']);
  return {
    viewport: { width: viewport.width, height: viewport.height },
    screen: { width: viewport.screenWidth, height: viewport.screenHeight },
    userAgent: createWindowsChromeUserAgent(125),
    locale,
    timezoneId: locale === 'zh-CN' ? 'Asia/Shanghai' : pickRandom(['America/Los_Angeles', 'America/New_York']),
    colorScheme: 'light',
    deviceScaleFactor: pickRandom([1, 1.25]),
    reducedMotion: 'no-preference',
    typingDelay: { min: randomInteger(55, 85), max: randomInteger(125, 190) }
  };
}

async function readChromiumMajorVersion(browser: BrowserLike | null): Promise<number> {
  if (!browser || typeof browser.version !== 'function') {
    return 125;
  }
  const version = await Promise.resolve(browser.version()).catch(() => '');
  const major = Number(String(version).match(/\d+/)?.[0]);
  return Number.isSafeInteger(major) && major > 0 ? major : 125;
}

function createWindowsChromeUserAgent(chromeMajor: number): string {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`;
}

function pickRandom<T>(items: T[]): T {
  return items[randomInteger(0, items.length - 1)] as T;
}

function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomInteger(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sanitizePathPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'default';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '未知错误');
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
