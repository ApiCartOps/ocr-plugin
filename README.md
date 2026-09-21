# OCR Form Filler

A cross-browser (Chrome, Firefox, Edge) extension that OCRs content on a page — a screenshot region, a right-clicked image, or an uploaded file — and uses a small, fully in-browser LLM to turn it into structured data or cleaned-up text. No server, no API keys, works offline.

## Features

- **Three capture triggers**
  - Drag-select a region of the current tab
  - Right-click any image → "OCR this image"
  - Upload or drop a file in the popup
- **Fully offline inference** — OCR (Tesseract.js) and text structuring (a tiny instruct LLM via Transformers.js) both run entirely in the browser, no network calls after the one-time model download
- **Schema-guided extraction** — point the tiny LLM at a JSON schema and get structured fields back instead of raw text
- **Manifest V3, all three browsers** — one codebase, per-browser manifest differences (e.g. Chrome/Edge's offscreen document vs. Firefox's persistent background page) handled by [WXT](https://wxt.dev)

## Architecture

Two-stage pipeline instead of one large vision-language model:

1. **OCR** ([`lib/inference/ocr.ts`](lib/inference/ocr.ts)) — [Tesseract.js](https://github.com/naptha/tesseract.js), vendored locally (worker, WASM core, English language data) rather than loaded from a CDN, since Manifest V3 disallows remotely-hosted code.
2. **Structuring** ([`lib/inference/structuring.ts`](lib/inference/structuring.ts)) — [Transformers.js](https://huggingface.co/docs/transformers.js) running **Qwen2.5-0.5B-Instruct** (quantized ONNX), which either extracts fields into a user-defined JSON schema or cleans up free-form text.

**Execution context**, the part that actually differs per browser:

- **Chrome/Edge**: OCR and the LLM run in an [offscreen document](entrypoints/offscreen.html) (`chrome.offscreen`), since the MV3 background service worker can be suspended mid-recognition. The background script stays thin — context menus, `tabs.captureVisibleTab`, cropping, and message routing.
- **Firefox**: no offscreen API exists (or is needed) — its MV3 background is a persistent event page with real DOM access, so [`entrypoints/background.ts`](entrypoints/background.ts) calls the inference modules directly.

Binary payloads (cropped screenshots, uploaded files) are base64-encoded before crossing `runtime.sendMessage` — a raw `ArrayBuffer` does not reliably survive that hop to the offscreen document despite Chrome's documented structured-clone support (see [`lib/messaging/binary.ts`](lib/messaging/binary.ts)).

## Project structure

```
entrypoints/
  background.ts               # context menus, screenshot capture/crop, message routing
  offscreen.html / offscreen/  # Chrome/Edge only — hosts Tesseract.js + the tiny LLM
  popup/                       # upload/drop capture, schema toggle, results view
  options/                     # settings page (schema builder lands in a later phase)
  region-capture.content.ts    # on-demand drag-select overlay, injected via scripting.executeScript
  autofill-review.content.ts   # field-mapping review/confirm overlay (Phase 4, not yet implemented)
lib/
  inference/    # OCR + tiny-LLM wrappers, model registry, device (WebGPU/WASM) selection
  messaging/    # typed cross-context message contracts, binary (base64) encoding helpers
  storage/      # schema storage (chrome.storage.local), model-cache notes
  autofill/     # DOM field detection, LLM-assisted matching, native-setter DOM writes
  ui/           # shared Shadow-DOM result overlay
public/
  tesseract-core/, tessdata/   # vendored Tesseract.js worker, WASM core, English language data
  onnx-wasm/                   # vendored ONNX Runtime Web WASM backend
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

Actively developed. Capture (region/right-click/upload) and structuring both work end-to-end, verified in a live Chrome install. Not yet implemented: the schema builder UI (options page) and DOM auto-fill with the review/confirm step — the underlying `lib/autofill/*` modules are scaffolded but not wired up.

## License

[MIT](LICENSE)
