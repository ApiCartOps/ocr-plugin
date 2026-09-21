/**
 * Renders a small results panel in the top-right corner of the page,
 * inside a Shadow DOM root so the host page's CSS can't collide with it.
 *
 * Deliberately self-contained (no references to anything outside its own
 * function body besides global DOM/browser APIs): this same function is
 * used two ways — called directly by a content script already running in
 * the page (region-capture flow), and passed as the `func` to
 * `browser.scripting.executeScript` (right-click-image flow), which
 * serializes the function body and re-evaluates it in the page's isolated
 * world. A closure over an outer module-level variable would silently
 * break in the second case.
 */
export function renderResultOverlay(title: string, text: string): void {
  const hostId = 'ocr-plugin-result-overlay';
  document.getElementById(hostId)?.remove();

  const host = document.createElement('div');
  host.id = hostId;
  host.style.position = 'fixed';
  host.style.top = '16px';
  host.style.right = '16px';
  host.style.zIndex = '2147483647';

  const shadow = host.attachShadow({ mode: 'open' });
  const escapeHtml = (s: string) =>
    s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c);

  shadow.innerHTML = `
    <style>
      .panel { font-family: system-ui, sans-serif; background: #fff; color: #111;
        border: 1px solid #d0d0d0; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.2);
        width: 320px; max-height: 400px; display: flex; flex-direction: column; }
      .header { display: flex; justify-content: space-between; align-items: center;
        padding: 8px 12px; border-bottom: 1px solid #eee; font-weight: 600; font-size: 13px; }
      .body { padding: 12px; overflow: auto; font-size: 13px; white-space: pre-wrap; }
      button { border: none; background: transparent; cursor: pointer; }
      .close-btn { font-size: 16px; line-height: 1; color: #666; }
      .actions { display: flex; gap: 8px; padding: 8px 12px; border-top: 1px solid #eee; }
      .copy-btn { background: #111; color: #fff; border-radius: 6px; padding: 6px 10px; font-size: 12px; }
    </style>
    <div class="panel">
      <div class="header"><span>${escapeHtml(title)}</span><button class="close-btn" type="button">×</button></div>
      <div class="body">${escapeHtml(text)}</div>
      <div class="actions"><button class="copy-btn" type="button">Copy text</button></div>
    </div>
  `;

  shadow.querySelector('.close-btn')?.addEventListener('click', () => host.remove());
  shadow
    .querySelector('.copy-btn')
    ?.addEventListener('click', () => navigator.clipboard.writeText(text));

  document.documentElement.appendChild(host);
}
