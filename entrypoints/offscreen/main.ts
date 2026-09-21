import { recognizeText } from '../../lib/inference/ocr';
import { structure } from '../../lib/inference/structuring';
import { matchFieldsToSchema } from '../../lib/autofill/llm-matcher';
import { base64ToArrayBuffer } from '../../lib/messaging/binary';
import type { ExtensionMessage } from '../../lib/messaging/protocol';

/**
 * Offscreen document (Chrome/Edge only): hosts Tesseract.js OCR and the
 * Transformers.js structuring/matching pipelines, since the background
 * service worker can be suspended at any time and can't reliably hold a
 * loaded worker/model. The background script broadcasts jobs via
 * runtime.sendMessage; this listener picks up only the ones addressed to
 * these stages ('ocr/run', 'structure/run-job', 'autofill/match-job') and
 * ignores everything else.
 */
browser.runtime.onMessage.addListener((message: ExtensionMessage) => {
  switch (message.type) {
    case 'ocr/run':
      return recognizeText(base64ToArrayBuffer(message.bytes), message.mimeType, message.requestId);
    case 'structure/run-job':
      return structure(message.rawText, message.requestId, message.schema);
    case 'autofill/match-job':
      return matchFieldsToSchema(message.detected, message.extracted, message.schema);
    default:
      return undefined;
  }
});

console.log('[ocr-plugin] offscreen document ready');
