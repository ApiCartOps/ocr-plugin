import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { arrayBufferToBase64 } from '../../lib/messaging/binary';
import { DEMO_INVOICE_SCHEMA, listSchemas, type DocumentSchema } from '../../lib/storage/schema-store';
import type {
  AutofillMatchRequest,
  ExtensionMessage,
  ModelDownloadProgress,
  OcrFileUploadRequest,
  OcrResult,
  StructureRequest,
  StructureResult,
} from '../../lib/messaging/protocol';
import './App.css';

/**
 * Popup: a client of the OCR/structuring pipeline (upload/drop capture,
 * "capture region" trigger), not its host — the pipeline itself runs in
 * the offscreen document (Chrome/Edge) or background page (Firefox), since
 * the popup closes as soon as the user clicks away. Region capture and
 * right-click-image results render inline on the page instead, via
 * lib/ui/result-overlay, since the popup won't still be open when they
 * resolve.
 */
function App() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocrText, setOcrText] = useState<string | null>(null);
  const [structuredText, setStructuredText] = useState<string | null>(null);
  const [structuredData, setStructuredData] = useState<Record<string, unknown> | null>(null);
  const [schemas, setSchemas] = useState<DocumentSchema[]>([DEMO_INVOICE_SCHEMA]);
  const [selectedSchemaId, setSelectedSchemaId] = useState('');
  const [modelProgress, setModelProgress] = useState<{ loaded: number; total: number } | null>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const listener = (message: ExtensionMessage) => {
      if (message.type === 'model/download-progress') {
        const progress = message as ModelDownloadProgress;
        setModelProgress({ loaded: progress.loaded, total: progress.total });
      }
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    void listSchemas().then((custom) => setSchemas([DEMO_INVOICE_SCHEMA, ...custom]));
  }, []);

  const runStructuring = useCallback(
    async (rawText: string) => {
      setModelProgress(null);
      setStatus(
        selectedSchemaId
          ? 'Extracting structured fields (first run downloads the model — this can take a while)…'
          : 'Cleaning up text with the tiny LLM (first run downloads the model — this can take a while)…',
      );
      try {
        const request: StructureRequest = {
          type: 'structure/run',
          requestId: crypto.randomUUID(),
          rawText,
          schemaId: selectedSchemaId || undefined,
        };
        const response = (await browser.runtime.sendMessage(request)) as StructureResult;
        const { data } = response;
        const cleanedText =
          'cleanedText' in data && typeof data.cleanedText === 'string' ? data.cleanedText : null;
        setStructuredText(cleanedText ?? JSON.stringify(data, null, 2));
        setStructuredData(cleanedText ? null : data);
      } catch (err) {
        setError(String(err));
      } finally {
        setModelProgress(null);
        setStatus(null);
      }
    },
    [selectedSchemaId],
  );

  const runOcrOnFile = useCallback(
    async (file: File) => {
      setError(null);
      setOcrText(null);
      setStructuredText(null);
      setStructuredData(null);
      setStatus(`Recognizing "${file.name}"…`);
      try {
        const bytes = arrayBufferToBase64(await file.arrayBuffer());
        const request: OcrFileUploadRequest = {
          type: 'ocr/capture-file',
          bytes,
          mimeType: file.type || 'application/octet-stream',
        };
        const response = (await browser.runtime.sendMessage(request)) as OcrResult;
        const text = response.text.trim() || '(no text found)';
        setOcrText(text);
        setStatus(null);
        if (response.text.trim()) {
          await runStructuring(response.text);
        }
      } catch (err) {
        setStatus(null);
        setError(String(err));
      }
    },
    [runStructuring],
  );

  const onFileInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void runOcrOnFile(file);
      e.target.value = '';
    },
    [runOcrOnFile],
  );

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void runOcrOnFile(file);
    },
    [runOcrOnFile],
  );

  const runAutofill = useCallback(async () => {
    if (!structuredData || !selectedSchemaId) return;
    setError(null);
    try {
      const request: AutofillMatchRequest = {
        type: 'autofill/match',
        requestId: crypto.randomUUID(),
        schemaId: selectedSchemaId,
        extracted: structuredData,
      };
      // The review overlay renders on the page itself once background
      // resolves the match, so — same as region capture — close the popup
      // out of its way rather than waiting here.
      void browser.runtime.sendMessage(request);
      window.close();
    } catch (err) {
      setError(String(err));
    }
  }, [structuredData, selectedSchemaId]);

  const startRegionCapture = useCallback(async () => {
    setError(null);
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setError('No active tab to capture.');
      return;
    }
    try {
      // WXT's typed executeScript restricts `files` to public/ assets, not
      // content-script build output — this is the officially documented
      // pattern for invoking a `registration: 'runtime'` content script
      // (see https://wxt.dev/guide/essentials/scripting.html), so the cast
      // is a known gap in the typings rather than a workaround for a bug.
      await (
        browser.scripting.executeScript as (opts: {
          target: { tabId: number };
          files: string[];
        }) => Promise<unknown>
      )({
        target: { tabId: tab.id },
        files: ['content-scripts/region-capture.js'],
      });
      // The result renders inline on the page itself once background
      // resolves the OCR request, so there's nothing left for the popup to
      // show — close it out of the way of the selection overlay.
      window.close();
    } catch (err) {
      setError(String(err));
    }
  }, []);

  return (
    <main>
      <h1>OCR Form Filler</h1>

      <div className="actions">
        <button type="button" onClick={startRegionCapture}>
          Capture region
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Upload file
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onFileInputChange}
      />

      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        Or drop an image here
      </div>

      <label className="row">
        <span>Extract as</span>
        <select value={selectedSchemaId} onChange={(e) => setSelectedSchemaId(e.target.value)}>
          <option value="">Cleaned-up text (no schema)</option>
          {schemas.map((schema) => (
            <option key={schema.id} value={schema.id}>
              {schema.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="link-button"
        onClick={() => browser.runtime.openOptionsPage()}
      >
        Manage schemas
      </button>

      <p>Right-click any image on a page for "OCR this image".</p>

      {status && <div className="status">{status}</div>}
      {modelProgress && modelProgress.total > 0 && (
        <div className="progress">
          <div
            className="progress-bar"
            style={{ width: `${Math.min(100, (modelProgress.loaded / modelProgress.total) * 100)}%` }}
          />
        </div>
      )}
      {error && <div className="status error">{error}</div>}
      {ocrText && (
        <>
          <div className="section-label">Raw OCR text</div>
          <div className="result">{ocrText}</div>
        </>
      )}
      {structuredText && (
        <>
          <div className="section-label">
            {selectedSchemaId ? 'Structured JSON' : 'Cleaned text'}
          </div>
          <div className="result">{structuredText}</div>
        </>
      )}
      {structuredData && (
        <button type="button" className="primary fill-button" onClick={runAutofill}>
          Fill form on this page
        </button>
      )}
    </main>
  );
}

export default App;
