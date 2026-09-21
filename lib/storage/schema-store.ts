export type SchemaFieldType = 'string' | 'number' | 'date' | 'boolean' | 'enum';

export interface SchemaField {
  name: string;
  type: SchemaFieldType;
  description: string;
  /** Only used when type === 'enum'. */
  options?: string[];
}

export interface DocumentSchema {
  id: string;
  name: string;
  fields: SchemaField[];
  createdAt: number;
  updatedAt: number;
}

// Phase 3 adds the schema builder UI for authoring these. Until then, this
// built-in schema is what exercises the structuring pipeline's schema-guided
// extraction mode end to end.
export const DEMO_INVOICE_SCHEMA: DocumentSchema = {
  id: 'demo-invoice',
  name: 'Invoice (demo)',
  fields: [
    { name: 'vendor', type: 'string', description: 'The company or person being paid' },
    { name: 'date', type: 'date', description: 'The invoice or document date' },
    { name: 'total', type: 'string', description: 'The total amount due, including currency symbol' },
  ],
  createdAt: 0,
  updatedAt: 0,
};

const STORAGE_KEY = 'ocr-plugin:schemas';

async function readAll(): Promise<DocumentSchema[]> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as DocumentSchema[] | undefined) ?? [];
}

async function writeAll(schemas: DocumentSchema[]): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: schemas });
}

export async function listSchemas(): Promise<DocumentSchema[]> {
  return readAll();
}

export async function getSchema(id: string): Promise<DocumentSchema | undefined> {
  const schemas = await readAll();
  return schemas.find((s) => s.id === id);
}

export async function saveSchema(schema: DocumentSchema): Promise<void> {
  const schemas = await readAll();
  const index = schemas.findIndex((s) => s.id === schema.id);
  if (index >= 0) {
    schemas[index] = schema;
  } else {
    schemas.push(schema);
  }
  await writeAll(schemas);
}

export async function deleteSchema(id: string): Promise<void> {
  const schemas = await readAll();
  await writeAll(schemas.filter((s) => s.id !== id));
}
