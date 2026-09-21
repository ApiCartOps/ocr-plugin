import { writeFieldValue } from '../lib/autofill/dom-writer';
import { renderResultOverlay } from '../lib/ui/result-overlay';
import type { AutofillFieldMapping, AutofillMatchResult, ExtensionMessage } from '../lib/messaging/protocol';

/**
 * Renders the field-mapping review/confirm overlay (in a Shadow DOM root,
 * to avoid CSS collisions with the host page) after
 * lib/autofill/field-matcher.ts proposes DOM mappings. Nothing is written to
 * the page — see lib/autofill/dom-writer.ts — until the user confirms each
 * mapping here.
 *
 * Injected on demand via scripting.executeScript (like region-capture.js),
 * then handed its data via a follow-up runtime message rather than
 * scripting.executeScript's `func`/`args`, since it needs real imports
 * (writeFieldValue, renderResultOverlay) that a serialized function
 * wouldn't retain.
 */
export default defineContentScript({
  matches: [],
  registration: 'runtime',
  main() {
    browser.runtime.onMessage.addListener((message: ExtensionMessage) => {
      if (message.type !== 'autofill/match-result') return undefined;
      showReviewOverlay((message as AutofillMatchResult).mappings);
      return undefined;
    });
  },
});

function showReviewOverlay(mappings: AutofillFieldMapping[]): void {
  const hostId = 'ocr-plugin-autofill-review';
  document.getElementById(hostId)?.remove();

  if (mappings.length === 0) {
    renderResultOverlay(
      'OCR Form Filler',
      "No confident matches between the extracted data and this page's form fields.",
    );
    return;
  }

  const host = document.createElement('div');
  host.id = hostId;
  Object.assign(host.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: '2147483647',
  });

  const shadow = host.attachShadow({ mode: 'open' });
  const escapeHtml = (s: string) =>
    s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c);

  const rowsHtml = mappings
    .map(
      (m, i) => `
        <div class="row" data-index="${i}">
          <input type="checkbox" class="include" checked />
          <div class="row-body">
            <div class="row-label">${escapeHtml(m.fieldName)} <span class="confidence">${Math.round(m.confidence * 100)}% match</span></div>
            <input type="text" class="value" value="${escapeHtml(String(m.value ?? ''))}" />
          </div>
        </div>`,
    )
    .join('');

  shadow.innerHTML = `
    <style>
      .panel { font-family: system-ui, sans-serif; background: #fff; color: #111;
        border: 1px solid #d0d0d0; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.2);
        width: 340px; max-height: 480px; display: flex; flex-direction: column; }
      .header { display: flex; justify-content: space-between; align-items: center;
        padding: 10px 12px; border-bottom: 1px solid #eee; font-weight: 600; font-size: 13px; }
      .close-btn { border: none; background: transparent; cursor: pointer; font-size: 16px; color: #666; }
      .body { padding: 12px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
      .row { display: flex; gap: 8px; align-items: flex-start; }
      .row .include { margin-top: 6px; forced-color-adjust: none; }
      .row-body { flex: 1; display: flex; flex-direction: column; gap: 4px; }
      .row-label { font-size: 12px; font-weight: 600; color: #333; }
      .confidence { font-weight: 400; color: #888; }
      .value { font: inherit; font-size: 12px; padding: 5px 7px; border: 1px solid #d0d0d0;
        border-radius: 5px; color: #111; background: #fff; forced-color-adjust: none; }
      .actions { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid #eee; }
      button.apply, button.cancel { font: inherit; cursor: pointer; border-radius: 6px;
        padding: 7px 12px; font-size: 12px; border: 1px solid #d0d0d0; forced-color-adjust: none; }
      button.apply { background: #111; color: #fff; border-color: #111; flex: 1; }
      button.cancel { background: #f7f7f7; color: #111; }
    </style>
    <div class="panel">
      <div class="header"><span>Review before filling (${mappings.length})</span><button class="close-btn" type="button">×</button></div>
      <div class="body">${rowsHtml}</div>
      <div class="actions">
        <button class="apply" type="button">Fill checked fields</button>
        <button class="cancel" type="button">Cancel</button>
      </div>
    </div>
  `;

  const close = () => host.remove();
  shadow.querySelector('.close-btn')?.addEventListener('click', close);
  shadow.querySelector('.cancel')?.addEventListener('click', close);

  shadow.querySelector('.apply')?.addEventListener('click', () => {
    let filled = 0;
    const rows = shadow.querySelectorAll<HTMLElement>('.row');
    rows.forEach((row) => {
      const index = Number(row.dataset.index);
      const mapping = mappings[index];
      if (!mapping) return;
      const include = row.querySelector<HTMLInputElement>('.include');
      const valueInput = row.querySelector<HTMLInputElement>('.value');
      if (!include?.checked) return;

      const target = document.querySelector(
        `[data-ocrpluginref="${CSS.escape(mapping.domRefId)}"]`,
      );
      if (!target) return;

      writeFieldValue(target, valueInput?.value ?? mapping.value);
      filled++;
    });

    close();
    renderResultOverlay('OCR Form Filler', `Filled ${filled} field${filled === 1 ? '' : 's'}.`);
  });

  document.documentElement.appendChild(host);
}
