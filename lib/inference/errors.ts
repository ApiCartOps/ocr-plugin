/** Chrome's cross-context messaging can only forward proper Error rejections
 * ("A runtime.onMessage listener's promise rejected without an Error"
 * otherwise) — failures from Tesseract.js/Transformers.js don't always
 * reject with one, so every failure that crosses a message boundary is
 * normalized here with enough context to debug. */
export function toError(context: string, cause: unknown): Error {
  const message =
    cause instanceof Error
      ? cause.message
      : (() => {
          try {
            return JSON.stringify(cause);
          } catch {
            return String(cause);
          }
        })();
  return new Error(`${context}: ${message}`);
}
