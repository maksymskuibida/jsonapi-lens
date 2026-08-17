type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

/** `document.createElement` with class/attr/children in one call. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: (Attrs & { class?: string; text?: string }) | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (attrs) {
    for (const name of Object.keys(attrs)) {
      const value = attrs[name];
      if (value === undefined || value === false) continue;
      if (name === "class") node.className = String(value);
      else if (name === "text") node.textContent = String(value);
      else if (value === true) node.setAttribute(name, "");
      else node.setAttribute(name, String(value));
    }
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }

  return node;
}

export function frag(...children: Child[]): DocumentFragment {
  const f = document.createDocumentFragment();
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    f.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return f;
}

/**
 * HTML escaping for the bulk render path.
 *
 * The collapsed rows for a large document are built as one HTML string per type
 * group and parsed in a single go, which is measurably faster than tens of
 * thousands of `createElement` calls. That trade only holds if every
 * interpolated value passes through here, so this is the single audited point
 * where payload text becomes markup. Both quote styles are escaped so the
 * function is safe in attribute position as well as text position.
 */
export function escapeHtml(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    switch (ch) {
      case "&":
        out += "&amp;";
        break;
      case "<":
        out += "&lt;";
        break;
      case ">":
        out += "&gt;";
        break;
      case '"':
        out += "&quot;";
        break;
      case "'":
        out += "&#39;";
        break;
      default:
        out += ch;
    }
  }
  return out;
}

export function clear(node: Element): void {
  node.replaceChildren();
}
