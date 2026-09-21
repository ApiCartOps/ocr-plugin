/**
 * Picks an ONNX Runtime Web execution provider for Transformers.js.
 *
 * WebGPU is preferred when available, but must never be assumed: Firefox's
 * support is still inconsistent across channels/platforms, so WASM has to
 * work as a first-class path everywhere, not just a fallback.
 */
export type InferenceDevice = 'webgpu' | 'wasm';

export async function selectInferenceDevice(): Promise<InferenceDevice> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return 'wasm';
  }

  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = await gpu?.requestAdapter();
    return adapter ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}
