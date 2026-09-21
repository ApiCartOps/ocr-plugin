import type { DetectedField } from './field-detector';
import type { AutofillFieldMapping } from '../messaging/protocol';
import type { DocumentSchema } from '../storage/schema-store';

/**
 * Matches extracted data fields to detected DOM form fields by keyword
 * overlap between the schema field's name/description and the DOM field's
 * label — deterministic, no LLM involved.
 *
 * A tiny (0.5B) instruct model was tried here first, but repeatedly failed
 * to produce the requested structured output across three different
 * formats (string ids, numeric indices, with/without confidence) —
 * collapsing every time to a flat two-element array of whatever tokens
 * felt salient to it. That's a genuine capability limit for this
 * "pair two lists" reasoning task, not a prompt-formatting bug: the same
 * model handles single-document key-value extraction (lib/inference/
 * structuring.ts) reasonably well. Matching a handful of well-labeled form
 * fields is exactly the kind of thing keyword overlap already does
 * reliably, so there's no reason to keep fighting the model for it.
 *
 * Every mapping this produces must still go through the review/confirm
 * overlay (autofill-review.content.ts) before lib/autofill/dom-writer.ts
 * ever touches the page — keyword matching can misfire on ambiguous forms,
 * and the user is the backstop for that, not a confidence threshold.
 */

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'or', 'and', 'this', 'that', 'is', 'are', 'was',
  'be', 'to', 'for', 'in', 'on', 'field', 'value', 'enter', 'please',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w)),
  );
}

/** Fraction of the smaller token set that also appears in the larger one —
 * rewards a small, specific label ("Invoice Date") matching a subset of a
 * longer description well, rather than penalizing it for the description's
 * extra words the way a plain Jaccard index would. */
function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / Math.min(a.size, b.size);
}

const MATCH_THRESHOLD = 0.34;

export async function matchFieldsToSchema(
  detected: DetectedField[],
  extracted: Record<string, unknown>,
  schema: DocumentSchema,
): Promise<AutofillFieldMapping[]> {
  // Only string/number/boolean values are fillable into a form control —
  // guards against the structuring step occasionally producing a nested
  // object for a field (e.g. a date field coming back as
  // {year, month, day, ...} instead of a plain string).
  const extractedFields = schema.fields
    .filter((f) => {
      const value = extracted[f.name];
      return (
        (typeof value === 'string' && value !== '') ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      );
    })
    .map((f) => ({
      name: f.name,
      value: extracted[f.name],
      tokens: new Set([...tokenize(f.name), ...tokenize(f.description)]),
    }));

  if (extractedFields.length === 0 || detected.length === 0) return [];

  const detectedTokens = detected.map((d) => tokenize(d.label));

  const candidates: Array<{ extractedIndex: number; detectedIndex: number; score: number }> = [];
  for (let e = 0; e < extractedFields.length; e++) {
    for (let d = 0; d < detected.length; d++) {
      const score = overlapScore(extractedFields[e]!.tokens, detectedTokens[d]!);
      if (score >= MATCH_THRESHOLD) candidates.push({ extractedIndex: e, detectedIndex: d, score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const usedExtracted = new Set<number>();
  const usedDetected = new Set<number>();
  const mappings: AutofillFieldMapping[] = [];

  for (const { extractedIndex, detectedIndex, score } of candidates) {
    if (usedExtracted.has(extractedIndex) || usedDetected.has(detectedIndex)) continue;
    usedExtracted.add(extractedIndex);
    usedDetected.add(detectedIndex);

    const field = extractedFields[extractedIndex]!;
    mappings.push({
      fieldName: field.name,
      value: field.value,
      domRefId: detected[detectedIndex]!.domRefId,
      confidence: Math.min(1, score),
    });
  }

  return mappings;
}
