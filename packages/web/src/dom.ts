/**
 * A hundred lines of DOM helper, in place of a framework.
 *
 * The whole client re-renders from the server view on every change, and the map
 * is a few dozen polygons — so there is nothing here for a virtual DOM to save.
 */

export type Child = Node | string | number | null | undefined | false | Child[];

export type Attrs = Record<string, unknown>;

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyAttrs(node, attrs);
  append(node, children);
  return node;
}

export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  applyAttrs(node, attrs);
  append(node, children);
  return node;
}

function applyAttrs(node: Element, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;

    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener);
      continue;
    }

    if (key === 'value' && node instanceof HTMLInputElement) {
      node.value = String(value);
      continue;
    }

    node.setAttribute(key, value === true ? '' : String(value));
  }
}

function append(node: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) {
      append(node, child);
      continue;
    }
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function replace(host: Element, ...children: Child[]): void {
  host.replaceChildren();
  append(host, children);
}

export function must<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`missing element: ${selector}`);
  return node;
}
