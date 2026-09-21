/**
 * Typed message contracts passed between the extension's execution contexts
 * (content scripts, popup, options, background, and the offscreen document
 * on Chrome/Edge) via `browser.runtime.sendMessage` / `onMessage`.
 *
 * Every message has a `type` discriminant so handlers can switch on it with
 * full type narrowing.
 */

export interface OcrRegionCaptureRequest {
  type: 'ocr/capture-region';
  /** Rectangle in CSS pixels, relative to the viewport, reported by the
   * region-capture content script overlay. */
  rect: { x: number; y: number; width: number; height: number };
  /** devicePixelRatio at capture time, needed to map CSS px to the bitmap
   * returned by captureVisibleTab. */
  devicePixelRatio: number;
}

export interface OcrFileUploadRequest {
  type: 'ocr/capture-file';
  /** Base64-encoded image bytes from a popup file upload/drop — see
   * lib/messaging/binary.ts for why this isn't a raw ArrayBuffer. */
  bytes: string;
  mimeType: string;
}

export type OcrCaptureRequest = OcrRegionCaptureRequest | OcrFileUploadRequest;

/**
 * Normalized internal job dispatched by the background script to whichever
 * context actually runs Tesseract — the offscreen document on Chrome/Edge
 * (broadcast via runtime.sendMessage, which offscreen documents receive
 * like any other extension page), or handled by calling
 * lib/inference/ocr.ts directly in-process on Firefox. The background
 * script has already resolved any screenshot capture/cropping by this
 * point, so the job only ever carries plain image bytes.
 */
export interface OcrRunJob {
  type: 'ocr/run';
  requestId: string;
  /** Base64-encoded — see lib/messaging/binary.ts. A raw ArrayBuffer does
   * not survive the hop to the offscreen document intact (confirmed while
   * testing: it arrives empty despite Chrome's documented structured-clone
   * support for runtime messages). */
  bytes: string;
  mimeType: string;
}

export interface OcrResult {
  type: 'ocr/result';
  requestId: string;
  text: string;
  words: Array<{
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    confidence: number;
  }>;
}

export interface StructureRequest {
  type: 'structure/run';
  requestId: string;
  rawText: string;
  /** Omit for the default "clean up free text" mode. */
  schemaId?: string;
}

/**
 * Normalized internal job dispatched by the background script to whichever
 * context actually runs the tiny LLM — mirrors OcrRunJob. The background
 * script resolves `schemaId` to a full schema (via lib/storage/schema-store)
 * before forwarding, so the offscreen document never needs storage access
 * of its own.
 */
export interface StructureRunJob {
  type: 'structure/run-job';
  requestId: string;
  rawText: string;
  schema?: import('../storage/schema-store').DocumentSchema;
}

export interface StructureResult {
  type: 'structure/result';
  requestId: string;
  /** Structured field values (schema mode) or cleaned text (free-text mode). */
  data: Record<string, unknown> | { cleanedText: string };
}

export interface AutofillMatchRequest {
  type: 'autofill/match';
  requestId: string;
  schemaId: string;
  extracted: Record<string, unknown>;
}

export interface AutofillFieldMapping {
  fieldName: string;
  value: unknown;
  /** CSS selector or a stable DOM reference id assigned by the content
   * script's field-detector, resolved back to an element there. */
  domRefId: string;
  confidence: number;
}

export interface AutofillMatchResult {
  type: 'autofill/match-result';
  requestId: string;
  mappings: AutofillFieldMapping[];
}

/**
 * Normalized internal job dispatched by the background script to whichever
 * context actually runs the tiny LLM — mirrors StructureRunJob. Background
 * has already run lib/autofill/field-detector.ts's detectFormFields in the
 * target tab (via scripting.executeScript) and resolved the schema before
 * forwarding, so this job only carries plain data.
 */
export interface AutofillMatchJob {
  type: 'autofill/match-job';
  requestId: string;
  detected: Array<{ domRefId: string; label: string; inputType: string }>;
  extracted: Record<string, unknown>;
  schema: import('../storage/schema-store').DocumentSchema;
}

export interface ModelDownloadProgress {
  type: 'model/download-progress';
  modelId: string;
  loaded: number;
  total: number;
}

export type ExtensionMessage =
  | OcrCaptureRequest
  | OcrRunJob
  | OcrResult
  | StructureRequest
  | StructureRunJob
  | StructureResult
  | AutofillMatchRequest
  | AutofillMatchJob
  | AutofillMatchResult
  | ModelDownloadProgress;
