import DOMPurify from 'dompurify';
import type { AccountMailItem } from '../types';

export interface RenderedMailPreview {
  mode: 'html' | 'text' | 'empty';
  srcdoc: string;
  snippet: string;
}

export interface MailTranslationSource {
  mode: 'html' | 'text';
  text: string;
  segmentCount: number;
}

const MAX_SNIPPET_LENGTH = 180;
const DEFAULT_FRAME_HEIGHT = 560;
const MAX_FRAME_HEIGHT = 1600;
const TRANSLATION_SEGMENT_PREFIX = '[[[MAIL_SEGMENT_';
const TRANSLATION_SEGMENT_PATTERN = /\[\[\[MAIL_SEGMENT_(\d{4})\]\]\]\s*([\s\S]*?)(?=\s*\[\[\[MAIL_SEGMENT_\d{4}\]\]\]|$)/g;
const TEXT_LINK_PATTERN =
  /((?:https?:\/\/|www\.)[^\s<]+|(?:mailto:)?[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
const FORBIDDEN_STYLE_PROPERTIES = new Set(['behavior', '-moz-binding']);
const SKIP_TEXT_NODE_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'META', 'BASE']);

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
  const preview = extractPreviewSnippet(message.preview ?? '');
  if (preview) {
    return trimSnippet(preview);
  }

  return extractContentSnippet(message);
}

function extractPreviewSnippet(rawPreview: string): string {
  const preview = collapseWhitespace(rawPreview);
  if (!preview) {
    return '';
  }

  if (!looksLikeHtml(preview)) {
    return preview;
  }

  const text = extractTextFromHtml(preview);
  if (text && !looksLikeHtml(text)) {
    return text;
  }

  return '';
}

function extractContentSnippet(message: Pick<AccountMailItem, 'content' | 'contentType'>): string {
  const content = (message.content ?? '').trim();
  if (!content) {
    return '';
  }

  if (isHtmlMail(message.contentType, content)) {
    return trimSnippet(extractTextFromHtml(content));
  }

  return trimSnippet(collapseWhitespace(content));
}

export function extractMailText(
  message: Pick<AccountMailItem, 'preview' | 'content' | 'contentType'> | null | undefined
): string {
  if (!message) {
    return '';
  }

  const content = (message.content ?? '').trim();
  if (content) {
    if (isHtmlMail(message.contentType, content)) {
      return collapseWhitespace(extractTextFromHtml(content));
    }

    return collapseWhitespace(content);
  }

  return collapseWhitespace(message.preview ?? '');
}

export function buildMailTranslationSource(
  message: Pick<AccountMailItem, 'preview' | 'content' | 'contentType'> | null | undefined
): MailTranslationSource {
  if (!message) {
    return {
      mode: 'text',
      text: '',
      segmentCount: 0
    };
  }

  const content = (message.content ?? '').trim();
  if (content && isHtmlMail(message.contentType, content)) {
    const segments = extractTranslatableTextSegments(content);
    if (segments.length > 0) {
      return {
        mode: 'html',
        text: segments.map((segment, index) => `${buildTranslationSegmentMarker(index)}\n${segment}`).join('\n'),
        segmentCount: segments.length
      };
    }
  }

  return {
    mode: 'text',
    text: extractMailText(message),
    segmentCount: 0
  };
}

