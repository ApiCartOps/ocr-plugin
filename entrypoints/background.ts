import { cropScreenshotToPng, type Rect } from '../lib/inference/image';
import { detectFormFields, type DetectedField } from '../lib/autofill/field-detector';
import { renderResultOverlay } from '../lib/ui/result-overlay';
import { arrayBufferToBase64, base64ToArrayBuffer } from '../lib/messaging/binary';
import { DEMO_INVOICE_SCHEMA, getSchema, type DocumentSchema } from '../lib/storage/schema-store';
import type {
  AutofillFieldMapping,
  AutofillMatchJob,
  AutofillMatchResult,
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

/** Runs the tiny LLM's field↔DOM matching, routing to whichever context
 * actually hosts Transformers.js for this browser — mirrors runStructure. */
async function runMatch(
  detected: DetectedField[],
  extracted: Record<string, unknown>,
  schema: DocumentSchema,
): Promise<AutofillFieldMapping[]> {
  const requestId = crypto.randomUUID();

  if (import.meta.env.FIREFOX) {
    // Dynamic import — see the matching note in runOcr.
    const { matchFieldsToSchema } = await import('../lib/autofill/llm-matcher');
    return matchFieldsToSchema(detected, extracted, schema);
  }

  await ensureOffscreenDocument();
  const job: AutofillMatchJob = { type: 'autofill/match-job', requestId, detected, extracted, schema };
  const result = await browser.runtime.sendMessage(job);
  return result as AutofillFieldMapping[];
}

/** Detects fillable fields on the given tab, asks the tiny LLM to map the
 * extracted data onto them, and hands the result to the review overlay —
 * which is the only thing allowed to actually write into the page. */
async function runAutofillMatch(
  tabId: number,
  schemaId: string,
  extracted: Record<string, unknown>,
): Promise<AutofillMatchResult> {
  const requestId = crypto.randomUUID();

  // The popup that triggers this closes itself immediately after sending
  // the request (same pattern as region capture), so it won't be around
  // to show an error — surface failures as a page overlay instead of
  // letting the rejection go unheard.
  try {
    const schema = await resolveSchema(schemaId);
    if (!schema) {
      throw new Error(`Unknown schema id: ${schemaId}`);
    }

    const [injected] = await browser.scripting.executeScript({
      target: { tabId },
      func: detectFormFields,
    });
    const detected = injected?.result ?? [];

    if (detected.length === 0) {
      await browser.scripting.executeScript({
        target: { tabId },
        func: renderResultOverlay,
        args: ['OCR Form Filler', 'No fillable form fields found on this page.'],
      });
      return { type: 'autofill/match-result', requestId, mappings: [] };
    }

    const mappings = await runMatch(detected, extracted, schema);

    // Same known WXT typings gap as the region-capture executeScript call
    // in popup/App.tsx — `files` is restricted to public/ assets, not
    // content-script build output.
    await (
      browser.scripting.executeScript as (opts: {
        target: { tabId: number };
        files: string[];
      }) => Promise<unknown>
    )({
      target: { tabId },
      files: ['content-scripts/autofill-review.js'],
    });
    const result: AutofillMatchResult = { type: 'autofill/match-result', requestId, mappings };
    await browser.tabs.sendMessage(tabId, result);

    return result;
  } catch (error) {
    await browser.scripting.executeScript({
      target: { tabId },
      func: renderResultOverlay,
      args: ['Autofill failed', String(error)],
    });
    throw error;
  }
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
      case 'autofill/match': {
        const tabId = sender.tab?.id;
        if (tabId != null) {
          return runAutofillMatch(tabId, message.schemaId, message.extracted);
        }
        // Sent from the popup, which isn't tied to a specific tab in
        // sender info — target whatever tab the user is currently on.
        return browser.tabs
          .query({ active: true, currentWindow: true })
          .then(([tab]) =>
            tab?.id != null
              ? runAutofillMatch(tab.id, message.schemaId, message.extracted)
              : Promise.reject(new Error('No active tab to fill.')),
          );
      }
      default:
        return undefined;
    }
  });
});
