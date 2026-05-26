export type Sub2ApiLongLinkPlan = 'plus' | 'team';

export interface Sub2ApiLongLinkConfig {
  proxyPool: string;
}

export interface Sub2ApiLongLinkCheckoutPayload {
  token: string;
  plan: Sub2ApiLongLinkPlan;
  country: string;
  currency: string;
  locale: string;
  usePromo: boolean;
  promoCode?: string;
  workspaceName?: string;
  seatQuantity?: number;
}

export interface Sub2ApiLongLinkProxyCheckResult {
  ok: true;
  ip: string;
  country: string;
  countryCode: string;
  region: string;
  city: string;
  timezone: string;
  isp: string;
  loc: string;
  proxyUsed: string;
  direct: boolean;
}

export interface Sub2ApiLongLinkCheckoutResult {
  ok: true;
  url: string;
  chatgptCheckoutUrl: string;
  openaiPayUrl: string;
  proxyUsed: string;
  direct: boolean;
  raw: unknown;
}

interface PlaywrightLike {
  request: {
    newContext(options?: Record<string, unknown>): Promise<ApiRequestContextLike>;
  };
}

interface ApiRequestContextLike {
  get(url: string, options?: Record<string, unknown>): Promise<ApiResponseLike>;
  post(url: string, options?: Record<string, unknown>): Promise<ApiResponseLike>;
  dispose(): Promise<void>;
}

interface ApiResponseLike {
  status(): number;
  text(): Promise<string>;
}

interface ProxyCandidate {
  original: string;
  display: string;
  server: string;
  username?: string;
  password?: string;
}

interface ProxyEndpoint {
  protocol: string;
  host: string;
  port: string;
  username: string;
  password: string;
}

interface PlaywrightProxySettings {
  server: string;
  username?: string;
  password?: string;
}

const CHECKOUT_URL = 'https://chatgpt.com/backend-api/payments/checkout';
const IP_CHECK_URLS = [
  'http://iprust.io/ip.json',
  'https://ipwho.is/',
  'https://api.myip.com/',
  'https://ipinfo.io/json'
];

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const SUPPORTED_PROXY_PROTOCOLS = ['http', 'https', 'socks5h', 'socks5'] as const;
type SupportedProxyProtocol = (typeof SUPPORTED_PROXY_PROTOCOLS)[number];

export const DEFAULT_SUB2API_LONG_LINK_CONFIG: Sub2ApiLongLinkConfig = {
  proxyPool: ''
};

export function normalizeSub2ApiLongLinkConfig(input: Partial<Sub2ApiLongLinkConfig>): Sub2ApiLongLinkConfig {
  return {
    proxyPool: normalizeProxyPoolText(input.proxyPool)
  };
}

export function normalizeProxyPoolText(value: unknown): string {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function extractChatGptAccessToken(value: unknown): string {
  const text = String(value ?? '').trim();
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text)) {
    return text;
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    for (const key of ['accessToken', 'access_token', 'token']) {
      const candidate = parsed[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
    const data = parsed.data;
    if (data && typeof data === 'object') {
      const candidate = (data as Record<string, unknown>).accessToken;
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }
  } catch {
    // Fall through to regex extraction.
  }

  return text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0] ?? '';
}

