import DOMPurify from 'dompurify';

const FORBIDDEN_STYLE_PROPERTIES = new Set(['behavior', '-moz-binding']);
const MAX_INLINE_FONT_SIZE_PX = 24;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function isHtmlTag(value: string): boolean {
  return /^<\/?[a-z][\s\S]*>$/i.test(value);
}

function renderInlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, '<strong>$1</strong>');
}

function renderPlainParagraph(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return `<p>${renderInlineMarkdown(trimmed).replace(/\n/g, '<br />')}</p>`;
}

function renderMixedHtmlSegment(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (!looksLikeHtml(trimmed)) {
    return renderPlainParagraph(trimmed);
  }

  return trimmed
    .split(/(<\/?[a-z][^>]*>)/gi)
    .map((part) => isHtmlTag(part) ? part : renderInlineMarkdown(part).replace(/\n/g, '<br />'))
    .join('');
}

function renderAnnouncementMarkup(value: string): string {
  const normalized = decodeHtmlEntities(value).replace(/\r\n?/g, '\n');
  const codeFencePattern = /```([a-zA-Z0-9_-]+)?[ \t]*(?:\n([\s\S]*?)\n?```|(.+?)[ \t]*```)/g;
  const parts: string[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = codeFencePattern.exec(normalized)) !== null) {
    const before = normalized.slice(cursor, match.index);
    const segment = renderMixedHtmlSegment(before);
    if (segment) {
      parts.push(segment);
    }

    const language = match[1] ? ` language-${escapeHtml(match[1].toLowerCase())}` : '';
    const code = match[2] ?? match[3] ?? '';
    parts.push(`<pre><code class="announcement-code${language}">${escapeHtml(code.trim())}</code></pre>`);
    cursor = codeFencePattern.lastIndex;
  }

  const tail = renderMixedHtmlSegment(normalized.slice(cursor));
  if (tail) {
    parts.push(tail);
  }

  return parts.length > 0 ? parts.join('') : '<p>暂无正文内容。</p>';
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
    .map((entry) => normalizeInlineStyleEntry(entry))
    .filter(Boolean)
    .join('; ');
}

function normalizeInlineStyleEntry(entry: string): string {
  const separatorIndex = entry.indexOf(':');
  const property = entry.slice(0, separatorIndex).trim().toLowerCase();
  const rawValue = entry.slice(separatorIndex + 1).trim();

  if (property !== 'font-size') {
    return `${property}: ${rawValue}`;
  }

  const normalizedSize = normalizeFontSize(rawValue);
  return normalizedSize ? `${property}: ${normalizedSize}` : '';
}

function normalizeFontSize(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(px|em|rem|%)$/.exec(trimmed);
  if (!match) {
    return '';
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const pxValue = unit === 'px'
    ? amount
    : unit === '%'
      ? (amount / 100) * 14
      : amount * 14;

  return `${Math.min(MAX_INLINE_FONT_SIZE_PX, Math.max(12, Math.round(pxValue)))}px`;
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

function postProcessAnnouncementHtml(html: string): string {
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

    doc.querySelectorAll('br').forEach((br) => {
      let previous = br.previousSibling;
      let consecutiveBreaks = 0;
      while (previous && previous.nodeName === 'BR') {
        consecutiveBreaks += 1;
        previous = previous.previousSibling;
      }
      if (consecutiveBreaks >= 2) {
        br.remove();
      }
    });

    return doc.body.innerHTML.trim();
  } catch {
    return html;
  }
}

export function renderPublicCheckinAnnouncementContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return '<p>暂无正文内容。</p>';
  }

  const html = renderAnnouncementMarkup(trimmed);

  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['class', 'rel', 'style', 'target'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['base', 'form', 'iframe', 'input', 'meta', 'object', 'script']
  });

  const processed = typeof sanitized === 'string' ? postProcessAnnouncementHtml(sanitized) : '';
  return processed.trim()
    ? processed
    : '<p>暂无正文内容。</p>';
}
