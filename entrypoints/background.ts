import { cropScreenshotToPng, type Rect } from '../lib/inference/image';
import { renderResultOverlay } from '../lib/ui/result-overlay';
import { arrayBufferToBase64, base64ToArrayBuffer } from '../lib/messaging/binary';
import { DEMO_INVOICE_SCHEMA, getSchema, type DocumentSchema } from '../lib/storage/schema-store';
import type {
  ExtensionMessage,
  OcrResult,
  OcrRunJob,
  StructureResult,
  StructureRunJob,
} from '../lib/messaging/protocol';

/**
 * Background: thin on Chrome/Edge (context menus, tabs.captureVisibleTab,
 * cropping, offscreen-document lifecycle, message routing); on Firefox
 * it's also where OCR runs directly, since Firefox's MV3 background is a
 * persistent event page with real DOM access rather than a service
 * worker. See the approved plan's "Execution context" section.
 */

const OCR_CONTEXT_MENU_ID = 'ocr-plugin:ocr-image';

let offscreenReady: Promise<void> | null = null;

async function ensureOffscreenDocument(): Promise<void> {
  offscreenReady ??= (async () => {
    const existing = await browser.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (existing.length > 0) return;

    await browser.offscreen.createDocument({
      url: browser.runtime.getURL('/offscreen.html'),
      reasons: ['WORKERS'],
      justification:
        'Runs Tesseract.js OCR off the service worker, which can be suspended mid-recognition.',
    });
  })();

  return offscreenReady;
}

/** Runs OCR on raw image bytes, routing to whichever context actually
 * hosts Tesseract for this browser. */
async function runOcr(bytes: ArrayBuffer, mimeType: string): Promise<OcrResult> {
  const requestId = crypto.randomUUID();

  if (import.meta.env.FIREFOX) {
    // Dynamic import so Tesseract.js isn't statically bundled into
    // background.js on Chrome/Edge, where this path never runs (OCR goes
    // through the offscreen document there instead).
    const { recognizeText } = await import('../lib/inference/ocr');
    return recognizeText(bytes, mimeType, requestId);
  }

  await ensureOffscreenDocument();
  // Base64-encoded for transit — see lib/messaging/binary.ts.
  const job: OcrRunJob = {
    type: 'ocr/run',
    requestId,
    bytes: arrayBufferToBase64(bytes),
    mimeType,
  };
  // Broadcasts to all extension contexts; only the offscreen document's
  // listener recognizes 'ocr/run', so its returned promise is what
  // resolves this sendMessage call.
  const result = await browser.runtime.sendMessage(job);
  return result as OcrResult;
}

async function resolveSchema(schemaId: string | undefined): Promise<DocumentSchema | undefined> {
  if (!schemaId) return undefined;
  if (schemaId === DEMO_INVOICE_SCHEMA.id) return DEMO_INVOICE_SCHEMA;
  return getSchema(schemaId);
}

/** Runs the tiny LLM over raw OCR text, routing to whichever context
 * actually hosts Transformers.js for this browser — mirrors runOcr. */
async function runStructure(rawText: string, schemaId: string | undefined): Promise<StructureResult> {
  const requestId = crypto.randomUUID();
  const schema = await resolveSchema(schemaId);

  if (import.meta.env.FIREFOX) {
    // Dynamic import so Transformers.js isn't statically bundled into
    // background.js on Chrome/Edge — see the matching note in runOcr.
    const { structure } = await import('../lib/inference/structuring');
    return structure(rawText, requestId, schema);
  }

  await ensureOffscreenDocument();
  const job: StructureRunJob = { type: 'structure/run-job', requestId, rawText, schema };
  const result = await browser.runtime.sendMessage(job);
  return result as StructureResult;
}

async function captureAndRecognize(
  windowId: number,
  rect: Rect,
  devicePixelRatio: number,
): Promise<OcrResult> {
  const dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
  const pngBytes = await cropScreenshotToPng(dataUrl, rect, devicePixelRatio);
  return runOcr(pngBytes, 'image/png');
}

/** Injected via scripting.executeScript into the page the user right-clicked
 * an image on. Self-contained — no references outside its own body, since
 * Chrome serializes and re-evaluates it in the page's isolated world. */
function findImageRectInPage(srcUrl: string) {
  const img = Array.from(document.images).find(
    (el) => el.src === srcUrl || el.currentSrc === srcUrl,
  );
  if (!img) return null;
  const rect = img.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    devicePixelRatio: window.devicePixelRatio,
  };
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: OCR_CONTEXT_MENU_ID,
      title: 'OCR this image',
      contexts: ['image'],
    });
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== OCR_CONTEXT_MENU_ID || !tab?.id || !info.srcUrl) return;
    const tabId = tab.id;
    const windowId = tab.windowId;

    const [injected] = await browser.scripting.executeScript({
      target: { tabId },
      func: findImageRectInPage,
      args: [info.srcUrl],
    });
    const rect = injected?.result;

    if (!rect) {
      await browser.scripting.executeScript({
        target: { tabId },
        func: renderResultOverlay,
        args: ['OCR Form Filler', "Couldn't locate that image on the page."],
      });
      return;
    }

    try {
      const result = await captureAndRecognize(windowId, rect, rect.devicePixelRatio);
      await browser.scripting.executeScript({
        target: { tabId },
        func: renderResultOverlay,
        args: ['OCR result', result.text.trim() || '(no text found)'],
      });
    } catch (error) {
      await browser.scripting.executeScript({
        target: { tabId },
        func: renderResultOverlay,
        args: ['OCR failed', String(error)],
      });
    }
  });

  browser.runtime.onMessage.addListener((message: ExtensionMessage, sender) => {
    switch (message.type) {
      case 'ocr/capture-region': {
        const windowId = sender.tab?.windowId;
        if (windowId == null) return undefined;
        return captureAndRecognize(windowId, message.rect, message.devicePixelRatio);
      }
      case 'ocr/capture-file':
        return runOcr(base64ToArrayBuffer(message.bytes), message.mimeType);
      case 'structure/run':
        return runStructure(message.rawText, message.schemaId);
      default:
        return undefined;
    }
  });
});
