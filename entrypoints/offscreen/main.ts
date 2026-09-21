import { recognizeText } from '../../lib/inference/ocr';
import { structure } from '../../lib/inference/structuring';
import { base64ToArrayBuffer } from '../../lib/messaging/binary';
import type { ExtensionMessage } from '../../lib/messaging/protocol';

/**
 * Offscreen document (Chrome/Edge only): hosts Tesseract.js OCR and the
 * Transformers.js structuring pipeline, since the background service
 * worker can be suspended at any time and can't reliably hold a loaded
 * worker/model. The background script broadcasts jobs via
 * runtime.sendMessage; this listener picks up only the ones addressed to
 * these stages ('ocr/run', 'structure/run-job') and ignores everything
 * else. Field matching (lib/autofill/field-matcher.ts) has no heavy
 * dependency and runs directly in background.ts instead.
 */
browser.runtime.onMessage.addListener((message: ExtensionMessage) => {
  switch (message.type) {
    case 'ocr/run':
      return recognizeText(base64ToArrayBuffer(message.bytes), message.mimeType, message.requestId);
    case 'structure/run-job':
      return structure(message.rawText, message.requestId, message.schema);
    default:
      return undefined;
  }
});

console.log('[ocr-plugin] offscreen document ready');
