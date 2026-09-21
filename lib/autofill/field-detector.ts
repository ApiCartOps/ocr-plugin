export interface DetectedField {
  domRefId: string;
  label: string;
  inputType: string;
}

const AUTOFILL_TAG_ATTR = 'data-ocrpluginref';

/**
 * Heuristic scan of the current page's form controls (label[for],
 * wrapping <label>, aria-label, placeholder, name), run on demand via
 * chrome.scripting.executeScript when the user triggers autofill — never
 * as a persistent content script. Deliberately self-contained (no
 * references outside its own body besides global DOM APIs): this same
 * function is passed directly as executeScript's `func`, which serializes
 * only the function's own source and re-evaluates it in the page's
 * isolated world — a reference to a module-level helper would silently
 * break there.
 *
 * Tags each candidate element with a stable `data-ocrpluginref` attribute
 * so lib/autofill/dom-writer.ts can find it again by that id once the user
 * confirms a mapping in the review overlay.
 */
export function detectFormFields(): DetectedField[] {
  const tagAttr = 'data-ocrpluginref';
  const candidates = Array.from(
    document.querySelectorAll(
      'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), textarea, select',
    ),
  ) as Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;

  const results: DetectedField[] = [];

  for (const el of candidates) {
    // Rough visibility check — offsetParent is null for display:none and
    // detached elements (also for position:fixed, an acceptable false
    // negative for this heuristic).
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
    if (el instanceof HTMLInputElement && el.disabled) continue;

    let refId = el.getAttribute(tagAttr);
    if (!refId) {
      refId = 'f' + Math.random().toString(36).slice(2, 10);
      el.setAttribute(tagAttr, refId);
    }

    let label = '';
    const id = el.getAttribute('id');
    if (id) {
      const forLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (forLabel?.textContent?.trim()) label = forLabel.textContent.trim();
    }
    if (!label) {
      const wrappingLabel = el.closest('label');
      if (wrappingLabel?.textContent?.trim()) label = wrappingLabel.textContent.trim().slice(0, 80);
    }
    if (!label) label = el.getAttribute('aria-label') ?? '';
    if (!label) label = el.getAttribute('placeholder') ?? '';
    if (!label) label = el.getAttribute('name') ?? '';
    if (!label) label = '(unlabeled field)';

    const inputType =
      el instanceof HTMLSelectElement
        ? 'select'
        : el instanceof HTMLTextAreaElement
          ? 'textarea'
          : el.type || 'text';

    results.push({ domRefId: refId, label, inputType });
  }

  return results;
}

export { AUTOFILL_TAG_ATTR };
