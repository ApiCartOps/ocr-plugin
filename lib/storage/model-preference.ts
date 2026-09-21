import { DEFAULT_MODEL, MODEL_REGISTRY, type ModelDescriptor } from '../inference/model-registry';

const STORAGE_KEY = 'ocr-plugin:selected-model-id';

export async function getSelectedModelId(): Promise<string> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as string | undefined) ?? DEFAULT_MODEL.id;
}

export async function setSelectedModelId(id: string): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: id });
}

export async function getSelectedModel(): Promise<ModelDescriptor> {
  const id = await getSelectedModelId();
  return MODEL_REGISTRY.find((m) => m.id === id) ?? DEFAULT_MODEL;
}
