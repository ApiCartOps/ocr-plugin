import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => ({
    name: 'OCR Form Filler',
    description:
      'Fully offline OCR + tiny-LLM extraction with schema-driven form autofill.',
    permissions: [
      'activeTab',
      'scripting',
      'contextMenus',
      'storage',
      // chrome.offscreen only exists on Chromium browsers; Firefox's MV3
      // background is a persistent event page with real DOM access instead.
      ...(browser === 'firefox' ? [] : ['offscreen']),
    ],
    host_permissions: [
      // Narrowly scoped to the CDN the tiny LLM's weights download from on
      // first use (not bundled — too large for store size limits).
      'https://huggingface.co/*',
      'https://cdn-lfs.huggingface.co/*',
      'https://cdn-lfs-us-1.huggingface.co/*',
    ],
    content_security_policy: {
      // Required by both Tesseract.js's wasm loader and ONNX Runtime Web's
      // wasm execution provider.
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  }),
});
