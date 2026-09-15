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
 * A piece of a rendered message.
 *
 * A plain `string` is **catalogue-owned** text: its backticks are markers and
 * become `<code>` spans. A `{ verbatim }` part is **anything else** — a key out
 * of the document, a parser's own message quoting a slice of the payload — and
 * is inserted exactly as given, never scanned.
 *
 * That split is the whole point. The first version of this took one string and
 * parsed the lot, so a caller that interpolated document text into it handed
 * the renderer a marker character it did not control: a key spelled `` a`b ``
 * displayed as `ab`, and V8's "Unexpected token '`'" rendered as "Unexpected
 * token ''" — the message's entire job is to name that character — with
 * fragments of the payload styled as member names. Escaping at each call site
 * was patching the same hole once per site; passing values as values closes it.
 */
export type RichPart = string | { readonly verbatim: string };

/** The plain-text reading of a part list, for `Error.message` and the like. */
export function richToText(parts: readonly RichPart[]): string {
  return parts.map((part) => (typeof part === "string" ? part.replace(/`/g, "") : part.verbatim)).join("");
}

/**
 * Render a message into an element: catalogue text with `code` spans, and
 * interpolated values exactly as they came.
 *
 * Appends real nodes rather than touching `innerHTML` — every one of these
 * strings can carry text out of the document being inspected, which is the
 * input that must never be parsed as markup.
 */
export function setRich(target: HTMLElement, parts: readonly RichPart[]): void {
  const nodes: Node[] = [];

  for (const part of parts) {
    if (typeof part !== "string") {
      nodes.push(document.createTextNode(part.verbatim));
      continue;
    }
    const chunks = part.split("`");
    chunks.forEach((chunk, index) => {
      // Odd indices sat between a pair. An unpaired trailing backtick leaves
      // its text in an even slot, so it stays plain rather than opening a span
      // that never closes.
      nodes.push(
        index % 2 === 1 && index < chunks.length - 1
          ? el("code", { class: "code-span", text: chunk })
          : document.createTextNode(chunk),
      );
    });
  }

  target.replaceChildren(...nodes);
}

/** The common case: one catalogue-owned string, no interpolated values. */
export function setRichText(target: HTMLElement, message: string | readonly RichPart[]): void {
  setRich(target, typeof message === "string" ? [message] : message);
}
