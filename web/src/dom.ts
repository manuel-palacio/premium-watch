type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, string | number | boolean | EventListener | null | undefined> & { class?: string };

/** Create an element. Strings become text nodes (never HTML). `on*` attrs become listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k in el && typeof v !== 'string' && k !== 'class') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function mount(target: HTMLElement, ...children: Child[]): void {
  target.replaceChildren();
  append(target, children);
}

/** Read a form into a plain object of strings (checkboxes become booleans). */
export function formData(form: HTMLFormElement): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const el of Array.from(form.elements) as HTMLInputElement[]) {
    if (!el.name) continue;
    out[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
  }
  return out;
}

export function errorList(errors: string[]): HTMLElement {
  return h('ul', { class: 'errors' }, errors.map((e) => h('li', null, e)));
}

const mountedQueue: (() => void)[] = [];
/** Run `fn` once the view being built is in the document (charts need to measure their box). */
export function onMounted(fn: () => void): void {
  mountedQueue.push(fn);
}
/** Take the callbacks queued while building a view. */
export function takeMounted(): (() => void)[] {
  return mountedQueue.splice(0);
}
