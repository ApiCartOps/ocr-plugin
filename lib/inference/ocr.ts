import { createWorker, OEM, type Worker as TesseractWorker } from 'tesseract.js';
import { toError } from './errors';
import type { OcrResult } from '../messaging/protocol';

/**
 * Tesseract.js wrapper — runs inside the offscreen document (Chrome/Edge)
 * or directly in the background page (Firefox), never in a content script
 * or the popup. See the approved plan's "Execution context" section.
 *
 * All assets are vendored locally under public/tesseract-core and
 * public/tessdata rather than loaded from a CDN, since MV3 disallows
 * remotely-hosted code and the extension must work fully offline.
 *
 * The vendored core is the "simd-lstm" build (LSTM-only engine, WASM SIMD),
 * which is why OEM.LSTM_ONLY is forced below — the legacy Tesseract engine
 * isn't compiled into this core variant. WASM SIMD has shipped by default
 * in Chrome, Firefox, and Edge since 2021, so no non-SIMD fallback core is
 * vendored.
 */

let workerPromise: Promise<TesseractWorker> | null = null;

function getWorker(): Promise<TesseractWorker> {
  workerPromise ??= createWorker(
    'eng',
    OEM.LSTM_ONLY,
    {
      workerPath: browser.runtime.getURL('/tesseract-core/worker.min.js'),
      // Ends in ".js" so Tesseract.js loads this exact file instead of
      // probing a directory for a SIMD-support-appropriate variant.
      corePath: browser.runtime.getURL('/tesseract-core/tesseract-core-simd-lstm.wasm.js'),
      // browser.runtime.getURL only accepts known literal file paths, so the
      // langPath directory is derived from the one file it points to rather
      // than typed as a bare "/tessdata/" prefix.
      langPath: browser.runtime
        .getURL('/tessdata/eng.traineddata.gz')
        .replace(/eng\.traineddata\.gz$/, ''),
      // Spawns the worker directly from our extension-origin URL instead of
      // wrapping it in a blob: URL, which our CSP's script-src (scoped to
      // 'self') would otherwise block.
      workerBlobURL: false,
      gzip: true,
      logger: (m) => console.log('[ocr-plugin] tesseract', m.status, m.progress),
    },
  ).catch((cause) => {
    // Don't leave a rejected promise cached — a transient init failure
    // would otherwise permanently break every future OCR request.
    workerPromise = null;
    throw toError('Tesseract worker initialization failed', cause);
  });
  return workerPromise;
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function describeBytes(bytes: ArrayBuffer): string {
  const header = Array.from(new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
  return `${bytes.byteLength} bytes, header [${header}]`;
}

export async function recognizeText(
  bytes: ArrayBuffer,
  mimeType: string,
  requestId: string,
): Promise<OcrResult> {
  // Diagnostic guard: confirms whether the crop/message pipeline delivered
  // valid PNG bytes before handing them to Tesseract, since a bad buffer
  // and a Tesseract-side decode bug produce the same downstream symptom.
  const header = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
  const looksLikePng = PNG_MAGIC.every((b, i) => header[i] === b);
  if (!looksLikePng) {
    throw new Error(`Image bytes are not a valid PNG — ${describeBytes(bytes)}`);
  }

  const worker = await getWorker();
  const blob = new Blob([bytes], { type: mimeType });

  let data: Awaited<ReturnType<TesseractWorker['recognize']>>['data'];
  try {
    ({ data } = await worker.recognize(blob, {}, { blocks: true }));
  } catch (cause) {
    throw toError(`Tesseract recognize() failed (input: ${describeBytes(bytes)})`, cause);
  }

  const words: OcrResult['words'] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          words.push({ text: word.text, bbox: word.bbox, confidence: word.confidence });
        }
      }
    }
  }

  return { type: 'ocr/result', requestId, text: data.text, words };
}
