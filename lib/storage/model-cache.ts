/**
 * Model weight caching. Transformers.js defaults to the Cache Storage API
 * (via `env.useBrowserCache`) for downloaded ONNX weights, which is simplest
 * and avoids re-implementing a binary store — this module exists as the
 * single place to override that behavior later if IndexedDB/OPFS proves
 * necessary for tessdata read performance.
 *
 * Not yet implemented: this is Phase 0 scaffolding, filled in during
 * Phase 2 alongside lib/inference/structuring.ts.
 */
export {};