export function normalizeLongLinkProxyCandidates(poolText: string): ProxyCandidate[] {
  const lines = normalizeProxyPoolText(poolText).split('\n').filter(Boolean);
  const candidates: ProxyCandidate[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    for (const candidate of buildProxyCandidates(line)) {
      const key = `${candidate.server}|${candidate.username ?? ''}|${candidate.password ?? ''}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push(candidate);
    }
  }

  return candidates;
}

export async function checkSub2ApiLongLinkProxy(poolText: string): Promise<Sub2ApiLongLinkProxyCheckResult> {
  const playwright = await loadPlaywright();
  const candidates = normalizeLongLinkProxyCandidates(poolText);
  const errors: string[] = [];

  if (candidates.length === 0) {
    return await checkIpWithCandidate(playwright, null);
  }

  for (const candidate of candidates) {
    try {
      return await checkIpWithCandidate(playwright, candidate);
    } catch (error) {
      errors.push(`${maskProxyDisplay(candidate.display)}: ${getErrorMessage(error)}`);
    }
  }

  throw new Error(errors[0] || '代理检测失败');
}

export async function createSub2ApiLongLinkCheckout(
  payload: Sub2ApiLongLinkCheckoutPayload,
  poolText: string
): Promise<Sub2ApiLongLinkCheckoutResult> {
  const token = extractChatGptAccessToken(payload.token);
  if (!token) {
    throw new Error('没有识别到 accessToken');
  }

  const playwright = await loadPlaywright();
  const candidates = normalizeLongLinkProxyCandidates(poolText);
  const checkoutPayload = buildCheckoutPayload(payload);
  const errors: string[] = [];

  if (candidates.length === 0) {
    return await postCheckoutWithCandidate(playwright, token, checkoutPayload, null, payload.locale);
  }

  for (const candidate of candidates) {
    try {
      return await postCheckoutWithCandidate(playwright, token, checkoutPayload, candidate, payload.locale);
    } catch (error) {
      errors.push(`${maskProxyDisplay(candidate.display)}: ${getErrorMessage(error, [token])}`);
    }
  }

  throw new Error(errors[0] || '生成长链失败');
}

function buildCheckoutPayload(body: Sub2ApiLongLinkCheckoutPayload): Record<string, unknown> {
  const plan = body.plan === 'team' ? 'team' : 'plus';
  const country = normalizeUpperText(body.country, 'US');
  const currency = normalizeUpperText(body.currency, 'USD');
  const usePromo = body.usePromo !== false;
  const promoCode = extractPromoCode(body.promoCode);
  const payload: Record<string, unknown> = {
    plan_name: plan === 'team' ? 'chatgptteamplan' : 'chatgptplusplan',
    billing_details: {
      country,
      currency
    },
    checkout_ui_mode: 'hosted'
  };

  if (plan === 'team' && usePromo && promoCode) {
    payload.cancel_url = `https://chatgpt.com/?promoCode=${encodeURIComponent(promoCode)}`;
    payload.promo_code = promoCode;
  } else {
    payload.cancel_url = 'https://chatgpt.com/#pricing';
  }

  if (usePromo && plan !== 'team') {
    payload.promo_campaign = {
      promo_campaign_id: 'plus-1-month-free',
      is_coupon_from_query_param: true
    };
  }

  if (plan === 'team') {
    payload.team_plan_data = {
      workspace_name: normalizeText(body.workspaceName) || 'linux-do',
      price_interval: 'month',
      seat_quantity: normalizeInteger(body.seatQuantity, 2, 2, 1000)
    };
  }

  return payload;
}

async function postCheckoutWithCandidate(
  playwright: PlaywrightLike,
  token: string,
  payload: Record<string, unknown>,
  candidate: ProxyCandidate | null,
  locale: string
): Promise<Sub2ApiLongLinkCheckoutResult> {
  const context = await createRequestContext(playwright, candidate);
  try {
    const response = await context.post(CHECKOUT_URL, {
      headers: buildCheckoutHeaders(token, locale),
      data: payload,
      timeout: 45000
    });
    const status = response.status();
    const text = await response.text();
    if (looksLikeCloudflareChallenge(text)) {
      throw new Error('请求被 Cloudflare 拦截，请稍后重试或更换代理出口');
    }
    const data = parseJson(text);
    if (status < 200 || status >= 300) {
      throw new Error(extractRemoteError(data) || `ChatGPT checkout 请求失败 (${status})`);
    }
    return enrichCheckoutResponse(data, candidate);
  } finally {
    await context.dispose().catch(() => undefined);
  }
}

async function checkIpWithCandidate(
  playwright: PlaywrightLike,
  candidate: ProxyCandidate | null
): Promise<Sub2ApiLongLinkProxyCheckResult> {
  const context = await createRequestContext(playwright, candidate);
  const errors: string[] = [];
  try {
    for (const url of IP_CHECK_URLS) {
      try {
        const response = await context.get(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': DEFAULT_USER_AGENT
          },
          timeout: 20000
        });
        const status = response.status();
        const text = await response.text();
        if (status < 200 || status >= 300) {
          errors.push(`${url} returned ${status}`);
          continue;
        }
        return normalizeIpCheckResponse(parseJson(text), candidate);
      } catch (error) {
        errors.push(`${url}: ${getErrorMessage(error)}`);
      }
    }
  } finally {
    await context.dispose().catch(() => undefined);
  }

  throw new Error(errors[0] || 'IP 检测服务返回异常');
}

