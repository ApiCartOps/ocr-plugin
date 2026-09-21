import { env, pipeline, type TextGenerationPipeline } from '@huggingface/transformers';
import { toError } from './errors';
import { DEFAULT_MODEL } from './model-registry';
import type { DocumentSchema } from '../storage/schema-store';
import type { ModelDownloadProgress, StructureResult } from '../messaging/protocol';

/**
 * Transformers.js pipeline wrapper — schema-guided field extraction for
 * structured documents, or cleanup/organization for free-form text. Runs in
 * the same context as ocr.ts (offscreen doc on Chrome/Edge, background page
 * on Firefox). See the approved plan's "Execution context" section.
 *
 * WebGPU is deliberately not wired up yet: it requires vendoring a second,
 * ~28MB "jsep" ONNX Runtime Web build (used for both GPU and CPU ops in a
 * WebGPU session) on top of the plain WASM one, and — per the approved
 * plan's risk notes — WASM has to be the reliable path everywhere anyway
 * (Firefox's WebGPU support is inconsistent). Vendoring only the WASM
 * runtime keeps this phase simpler; WebGPU accel can be layered in later
 * without changing this module's public API.
 */

// onnxruntime-web defaults to fetching its own WASM runtime from a CDN,
// which both violates MV3's no-remote-code rule and breaks offline use —
// point it at the copy vendored into public/onnx-wasm instead.
// Transformers.js types `env.backends.onnx` as Partial<Env>, but it's
// always populated by the library itself at import time.
const wasmEnv = env.backends.onnx.wasm!;
wasmEnv.wasmPaths = {
  wasm: browser.runtime.getURL('/onnx-wasm/ort-wasm-simd-threaded.wasm'),
  mjs: browser.runtime.getURL('/onnx-wasm/ort-wasm-simd-threaded.mjs'),
};
// Multi-threaded WASM needs SharedArrayBuffer, which needs cross-origin
// isolation (COOP/COEP) headers this extension doesn't set up — force
// single-threaded execution rather than let it fail at runtime.
wasmEnv.numThreads = 1;
wasmEnv.proxy = false;

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

let generatorPromise: Promise<TextGenerationPipeline> | null = null;

function broadcastProgress(loaded: number, total: number): void {
  const message: ModelDownloadProgress = {
    type: 'model/download-progress',
    modelId: DEFAULT_MODEL.id,
    loaded,
    total,
  };
  // Fire-and-forget: nothing is listening if no popup/options page happens
  // to be open, and that's fine — this is a progress hint, not a request.
  browser.runtime.sendMessage(message).catch(() => {});
}

function getGenerator(): Promise<TextGenerationPipeline> {
  generatorPromise ??= pipeline('text-generation', DEFAULT_MODEL.repoId, {
    dtype: 'q4',
    device: 'wasm',
    progress_callback: (info) => {
      if (info.status === 'progress_total') {
        broadcastProgress(info.loaded, info.total);
      }
    },
  }).catch((cause) => {
    // Don't leave a rejected promise cached — a transient download/init
    // failure would otherwise permanently break every future request.
    generatorPromise = null;
    throw toError('Tiny LLM initialization failed', cause);
  });
  return generatorPromise;
}

function buildMessages(rawText: string, schema?: DocumentSchema): ChatMessage[] {
  if (!schema) {
    return [
      {
        role: 'system',
        content:
          'You clean up raw OCR text. Fix obvious OCR misreads and restore ' +
          'reasonable capitalization/punctuation where context makes it ' +
          'clear, but never add, remove, or reinterpret information that ' +
          "isn't present in the source. Reply with only the cleaned text " +
          '— no commentary, no markdown formatting.',
      },
      { role: 'user', content: rawText },
    ];
  }

  const fieldLines = schema.fields
    .map((f) => `- "${f.name}" (${f.type}): ${f.description}`)
    .join('\n');

  return [
    {
      role: 'system',
      content:
        "You extract structured data from a document's OCR'd text into a " +
        'JSON object matching this schema. Use null for any field you ' +
        "can't find evidence for in the text — never invent a value. " +
        'Reply with only the JSON object — no commentary, no markdown ' +
        `code fences.\n\nSchema fields:\n${fieldLines}`,
    },
    { role: 'user', content: rawText },
  ];
}

/** Finds and parses the first top-level {...} object in the model's reply —
 * small instruct models frequently wrap JSON in prose or code fences
 * despite being told not to. */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export async function structure(
  rawText: string,
  requestId: string,
  schema?: DocumentSchema,
): Promise<StructureResult> {
  const generator = await getGenerator();
  const messages = buildMessages(rawText, schema);

  let reply: string;
  try {
    const output = await generator(messages, { max_new_tokens: 512, do_sample: false });
    const result = Array.isArray(output) ? output[0] : output;
    const generated = result?.generated_text;
    reply =
      typeof generated === 'string'
        ? generated
        : ((generated?.at(-1)?.content as string | undefined) ?? '');
  } catch (cause) {
    throw toError('Tiny LLM generation failed', cause);
  }

  if (!schema) {
    return { type: 'structure/result', requestId, data: { cleanedText: reply.trim() } };
  }

  const parsed = extractJsonObject(reply);
  if (!parsed) {
    throw new Error(`Tiny LLM did not return valid JSON — raw reply: ${reply.slice(0, 300)}`);
  }
  return { type: 'structure/result', requestId, data: parsed };
}
