import DOMPurify from 'dompurify';
import type { AccountMailItem } from '../types';

export interface RenderedMailPreview {
  mode: 'html' | 'text' | 'empty';
  srcdoc: string;
  snippet: string;
}

const MAX_SNIPPET_LENGTH = 180;
const DEFAULT_FRAME_HEIGHT = 560;
const MAX_FRAME_HEIGHT = 1600;
const TEXT_LINK_PATTERN =
  /((?:https?:\/\/|www\.)[^\s<]+|(?:mailto:)?[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
const FORBIDDEN_STYLE_PROPERTIES = new Set(['behavior', '-moz-binding']);

export const defaultMailFrameHeight = DEFAULT_FRAME_HEIGHT;
export const maxMailFrameHeight = MAX_FRAME_HEIGHT;

export function buildMailPreview(message: AccountMailItem | null | undefined): RenderedMailPreview {
  if (!message) {
    return {
      mode: 'empty',
      srcdoc: buildMailDocument(
        `
          <div class="mail-empty-state">
            <strong>请先选择一封邮件</strong>
            <p>左侧选中邮件后，这里会按接近真实邮箱的样式展示正文。</p>
          </div>
        `,
        'empty'
      ),
      snippet: ''
    };
  }

  const rawContent = (message.content ?? '').trim();
  const snippet = extractMailSnippet(message);

  if (!rawContent) {
    return {
      mode: 'empty',
      srcdoc: buildMailDocument(
        `
          <div class="mail-empty-state">
            <strong>暂无正文内容</strong>
            <p>这封邮件暂时没有返回可展示的正文，已保留邮件摘要供你参考。</p>
          </div>
        `,
        'empty'
      ),
      snippet
    };
  }

  if (isHtmlMail(message.contentType, rawContent)) {
    const normalizedHtml = normalizeMailHtml(rawContent);
    if (normalizedHtml) {
      return {
        mode: 'html',
        srcdoc: buildMailDocument(normalizedHtml, 'html'),
        snippet
      };
    }
  }

  return {
    mode: 'text',
    srcdoc: buildMailDocument(buildPlainTextMarkup(rawContent), 'text'),
    snippet
  };
}

export function extractMailSnippet(message: Pick<AccountMailItem, 'preview' | 'content' | 'contentType'>): string {
  const preview = collapseWhitespace(message.preview ?? '');
  if (preview) {
    return trimSnippet(preview);
  }

  const content = (message.content ?? '').trim();
  if (!content) {
    return '';
  }

  if (isHtmlMail(message.contentType, content)) {
    return trimSnippet(extractTextFromHtml(content));
  }

  return trimSnippet(collapseWhitespace(content));
}

function isHtmlMail(contentType: string | null | undefined, content: string): boolean {
  const normalized = (contentType ?? '').trim().toLowerCase();
  if (normalized.includes('html')) {
    return true;
  }
  if (normalized.includes('plain')) {
    return false;
  }
  return /<\/?[a-z][\s\S]*>/i.test(content);
}

function normalizeMailHtml(html: string): string {
  const extractedMarkup = extractDocumentMarkup(html);
  const sanitized = DOMPurify.sanitize(extractedMarkup, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['style'],
    ADD_ATTR: [
      'align',
      'background',
      'bgcolor',
      'border',
      'cellpadding',
      'cellspacing',
      'class',
      'rel',
      'role',
      'style',
      'target',
      'valign'
    ],
    FORBID_TAGS: ['base', 'embed', 'form', 'iframe', 'input', 'meta', 'object'],
    ALLOW_DATA_ATTR: false
  });

  if (typeof sanitized !== 'string' || !sanitized.trim()) {
    return '';
  }

  return postProcessHtml(sanitized);
}

function extractDocumentMarkup(html: string): string {
  if (typeof DOMParser === 'undefined') {
    return html;
  }

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const styleBlocks = Array.from(doc.querySelectorAll('style'))
      .map((node) => node.outerHTML)
      .join('');
    const bodyMarkup = doc.body?.innerHTML?.trim();
    if (bodyMarkup) {
      return `${styleBlocks}${bodyMarkup}`;
    }
  } catch {
    // Ignore parser failures and fall back to the original HTML string.
  }

  return html;
}

function postProcessHtml(html: string): string {
  if (typeof DOMParser === 'undefined') {
    return html;
  }

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    doc.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
      const normalizedStyle = sanitizeInlineStyle(element.getAttribute('style') ?? '');
      if (normalizedStyle) {
        element.setAttribute('style', normalizedStyle);
        return;
      }
      element.removeAttribute('style');
    });

    doc.querySelectorAll<HTMLAnchorElement>('a').forEach((link) => {
      const href = normalizeHref(link.getAttribute('href') ?? '');
      if (!href) {
        link.removeAttribute('href');
      } else {
        link.setAttribute('href', href);
      }
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer nofollow');
    });

    doc.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
      image.setAttribute('loading', 'lazy');
      image.setAttribute('decoding', 'async');
      if (!image.getAttribute('alt')) {
        image.setAttribute('alt', '');
      }
    });

    doc.querySelectorAll('table').forEach((table) => {
      table.setAttribute('data-mail-table', 'true');
    });

    return doc.body.innerHTML.trim();
  } catch {
    return html;
  }
}

function sanitizeInlineStyle(styleText: string): string {
  return styleText
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => {
      const separatorIndex = entry.indexOf(':');
      if (separatorIndex <= 0) {
        return false;
      }

      const property = entry.slice(0, separatorIndex).trim().toLowerCase();
      const value = entry.slice(separatorIndex + 1).trim().toLowerCase();

      if (FORBIDDEN_STYLE_PROPERTIES.has(property)) {
        return false;
      }
      if (property === 'position' && value.includes('fixed')) {
        return false;
      }
      if (value.includes('expression(') || value.includes('javascript:')) {
        return false;
      }

      return true;
    })
    .join('; ');
}

