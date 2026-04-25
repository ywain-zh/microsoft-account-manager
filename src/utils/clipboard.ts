export async function copyToClipboard(value: string): Promise<boolean> {
  const text = value.trim();
  if (!text) {
    return false;
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back for browsers or contexts that block the async Clipboard API.
    }
  }

  return copyWithSelectionFallback(text);
}

function copyWithSelectionFallback(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) {
    return false;
  }

  const textarea = document.createElement('textarea');
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = typeof window !== 'undefined' ? window.getSelection() : null;
  const originalRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;

  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.setAttribute('aria-hidden', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';

  document.body.appendChild(textarea);

  let copied = false;

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);

    if (selection) {
      selection.removeAllRanges();
      if (originalRange) {
        selection.addRange(originalRange);
      }
    }

    activeElement?.focus();
  }

  return copied;
}
