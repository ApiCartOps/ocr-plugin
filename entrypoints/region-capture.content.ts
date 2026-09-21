import { renderResultOverlay } from '../lib/ui/result-overlay';
import type { OcrRegionCaptureRequest, OcrResult } from '../lib/messaging/protocol';

/**
 * Draws a selection-rectangle overlay when the user starts a region
 * capture (triggered from the popup via scripting.executeScript, not a
 * persistent all-urls content script — see the approved plan's permission
 * scoping), reports the chosen rect to the background script, and renders
 * the OCR result inline once background resolves the request.
 */
export default defineContentScript({
  matches: [],
  registration: 'runtime',
  main() {
    startRegionSelection();
  },
});

function startRegionSelection() {
  const hostId = 'ocr-plugin-region-select';
  document.getElementById(hostId)?.remove();

  const host = document.createElement('div');
  host.id = hostId;
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    cursor: 'crosshair',
  });

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .veil { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.15); }
      .hint { position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
        background: #111; color: #fff; font: 13px system-ui, sans-serif;
        padding: 6px 12px; border-radius: 6px; }
      .box { position: fixed; border: 2px solid #2b7fff; background: rgba(43, 127, 255, 0.15); }
    </style>
    <div class="veil"></div>
    <div class="hint">Drag to select an area to OCR — Esc to cancel</div>
  `;
  document.documentElement.appendChild(host);

  let startX = 0;
  let startY = 0;
  let box: HTMLDivElement | null = null;

  const cleanup = () => {
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseup', onMouseUp, true);
    document.removeEventListener('keydown', onKeyDown, true);
    host.remove();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') cleanup();
  };

  const onMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    box = document.createElement('div');
    box.className = 'box';
    Object.assign(box.style, { left: `${startX}px`, top: `${startY}px`, width: '0px', height: '0px' });
    shadow.appendChild(box);
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!box) return;
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const width = Math.abs(e.clientX - startX);
    const height = Math.abs(e.clientY - startY);
    Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  };

  const onMouseUp = async (e: MouseEvent) => {
    if (!box) return;
    const x = Math.min(startX, e.clientX);
    const y = Math.min(startY, e.clientY);
    const width = Math.abs(e.clientX - startX);
    const height = Math.abs(e.clientY - startY);
    cleanup();

    if (width < 4 || height < 4) return;

    // Give the page a couple of frames to actually repaint without our
    // overlay before background takes the screenshot.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    const request: OcrRegionCaptureRequest = {
      type: 'ocr/capture-region',
      rect: { x, y, width, height },
      devicePixelRatio: window.devicePixelRatio,
    };

    try {
      const result = (await browser.runtime.sendMessage(request)) as OcrResult;
      renderResultOverlay('OCR result', result.text.trim() || '(no text found)');
    } catch (error) {
      renderResultOverlay('OCR failed', String(error));
    }
  };

  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('keydown', onKeyDown, true);
}