export function buildTranslatedMail(message: AccountMailItem, translatedText: string): AccountMailItem {
  const content = (message.content ?? '').trim();
  if (content && isHtmlMail(message.contentType, content) && translatedText.includes(TRANSLATION_SEGMENT_PREFIX)) {
    const translatedHtml = applyTranslatedSegmentsToHtml(content, translatedText);
    if (translatedHtml) {
      return {
        ...message,
        contentType: 'text/html',
        content: translatedHtml,
        preview: extractMailSnippet({
          preview: '',
          content: translatedHtml,
          contentType: 'text/html'
        })
      };
    }
  }

  return {
    ...message,
    contentType: 'text/plain',
    content: translatedText,
    preview: translatedText
  };
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

function looksLikeHtml(value: string): boolean {
  return /<!doctype|&lt;!doctype|<\/?(?:html|head|body|meta|style|script|table|div|span|p|a|br)\b|&lt;\/?(?:html|head|body|meta|style|script|table|div|span|p|a|br)\b/i.test(
    value
  );
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

function extractTranslatableTextSegments(html: string): string[] {
  const doc = parseMailHtmlDocument(html);
  if (!doc?.body) {
    return [];
  }

  return collectTranslatableTextNodes(doc.body)
    .map((node) => collapseWhitespace(node.nodeValue ?? ''))
    .filter(Boolean);
}

function applyTranslatedSegmentsToHtml(html: string, translatedText: string): string {
  const doc = parseMailHtmlDocument(html);
  if (!doc?.body) {
    return '';
  }

  const textNodes = collectTranslatableTextNodes(doc.body);
  const translatedSegments = parseTranslatedSegments(translatedText, textNodes.length);
  if (!translatedSegments) {
    return '';
  }

  textNodes.forEach((node, index) => {
    node.nodeValue = preserveTextEdges(node.nodeValue ?? '', translatedSegments[index] ?? '');
  });

  const styleBlocks = Array.from(doc.querySelectorAll('style'))
    .map((node) => node.outerHTML)
    .join('');

  return `${styleBlocks}${doc.body.innerHTML.trim()}`;
}

function parseMailHtmlDocument(html: string): Document | null {
  if (typeof DOMParser === 'undefined') {
    return null;
  }

  try {
    return new DOMParser().parseFromString(extractDocumentMarkup(html), 'text/html');
  } catch {
    return null;
  }
}

function collectTranslatableTextNodes(root: ParentNode): Text[] {
  const ownerDocument = root.ownerDocument ?? document;
  const textNodes: Text[] = [];
  const walker = ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = collapseWhitespace(node.nodeValue ?? '');
      if (!text) {
        return NodeFilter.FILTER_REJECT;
      }

      let parent = node.parentElement;
      while (parent) {
        if (SKIP_TEXT_NODE_TAGS.has(parent.tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        if (parent.hasAttribute('hidden') || parent.getAttribute('aria-hidden') === 'true') {
          return NodeFilter.FILTER_REJECT;
        }
        parent = parent.parentElement;
      }

      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  return textNodes;
}

function parseTranslatedSegments(translatedText: string, expectedCount: number): string[] | null {
  if (expectedCount <= 0) {
    return null;
  }

  const segments = new Map<number, string>();
  for (const match of translatedText.matchAll(TRANSLATION_SEGMENT_PATTERN)) {
    const index = Number.parseInt(match[1], 10) - 1;
    if (index >= 0 && index < expectedCount) {
      segments.set(index, normalizeTranslatedSegment(match[2] ?? ''));
    }
  }

  if (segments.size !== expectedCount) {
    return null;
  }

  const ordered: string[] = [];
  for (let index = 0; index < expectedCount; index += 1) {
    const segment = segments.get(index);
    if (segment === undefined) {
      return null;
    }
    ordered.push(segment);
  }

  return ordered;
}

function normalizeTranslatedSegment(value: string): string {
  return value
    .replace(/^\s*[:：-]\s*/, '')
    .replace(/\s+$/g, '')
    .trim();
}

function preserveTextEdges(original: string, replacement: string): string {
  const leading = original.match(/^\s*/)?.[0] ?? '';
  const trailing = original.match(/\s*$/)?.[0] ?? '';
  return `${leading}${replacement.trim()}${trailing}`;
}

function buildTranslationSegmentMarker(index: number): string {
  return `${TRANSLATION_SEGMENT_PREFIX}${String(index + 1).padStart(4, '0')}]]]`;
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
        width: 100%;
        height: 100%;
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
        overflow-y: auto;
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
    <style>
      html,
      body {
        width: 100% !important;
        height: 100% !important;
        min-height: 100% !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
      }

      body {
        position: static !important;
      }
    </style>
  </body>
</html>`;
}
