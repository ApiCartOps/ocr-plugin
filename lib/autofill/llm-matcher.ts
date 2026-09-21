import type { AutofillFieldMapping } from '../messaging/protocol';
import type { DetectedField } from './field-detector';

/**
 * Feeds detected DOM field candidates + the active schema's field
 * descriptions to the tiny LLM to get best-guess field <-> DOM mappings
 * with a confidence score. Every mapping this produces must go through the
 * review/confirm overlay (autofill-review.content.ts) before
 * lib/autofill/dom-writer.ts ever touches the page.
 *
 * Not yet implemented: this is Phase 0 scaffolding, filled in during
 * Phase 4 once lib/inference/structuring.ts (Phase 2) is in place.
 */
export async function matchFieldsToSchema(
  _detected: DetectedField[],
  _extracted: Record<string, unknown>,
): Promise<AutofillFieldMapping[]> {
  return [];
}
