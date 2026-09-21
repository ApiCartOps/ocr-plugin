import { runChat } from '../inference/structuring';
import type { DetectedField } from './field-detector';
import type { AutofillFieldMapping } from '../messaging/protocol';
import type { DocumentSchema } from '../storage/schema-store';

/** Finds and parses the first top-level [...] array in the model's reply —
 * mirrors lib/inference/structuring.ts's object variant. */
function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Feeds detected DOM field candidates + the active schema's field
 * descriptions to the tiny LLM to get best-guess field <-> DOM mappings.
 * The LLM only picks *which* detected field each extracted value goes
 * into — it never re-generates the value itself, since small models are
 * far less reliable at faithfully copying a value than at picking from a
 * short list.
 *
 * Every mapping this produces must go through the review/confirm overlay
 * (autofill-review.content.ts) before lib/autofill/dom-writer.ts ever
 * touches the page.
 */
export async function matchFieldsToSchema(
  detected: DetectedField[],
  extracted: Record<string, unknown>,
  schema: DocumentSchema,
): Promise<AutofillFieldMapping[]> {
  const extractedFields = schema.fields
    .filter((f) => extracted[f.name] != null && extracted[f.name] !== '')
    .map((f) => ({ name: f.name, description: f.description, value: extracted[f.name] }));

  if (extractedFields.length === 0 || detected.length === 0) return [];

  const messages = [
    {
      role: 'system' as const,
      content:
        'You match extracted data fields to form fields detected on a web ' +
        'page. For each detected form field, decide which extracted data ' +
        "field (if any) it should be filled with, based on the form " +
        "field's label. Only include a match when you're reasonably " +
        'confident — skip fields with no good match rather than guessing. ' +
        'Reply with only a JSON array, no commentary, no markdown fences. ' +
        'Each item: {"fieldName": <extracted field name>, "domRefId": ' +
        '<matched form field\'s domRefId>, "confidence": <0 to 1>}.',
    },
    {
      role: 'user' as const,
      content: JSON.stringify({ extractedFields, detectedFields: detected }),
    },
  ];

  const reply = await runChat(messages, 400);
  const parsed = extractJsonArray(reply);
  if (!parsed) return [];

  const detectedById = new Map(detected.map((d) => [d.domRefId, d]));
  const mappings: AutofillFieldMapping[] = [];

  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const { fieldName, domRefId, confidence } = item as Record<string, unknown>;
    if (typeof fieldName !== 'string' || typeof domRefId !== 'string') continue;
    if (!detectedById.has(domRefId)) continue;
    const field = extractedFields.find((f) => f.name === fieldName);
    if (!field) continue;

    mappings.push({
      fieldName,
      value: field.value,
      domRefId,
      confidence: typeof confidence === 'number' ? confidence : 0.5,
    });
  }

  return mappings;
}
