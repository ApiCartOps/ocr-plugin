export interface DetectedField {
  domRefId: string;
  label: string;
  inputType: string;
}

/**
 * Heuristic scan of the current page's form controls (label[for],
 * aria-label, placeholder, name, nearby text nodes). Runs in a content
 * script injected on demand via chrome.scripting.executeScript, never as a
 * persistent content script — see the approved plan's permission scoping.
 *
 * Not yet implemented: this is Phase 0 scaffolding. Phase 4 implements the
 * heuristics and wires this into lib/autofill/llm-matcher.ts.
 */
export function detectFormFields(_root: ParentNode = document): DetectedField[] {
  return [];
}
