export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Crops a `tabs.captureVisibleTab` screenshot (a device-pixel-resolution
 * PNG data URL) down to a rect given in CSS pixels, returning PNG bytes.
 * Runs in the background script — OffscreenCanvas/createImageBitmap are
 * standard worker-global APIs available there (Chrome/Edge service worker
 * and Firefox event page alike), so there's no need to hop into the
 * offscreen document just to crop before OCR.
 */
export async function cropScreenshotToPng(
  dataUrl: string,
  rect: Rect,
  devicePixelRatio: number,
): Promise<ArrayBuffer> {
  const response = await fetch(dataUrl);
  const sourceBlob = await response.blob();
  const bitmap = await createImageBitmap(sourceBlob);

  const px = {
    x: Math.max(0, Math.round(rect.x * devicePixelRatio)),
    y: Math.max(0, Math.round(rect.y * devicePixelRatio)),
    width: Math.max(1, Math.min(bitmap.width, Math.round(rect.width * devicePixelRatio))),
    height: Math.max(1, Math.min(bitmap.height, Math.round(rect.height * devicePixelRatio))),
  };

  const canvas = new OffscreenCanvas(px.width, px.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.drawImage(bitmap, px.x, px.y, px.width, px.height, 0, 0, px.width, px.height);

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return blob.arrayBuffer();
}
