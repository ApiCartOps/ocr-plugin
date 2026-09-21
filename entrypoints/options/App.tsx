/**
 * Options page: schema builder (field name/type/description) and model
 * selection/download management.
 *
 * Not yet implemented: this is Phase 0 scaffolding. Phase 3 builds the
 * schema authoring UI on top of lib/storage/schema-store.ts; Phase 2 adds
 * the model download-progress UI here on top of lib/inference/model-registry.ts.
 */
export default function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 640 }}>
      <h1>OCR Form Filler — Settings</h1>
      <p>
        Schema builder and model management land in later build phases. See
        the project plan for the phased build order.
      </p>
    </main>
  );
}
