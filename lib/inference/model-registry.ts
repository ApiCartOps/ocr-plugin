export interface ModelDescriptor {
  id: string;
  label: string;
  /** Hugging Face repo id, loaded via Transformers.js. */
  repoId: string;
  /** Approximate download size in MB for the quantized ONNX weights, shown
   * in the first-run download UI. */
  approxSizeMb: number;
}

export const DEFAULT_MODEL: ModelDescriptor = {
  id: 'qwen2.5-0.5b-instruct',
  label: 'Qwen2.5 0.5B Instruct (default)',
  repoId: 'onnx-community/Qwen2.5-0.5B-Instruct',
  approxSizeMb: 550,
};

const LITE_MODEL: ModelDescriptor = {
  id: 'smollm2-360m-instruct',
  label: 'SmolLM2 360M Instruct (lite)',
  repoId: 'HuggingFaceTB/SmolLM2-360M-Instruct',
  approxSizeMb: 300,
};

// Phase 3 (options page) adds a picker over this list. Qwen2.5-0.5B-Instruct
// is the default; SmolLM2-360M-Instruct is offered as a lighter "lite"
// option for low-end/offline-constrained devices, per the approved plan.
export const MODEL_REGISTRY: ModelDescriptor[] = [DEFAULT_MODEL, LITE_MODEL];