async function createRequestContext(
  playwright: PlaywrightLike,
  candidate: ProxyCandidate | null
): Promise<ApiRequestContextLike> {
  const proxy = candidate ? toPlaywrightProxy(candidate) : undefined;
  return await playwright.request.newContext({
    ...(proxy ? { proxy } : {}),
    extraHTTPHeaders: {
      'User-Agent': DEFAULT_USER_AGENT
    },
    ignoreHTTPSErrors: true
  });
}

function toPlaywrightProxy(candidate: ProxyCandidate): PlaywrightProxySettings {
  return {
    server: candidate.server,
    ...(candidate.username ? { username: candidate.username } : {}),
    ...(candidate.password ? { password: candidate.password } : {})
  };
}

function enrichCheckoutResponse(data: unknown, candidate: ProxyCandidate | null): Sub2ApiLongLinkCheckoutResult {
  if (!data || typeof data !== 'object') {
    throw new Error('ChatGPT 返回不是 JSON 对象');
  }

  const record = data as Record<string, unknown>;
  const sessionId = normalizeText(record.checkout_session_id);
  const processor = normalizeText(record.processor_entity);
  const chatgptCheckoutUrl =
    normalizeText(record.chatgpt_checkout_url) ||
    (sessionId && processor ? `https://chatgpt.com/checkout/${processor}/${sessionId}` : '');
  const openaiPayUrl = [
    normalizeText(record.url),
    normalizeText(record.stripe_hosted_url),
    normalizeText(record.checkout_url)
  ].find((value) => value.startsWith('https://pay.openai.com/')) ?? '';
  const url = openaiPayUrl || normalizeText(record.url) || normalizeText(record.stripe_hosted_url) || chatgptCheckoutUrl;

  if (!url) {
    throw new Error('返回中没有可识别的支付长链');
  }

  return {
    ok: true,
    url,
    chatgptCheckoutUrl,
    openaiPayUrl,
    proxyUsed: candidate?.display ?? '',
    direct: !candidate,
    raw: record
  };
}

function normalizeIpCheckResponse(data: unknown, candidate: ProxyCandidate | null): Sub2ApiLongLinkProxyCheckResult {
  if (!data || typeof data !== 'object') {
    throw new Error('IP 检测服务返回异常');
  }

  const record = data as Record<string, unknown>;
  const connection = record.connection && typeof record.connection === 'object'
    ? record.connection as Record<string, unknown>
    : {};
  return {
    ok: true,
    ip: normalizeText(record.ip) || normalizeText(record.query),
    country: normalizeText(record.country_long) || normalizeText(record.country) || normalizeText(record.country_name),
    countryCode:
      normalizeText(record.country_short) ||
      normalizeText(record.country_code) ||
      normalizeText(record.cc) ||
      normalizeText(record.countryCode),
    region: normalizeText(record.region) || normalizeText(record.region_name),
    city: normalizeText(record.city),
    timezone: normalizeText(record.timezone),
    isp: normalizeText(connection.isp) || normalizeText(record.org) || normalizeText(record.isp),
    loc: normalizeText(record.loc),
    proxyUsed: candidate?.display ?? '',
    direct: !candidate
  };
}

function buildCheckoutHeaders(token: string, locale: string): Record<string, string> {
  const language = normalizeLocale(locale);
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Origin: 'https://chatgpt.com',
    Referer: 'https://chatgpt.com/',
    'Accept-Language': language,
    'User-Agent': DEFAULT_USER_AGENT
  };
}

function buildProxyCandidates(value: string): ProxyCandidate[] {
  const raw = value.trim();
  if (!raw) {
    return [];
  }

  const explicit = parseExplicitProxy(raw);
  if (explicit) {
    return [toProxyCandidate(raw, explicit)];
  }

  const shorthand = parseShorthandProxy(raw);
  if (!shorthand) {
    throw new Error(`代理格式不支持: ${raw}`);
  }

  const protocols = shorthand.protocol === 'auto' ? SUPPORTED_PROXY_PROTOCOLS : [shorthand.protocol];
  return protocols.map((protocol) => toProxyCandidate(raw, { ...shorthand, protocol }));
}

