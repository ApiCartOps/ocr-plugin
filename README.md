# OCR Form Filler

A cross-browser (Chrome, Firefox, Edge) extension that OCRs content on a page — a screenshot region, a right-clicked image, or an uploaded file — and uses a small, fully in-browser LLM to turn it into structured data or cleaned-up text, then auto-fills a form on the page with it. No server, no API keys, works offline.

## Features

- **Three capture triggers**
  - Drag-select a region of the current tab
  - Right-click any image → "OCR this image"
  - Upload or drop a file in the popup
- **Fully offline inference** — OCR (Tesseract.js) and text structuring (a tiny instruct LLM via Transformers.js) both run entirely in the browser, no network calls after the one-time model download
- **Schema-guided extraction** — define a JSON schema (field name, type, description) in the options page and get structured fields back instead of raw text
- **DOM autofill** — detect a page's form fields, match them to your extracted data by keyword overlap, and fill them after you review and confirm each mapping
- **Manifest V3, all three browsers** — one codebase, per-browser manifest differences (e.g. Chrome/Edge's offscreen document vs. Firefox's persistent background page) handled by [WXT](https://wxt.dev)

## Usage

### 1. Define a schema (optional, for structured extraction)

Click the extension icon → **Manage schemas** (opens the options page as a full tab). Click **+ New schema**, give it a name, and add fields:

| Field name | Type | Description |
|---|---|---|
| `vendor` | string | The company or person being paid |
| `date` | date | The invoice or document date |
| `total` | string | The total amount due, including currency symbol |

The description matters — it's what the tiny LLM uses to find the right value in the OCR'd text, and later what the field-matcher uses to match extracted data to a form field's label. Click **Save**.

### 2. Capture and extract

Pick whichever trigger fits what's in front of you:

- **Drag-select a region**: click the extension icon → **Capture region** → drag a rectangle over the text on the page (e.g. a receipt image, a table, a paragraph). The popup closes; the raw OCR result appears in a small panel on the page itself.
- **Right-click an image** → **"OCR this image"** in the context menu. Same result panel, no popup involved.
- **Upload or drop a file**: click the extension icon → **Upload file** (or drag an image onto the dropzone). Before uploading, pick a schema from the **"Extract as"** dropdown — leave it on "Cleaned-up text" for a quick OCR-and-tidy pass, or pick a saved schema (e.g. "Invoice (demo)") to get structured JSON back.

Example: uploading a picture of an invoice with "Invoice (demo)" selected returns something like:

```json
{ "vendor": "Acme Supply Co.", "date": "2026-09-21", "total": "$482.17" }
```

### 3. Fill a form with it

Once structured data is showing in the popup, a **"Fill form on this page"** button appears. Click it (the popup closes — target whichever tab was active when you opened the popup). The extension:

1. Scans that page for fillable inputs (`<input>`, `<textarea>`, `<select>`), reading each one's label/`aria-label`/placeholder/name.
2. Matches your extracted fields to those inputs by keyword overlap (e.g. schema field `vendor`, description "the company or person being paid" → a form input labeled "Vendor / Company name").
3. Shows a **review panel** on the page listing each proposed match, its confidence, and an editable value — nothing is written until you confirm.
4. Uncheck any row you don't want filled, edit a value if needed, then click **Fill checked fields**.

Fields that don't have a confident match are simply left out — the matcher never guesses at a field with no good candidate, and unrelated inputs (e.g. an internal "notes" field with no matching schema field) are never touched.

## Architecture

Two-stage OCR/structuring pipeline, plus a separate deterministic matching step for autofill:

1. **OCR** ([`lib/inference/ocr.ts`](lib/inference/ocr.ts)) — [Tesseract.js](https://github.com/naptha/tesseract.js), vendored locally (worker, WASM core, English language data) rather than loaded from a CDN, since Manifest V3 disallows remotely-hosted code.
2. **Structuring** ([`lib/inference/structuring.ts`](lib/inference/structuring.ts)) — [Transformers.js](https://huggingface.co/docs/transformers.js) running **Qwen2.5-0.5B-Instruct** (quantized ONNX), which either extracts fields into a user-defined JSON schema or cleans up free-form text.
3. **Field matching** ([`lib/autofill/field-matcher.ts`](lib/autofill/field-matcher.ts)) — deterministic keyword overlap between each schema field's name/description and each detected DOM field's label, not the LLM. An LLM-based matcher was tried first; testing against a real form showed the 0.5B model can't reliably produce the structured "pair two lists" output this step needs (it kept collapsing to a flat array instead of the requested object array), so it was replaced — this step has no model dependency at all now.

**Execution context**, the part that actually differs per browser:

- **Chrome/Edge**: OCR and the LLM run in an [offscreen document](entrypoints/offscreen.html) (`chrome.offscreen`), since the MV3 background service worker can be suspended mid-recognition. The background script stays thin — context menus, `tabs.captureVisibleTab`, cropping, field matching, and message routing.
- **Firefox**: no offscreen API exists (or is needed) — its MV3 background is a persistent event page with real DOM access, so [`entrypoints/background.ts`](entrypoints/background.ts) calls the inference modules directly.

Binary payloads (cropped screenshots, uploaded files) are base64-encoded before crossing `runtime.sendMessage` — a raw `ArrayBuffer` does not reliably survive that hop to the offscreen document despite Chrome's documented structured-clone support (see [`lib/messaging/binary.ts`](lib/messaging/binary.ts)).

## Project structure

```
entrypoints/
  background.ts               # context menus, screenshot capture/crop, field matching, message routing
  offscreen.html / offscreen/  # Chrome/Edge only — hosts Tesseract.js + the tiny LLM
  popup/                       # capture triggers, schema picker, results view, "Fill form" action
  options/                     # schema builder (name/type/description per field)
  region-capture.content.ts    # on-demand drag-select overlay, injected via scripting.executeScript
  autofill-review.content.ts   # field-mapping review/confirm overlay, injected on demand
lib/
  inference/    # OCR + tiny-LLM wrappers, model registry, device (WebGPU/WASM) selection
  messaging/    # typed cross-context message contracts, binary (base64) encoding helpers
  storage/      # schema storage (chrome.storage.local)
  autofill/     # DOM field detection, keyword-based matching, native-setter DOM writes
  ui/           # shared Shadow-DOM result overlay
public/
  tesseract-core/, tessdata/   # vendored Tesseract.js worker, WASM core, English language data
  onnx-wasm/                   # vendored ONNX Runtime Web WASM backend
  icon/                        # extension icon, also used as the popup/options page favicon
```

## Getting started

```bash
npm install
npm run dev            # Chrome, with hot reload
npm run dev:firefox    # Firefox
npm run dev:edge       # Edge
```

Build for production:

```bash
npm run build           # Chrome  → .output/chrome-mv3
npm run build:firefox   # Firefox → .output/firefox-mv3
npm run build:edge      # Edge    → .output/edge-mv3
```

Load unpacked from the corresponding `.output/<browser>-mv3` folder via each browser's extensions page (with Developer mode enabled).

## Status

Actively developed. All four phases of the original plan are implemented and have been manually verified end to end in a live Chrome install: OCR capture (region/right-click/upload), tiny-LLM structuring, the schema builder, and DOM autofill (detect → match → review/confirm → write).

### Planned enhancements

- **Model picker** — `lib/inference/model-registry.ts` already lists a lighter "lite" model (SmolLM2-360M-Instruct) alongside the default Qwen2.5-0.5B-Instruct, but there's no settings UI to switch between them yet.
- **WebGPU acceleration** — structuring currently forces the WASM execution provider everywhere for reliability (see the note in `lib/inference/structuring.ts`); opportunistic WebGPU on browsers/devices that support it would speed up generation.
- **Additional OCR languages** — only English (`eng.traineddata`) is vendored today; other languages would need their own `.traineddata` file added to `public/tessdata/`.
- **PDF input** — file upload currently expects an image; rendering PDF pages to a canvas first (e.g. via `pdf.js`) before handing bitmaps to Tesseract would let PDFs go through the same upload flow.
- **Multi-page / multi-field-set forms** — the field-matcher currently does a single greedy one-to-one pass per `Fill form` click; a form spanning multiple sections or repeated field groups (e.g. multiple line items) isn't specifically handled.

## License

[MIT](LICENSE)
