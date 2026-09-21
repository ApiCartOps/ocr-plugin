import { useCallback, useEffect, useState } from 'react';
import { MODEL_REGISTRY } from '../../lib/inference/model-registry';
import { getSelectedModelId, setSelectedModelId } from '../../lib/storage/model-preference';
import {
  deleteSchema,
  listSchemas,
  saveSchema,
  type DocumentSchema,
  type SchemaField,
  type SchemaFieldType,
} from '../../lib/storage/schema-store';
import './App.css';

const FIELD_TYPES: SchemaFieldType[] = ['string', 'number', 'date', 'boolean', 'enum'];

function emptyField(): SchemaField {
  return { name: '', type: 'string', description: '' };
}

function emptyDraft(): { name: string; fields: SchemaField[] } {
  return { name: '', fields: [emptyField()] };
}

function toDraft(schema: DocumentSchema): { name: string; fields: SchemaField[] } {
  return { name: schema.name, fields: schema.fields.map((f) => ({ ...f })) };
}

/**
 * Options page: schema builder (field name/type/description), stored via
 * lib/storage/schema-store.ts, plus a picker for which tiny LLM to use for
 * structuring/matching. The popup's schema picker reads whatever schemas
 * are saved here; lib/inference/structuring.ts reads the model choice on
 * every request (see getSelectedModel), so picking a new one here takes
 * effect on the next capture without needing to reload the extension.
 */
export default function App() {
  const [schemas, setSchemas] = useState<DocumentSchema[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSchemas(await listSchemas());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void getSelectedModelId().then(setModelId);
  }, []);

  const onSelectModel = useCallback(async (id: string) => {
    setModelId(id);
    await setSelectedModelId(id);
  }, []);

  const selectSchema = useCallback((schema: DocumentSchema) => {
    setSelectedId(schema.id);
    setDraft(toDraft(schema));
    setError(null);
    setSavedAt(null);
  }, []);

  const startNewSchema = useCallback(() => {
    setSelectedId(null);
    setDraft(emptyDraft());
    setError(null);
    setSavedAt(null);
  }, []);

  const updateField = useCallback((index: number, patch: Partial<SchemaField>) => {
    setDraft((prev) => ({
      ...prev,
      fields: prev.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    }));
  }, []);

  const addField = useCallback(() => {
    setDraft((prev) => ({ ...prev, fields: [...prev.fields, emptyField()] }));
  }, []);

  const removeField = useCallback((index: number) => {
    setDraft((prev) => ({ ...prev, fields: prev.fields.filter((_, i) => i !== index) }));
  }, []);

  const validate = useCallback((): string | null => {
    if (!draft.name.trim()) return 'Give the schema a name.';
    if (draft.fields.length === 0) return 'Add at least one field.';
    for (const field of draft.fields) {
      if (!field.name.trim()) return 'Every field needs a name.';
      if (!field.description.trim()) return `Field "${field.name}" needs a description.`;
      if (field.type === 'enum' && (!field.options || field.options.length === 0)) {
        return `Field "${field.name}" is an enum — list its allowed values.`;
      }
    }
    return null;
  }, [draft]);

  const onSave = useCallback(async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);

    const now = Date.now();
    const schema: DocumentSchema = {
      id: selectedId ?? crypto.randomUUID(),
      name: draft.name.trim(),
      fields: draft.fields.map((f) => ({
        ...f,
        name: f.name.trim(),
        description: f.description.trim(),
      })),
      createdAt: selectedId
        ? (schemas.find((s) => s.id === selectedId)?.createdAt ?? now)
        : now,
      updatedAt: now,
    };

    await saveSchema(schema);
    await refresh();
    setSelectedId(schema.id);
    setSavedAt(now);
  }, [draft, selectedId, schemas, validate, refresh]);

  const onDelete = useCallback(async () => {
    if (!selectedId) return;
    await deleteSchema(selectedId);
    await refresh();
    startNewSchema();
  }, [selectedId, refresh, startNewSchema]);

  return (
    <main className="options-main">
      <h1>OCR Form Filler — Settings</h1>
      <section className="model-picker">
        <h2>Extraction model</h2>
        <p className="hint">
          Runs entirely in your browser — switching models downloads the new one on its
          first use (cached afterward) and takes effect on your next capture, no reload
          needed.
        </p>
        <div className="model-options">
          {MODEL_REGISTRY.map((model) => (
            <label key={model.id} className={`model-option${modelId === model.id ? ' active' : ''}`}>
              <input
                type="radio"
                name="model"
                value={model.id}
                checked={modelId === model.id}
                onChange={() => void onSelectModel(model.id)}
              />
              <span className="model-label">{model.label}</span>
              <span className="model-size">~{model.approxSizeMb} MB</span>
            </label>
          ))}
        </div>
      </section>

      <h2>Schemas</h2>
      <p className="hint">
        Define the fields you want extracted from a document (name, type, and a short
        description the tiny LLM uses to find the right value). Schemas you save here
        appear in the popup's capture picker.
      </p>

      <div className="layout">
        <aside className="schema-list">
          <button type="button" className="primary" onClick={startNewSchema}>
            + New schema
          </button>
          {schemas.length === 0 && <p className="hint small">No custom schemas yet.</p>}
          <ul>
            {schemas.map((schema) => (
              <li key={schema.id}>
                <button
                  type="button"
                  className={`schema-item${schema.id === selectedId ? ' active' : ''}`}
                  onClick={() => selectSchema(schema)}
                >
                  {schema.name}
                  <span className="field-count">{schema.fields.length} fields</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="editor">
          <label className="row">
            <span>Schema name</span>
            <input
              type="text"
              value={draft.name}
              placeholder="e.g. Business Card"
              onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
            />
          </label>

          <div className="fields">
            {draft.fields.map((field, index) => (
              <div className="field-row" key={index}>
                <input
                  type="text"
                  placeholder="Field name"
                  value={field.name}
                  onChange={(e) => updateField(index, { name: e.target.value })}
                />
                <select
                  value={field.type}
                  onChange={(e) => updateField(index, { type: e.target.value as SchemaFieldType })}
                >
                  {FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Description (helps the LLM find it)"
                  value={field.description}
                  onChange={(e) => updateField(index, { description: e.target.value })}
                  className="description"
                />
                {field.type === 'enum' && (
                  <input
                    type="text"
                    placeholder="Allowed values, comma-separated"
                    value={field.options?.join(', ') ?? ''}
                    onChange={(e) =>
                      updateField(index, {
                        options: e.target.value
                          .split(',')
                          .map((v) => v.trim())
                          .filter(Boolean),
                      })
                    }
                    className="description"
                  />
                )}
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => removeField(index)}
                  aria-label="Remove field"
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" onClick={addField}>
              + Add field
            </button>
          </div>

          {error && <div className="status error">{error}</div>}
          {savedAt && !error && <div className="status">Saved.</div>}

          <div className="actions">
            <button type="button" className="primary" onClick={onSave}>
              Save schema
            </button>
            {selectedId && (
              <button type="button" onClick={onDelete}>
                Delete
              </button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