function normalizeHref(rawHref: string): string {
  const href = rawHref.trim();
  if (!href) {
    return '';
  }
  if (/^(https?:|mailto:|tel:)/i.test(href)) {
    return href;
  }
  if (/^www\./i.test(href)) {
    return `https://${href}`;
  }
  if (/^(#|\/)/.test(href)) {
    return href;
  }
  return '';
}

function buildPlainTextMarkup(text: string): string {
  const parts: string[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(TEXT_LINK_PATTERN)) {
    const matchText = match[0];
    const matchIndex = match.index ?? 0;
    parts.push(escapeHtml(text.slice(lastIndex, matchIndex)));
    parts.push(buildTextLinkMarkup(matchText));
    lastIndex = matchIndex + matchText.length;
  }

  parts.push(escapeHtml(text.slice(lastIndex)));

  return `<div class="mail-text-body">${parts.join('').replace(/\r?\n/g, '<br />')}</div>`;
}

function buildTextLinkMarkup(matchText: string): string {
  const normalized = normalizeHref(matchText.includes('@') && !matchText.startsWith('mailto:') ? `mailto:${matchText}` : matchText);
  if (!normalized) {
    return escapeHtml(matchText);
  }

  return `<a href="${escapeHtmlAttribute(normalized)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(matchText)}</a>`;
}

function extractTextFromHtml(html: string): string {
  if (typeof DOMParser === 'undefined') {
    return collapseWhitespace(html);
  }

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, noscript, template').forEach((node) => node.remove());
    return collapseWhitespace(doc.body.textContent ?? '');
  } catch {
    return collapseWhitespace(html);
  }
}

function trimSnippet(text: string): string {
  if (text.length <= MAX_SNIPPET_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_SNIPPET_LENGTH - 1).trimEnd()}…`;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

function buildMailDocument(contentMarkup: string, mode: RenderedMailPreview['mode']): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root {
        color-scheme: light;
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        min-height: 100%;
      }

      body {
        margin: 0;
        padding: 0;
        color: #334155;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif;
        font-size: 14px;
        line-height: 1.7;
        background: linear-gradient(180deg, #f8fafc 0%, #eef4fb 100%);
        overflow-x: hidden;
      }

      a {
        color: #2563eb;
        text-decoration: none;
        word-break: break-word;
      }

      a:hover {
        text-decoration: underline;
      }

      img,
      svg,
      video,
      canvas {
        max-width: 100% !important;
        height: auto !important;
      }

      table {
        max-width: 100% !important;
      }

      pre,
      code {
        font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      }

      pre {
        white-space: pre-wrap;
        word-break: break-word;
        padding: 16px;
        border-radius: 12px;
        background: #f8fafc;
        overflow-x: auto;
      }

      blockquote {
        margin: 1.2em 0;
        padding: 0 0 0 16px;
        border-left: 3px solid #cbd5e1;
        color: #475569;
      }

      hr {
        border: 0;
        border-top: 1px solid #e2e8f0;
        margin: 24px 0;
      }

      .mail-doc-shell {
        width: 100%;
        padding: 20px;
      }

      .mail-doc-card {
        width: min(100%, 920px);
        margin: 0 auto;
        border: 1px solid #e2e8f0;
        border-radius: 18px;
        background: #ffffff;
        box-shadow: 0 20px 50px rgba(15, 23, 42, 0.08);
        overflow: hidden;
      }

      .mail-doc-card-html,
      .mail-doc-card-text {
        padding: 28px 32px;
      }

      .mail-doc-card-empty {
        padding: 40px 32px;
      }

      .mail-doc-card[data-mode='html'] [data-mail-table='true'] {
        display: block;
        width: 100% !important;
        margin: 18px 0;
        overflow-x: auto;
        border-radius: 12px;
      }

      .mail-doc-card[data-mode='html'] [data-mail-table='true'] > tbody,
      .mail-doc-card[data-mode='html'] [data-mail-table='true'] > thead,
      .mail-doc-card[data-mode='html'] [data-mail-table='true'] > tfoot,
      .mail-doc-card[data-mode='html'] [data-mail-table='true'] > tr {
        width: max-content;
        min-width: 100%;
      }

      .mail-doc-card[data-mode='html'] table {
        border-collapse: collapse;
      }

      .mail-doc-card[data-mode='html'] td,
      .mail-doc-card[data-mode='html'] th {
        max-width: 100%;
      }

      .mail-text-body {
        white-space: normal;
        word-break: break-word;
        line-height: 1.85;
        font-size: 15px;
        color: #334155;
      }

      .mail-empty-state {
        display: grid;
        gap: 10px;
        min-height: 260px;
        align-content: center;
        justify-items: center;
        text-align: center;
        color: #64748b;
      }

      .mail-empty-state strong {
        color: #0f172a;
        font-size: 17px;
      }

      .mail-empty-state p {
        max-width: 34ch;
        margin: 0;
        line-height: 1.7;
      }

      @media (max-width: 640px) {
        .mail-doc-shell {
          padding: 10px;
        }

        .mail-doc-card-html,
        .mail-doc-card-text,
        .mail-doc-card-empty {
          padding: 20px 18px;
        }
      }
    </style>
  </head>
  <body>
    <div class="mail-doc-shell">
      <article class="mail-doc-card mail-doc-card-${mode}" data-mode="${mode}">
        ${contentMarkup}
      </article>
    </div>
  </body>
</html>`;
}
