/**
 * Writes a value into a form control such that React/Vue/Angular-controlled
 * inputs actually pick up the change. A plain `el.value = x` assignment
 * goes through the element's own instance property, which frameworks
 * override with a getter/setter pair that intercepts writes — so the
 * framework's synthetic change detection never fires. Setting through the
 * *native* prototype's setter bypasses that override, and dispatching
 * `input`/`change` afterwards is what the framework's listeners actually
 * observe.
 */
function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
}

export function writeFieldValue(
  element: Element,
  value: unknown,
): void {
  const stringValue = value == null ? '' : String(value);

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element instanceof HTMLInputElement && element.type === 'checkbox') {
      const checked = value === true || stringValue.toLowerCase() === 'true';
      if (element.checked !== checked) {
        element.click();
      }
    } else {
      setNativeValue(element, stringValue);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return;
  }

  if (element instanceof HTMLSelectElement) {
    element.value = stringValue;
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    element.textContent = stringValue;
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
}
