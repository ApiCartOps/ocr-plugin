/**
 * Encodes/decodes ArrayBuffers for cross-context messages.
 *
 * `chrome.runtime.sendMessage`/`onMessage` is documented to support
 * structured clone, which should carry ArrayBuffer as-is — but in practice
 * (confirmed while testing the offscreen-document hop) it does not: the
 * buffer arrives as an empty object on the other side. Base64 sidesteps
 * whatever internal serialization is actually happening, at the cost of a
 * ~33% size increase — acceptable for the cropped screenshots and uploaded
 * files this carries.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