function parseExplicitProxy(value: string): ProxyEndpoint | null {
  const match = /^([a-z0-9+.-]+):\/\//i.exec(value);
  if (!match) {
    return null;
  }

  const protocol = match[1].toLowerCase();
  if (!isSupportedProxyProtocol(protocol)) {
    throw new Error(`代理协议不支持: ${protocol}`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`代理 URL 格式不合法: ${value}`);
  }

  if (!url.hostname || !url.port) {
    throw new Error(`代理必须包含 host 和 port: ${value}`);
  }

  return {
    protocol,
    host: url.hostname,
    port: url.port,
    username: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || '')
  };
}

function parseShorthandProxy(value: string): (ProxyEndpoint & { protocol: string }) | null {
  const parts = value.split(':');
  if (parts.length === 2) {
    const [host, port] = parts;
    if (!host || !isPort(port)) {
      return null;
    }
    return { protocol: 'auto', host, port, username: '', password: '' };
  }

  if (parts.length >= 4) {
    const host = parts[0];
    const port = parts[1];
    const username = parts[2];
    const password = parts.slice(3).join(':');
    if (!host || !isPort(port) || !username || !password) {
      return null;
    }
    return { protocol: 'http', host, port, username, password };
  }

  return null;
}

function toProxyCandidate(original: string, endpoint: ProxyEndpoint): ProxyCandidate {
  const host = endpoint.host.replace(/^\[|\]$/g, '');
  const requestProtocol = endpoint.protocol === 'socks5h' ? 'socks5' : endpoint.protocol;
  const server = `${requestProtocol}://${host}:${endpoint.port}`;
  const auth = endpoint.username ? `${endpoint.username}:${endpoint.password}@` : '';
  const display = `${endpoint.protocol}://${auth}${host}:${endpoint.port}`;
  return {
    original,
    display,
    server,
    username: endpoint.username || undefined,
    password: endpoint.password || undefined
  };
}

async function loadPlaywright(): Promise<PlaywrightLike> {
  try {
    const moduleName = 'playwright';
    return await import(moduleName) as PlaywrightLike;
  } catch {
    throw new Error('当前项目尚未安装 Playwright，请先执行 npm install playwright 并安装浏览器依赖');
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new Error(text.trim() || '返回不是 JSON');
  }
}

function extractRemoteError(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }
  const record = data as Record<string, unknown>;
  return normalizeText(record.error) || normalizeText(record.message) || normalizeText(record.detail);
}

function looksLikeCloudflareChallenge(text: string): boolean {
  const lowered = text.toLowerCase();
  return lowered.includes('_cf_chl_opt') || lowered.includes('enable javascript and cookies to continue') || lowered.includes('cf-chl');
}

function extractPromoCode(value: unknown): string {
  const text = normalizeText(value);
  if (!text) {
    return '';
  }
  try {
    const url = new URL(text);
    return normalizeText(url.searchParams.get('promoCode') || url.searchParams.get('promocode'));
  } catch {
    const match = /promoCode=([^&#\s]+)/i.exec(text);
    return decodeURIComponent(match?.[1] || text).trim();
  }
}

function normalizeUpperText(value: unknown, fallback: string): string {
  return (normalizeText(value) || fallback).toUpperCase();
}

function normalizeLocale(value: unknown): string {
  const locale = normalizeText(value) || 'en-US';
  if (locale === 'zh-CN') {
    return 'zh-CN,zh;q=0.9,en;q=0.8';
  }
  if (locale === 'ja-JP') {
    return 'ja-JP,ja;q=0.9,en;q=0.8';
  }
  return `${locale},en;q=0.9`;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, numeric));
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function isPort(value: string): boolean {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

function isSupportedProxyProtocol(value: string): value is SupportedProxyProtocol {
  return (SUPPORTED_PROXY_PROTOCOLS as readonly string[]).includes(value);
}

function getErrorMessage(error: unknown, secrets: string[] = []): string {
  const raw = error instanceof Error ? error.message : '发生未知错误';
  let message = raw.replace(/Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi, 'Authorization: Bearer ***');
  for (const secret of secrets) {
    if (secret) {
      message = message.split(secret).join('***');
    }
  }
  return message.replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s]+)(@)/gi, '$1***$3');
}

function maskProxyDisplay(value: string): string {
  return value.replace(/([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s]+)(@)/i, '$1***$3');
}
