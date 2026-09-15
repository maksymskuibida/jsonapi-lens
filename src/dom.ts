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

/**
 * Fill an element with text, turning `backticked` spans into `<code>`.
 *
 * The catalogues write member names the way the rest of the documentation
 * does — `` `_links` ``, `` `@odata.context` `` — and several of those strings
 * were being assigned straight to `textContent`, so the backticks reached the
 * screen as literal characters in all three languages.
 *
 * Splits and appends real nodes rather than touching `innerHTML`: every one of
 * these strings interpolates values out of the document being inspected, which
 * is exactly the input that must never be parsed as markup.
 */
export function setRichText(target: HTMLElement, message: string): void {
  const parts = message.split("`");
  target.replaceChildren(
    ...parts.map((part, index) =>
      // Odd indices are what sat between a pair of backticks. An unpaired
      // trailing backtick leaves its text in an even slot, so it stays plain
      // rather than silently opening a `<code>` that never closes.
      index % 2 === 1 && index < parts.length - 1
        ? el("code", { class: "code-span", text: part })
        : document.createTextNode(part),
    ),
  );
}
