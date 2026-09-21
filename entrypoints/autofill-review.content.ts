/**
 * Renders the field-mapping review/confirm overlay (in a Shadow DOM root,
 * to avoid CSS collisions with the host page) after lib/autofill/llm-matcher.ts
 * proposes DOM mappings. Nothing is written to the page — see
 * lib/autofill/dom-writer.ts — until the user confirms each mapping here.
 * Only registered on-demand, not as a persistent all-urls content script.
 *
 * Not yet implemented: this is Phase 0 scaffolding. Phase 4 implements the
 * review UI and wires it to lib/autofill/*.
 */
export default defineContentScript({
  matches: [],
  registration: 'runtime',
  main() {
    console.log('[ocr-plugin] autofill-review content script loaded');
  },
});
