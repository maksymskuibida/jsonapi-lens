import { el } from "./dom.js";
import { classify, formatDate, formatNumber, humanizeKey, previewValue } from "./format.js";
import type { JsonObject, JsonValue } from "./types.js";

/** Nested structures past this depth stay collapsed, to keep expansion cheap. */
const AUTO_OPEN_DEPTH = 1;

/** A single scalar, typed so the shape of the data is legible at a glance. */
function renderScalar(value: JsonValue): HTMLElement {
  const kind = classify(value);

  switch (kind) {
    case "null":
      return el("span", { class: "v v--null", text: "null" });

    case "empty-string":
      return el("span", { class: "v v--empty", text: "empty string" });

    case "boolean":
      return el("span", { class: `v v--bool v--bool-${String(value)}`, text: String(value) });

    case "number":
      return el("span", {
        class: "v v--num",
        text: formatNumber(value as number),
        title: String(value),
      });

    case "date": {
      const formatted = formatDate(value as string);
      if (!formatted) return el("span", { class: "v v--str", text: String(value) });
      return el(
        "span",
        { class: "v v--date", title: formatted.title },
        el("span", { class: "v__date-display", text: formatted.display }),
        el("span", { class: "v__date-raw", text: value as string }),
      );
    }

    case "uuid":
      return el("span", { class: "v v--uuid", text: value as string });

    case "url":
      // `rel=noreferrer` so following a link out of a payload leaks no referrer.
      return el("a", {
        class: "v v--url",
        href: value as string,
        target: "_blank",
        rel: "noopener noreferrer",
        text: value as string,
      });

    default:
      return el("span", { class: "v v--str", text: String(value) });
  }
}

/** An object or array, as a disclosure with a one-line preview in the summary. */
function renderNested(value: JsonValue, depth: number): HTMLElement {
  const isArray = Array.isArray(value);
  const entries: [string, JsonValue][] = isArray
    ? (value as JsonValue[]).map((v, i) => [String(i), v])
    : Object.keys(value as JsonObject).map((k) => [k, (value as JsonObject)[k]!]);

  if (entries.length === 0) {
    return el("span", { class: "v v--empty", text: isArray ? "empty array" : "empty object" });
  }

  const details = el("details", { class: "tree", open: depth < AUTO_OPEN_DEPTH });
  const label = isArray
    ? `${entries.length} ${entries.length === 1 ? "item" : "items"}`
    : `${entries.length} ${entries.length === 1 ? "key" : "keys"}`;

  details.append(
    el(
      "summary",
      { class: "tree__summary" },
      el("span", { class: "tree__marker", text: isArray ? "[ ]" : "{ }" }),
      el("span", { class: "tree__count", text: label }),
      el("span", { class: "tree__preview", text: previewValue(value) }),
    ),
    renderEntries(entries, depth + 1, isArray),
  );

  return details;
}

function renderEntries(
  entries: [string, JsonValue][],
  depth: number,
  numericKeys: boolean,
): HTMLElement {
  const list = el("dl", { class: "kv" });

  for (const [key, value] of entries) {
    const kind = classify(value);
    const isNested = kind === "object" || kind === "array";

    list.append(
      el(
        "dt",
        { class: numericKeys ? "kv__key kv__key--index" : "kv__key", title: key },
        numericKeys ? key : humanizeKey(key),
        !numericKeys && el("span", { class: "kv__raw-key", text: key }),
      ),
      el(
        "dd",
        { class: `kv__val${isNested ? " kv__val--nested" : ""}` },
        isNested ? renderNested(value, depth) : renderScalar(value),
      ),
    );
  }

  return list;
}

/** A `attributes` / `meta` / `links` block. */
export function renderObjectBlock(title: string, value: JsonObject, modifier = ""): HTMLElement {
  const keys = Object.keys(value);
  const section = el("div", { class: `block${modifier ? ` block--${modifier}` : ""}` });

  section.append(
    el(
      "h4",
      { class: "block__title" },
      title,
      el("span", { class: "block__count", text: String(keys.length) }),
    ),
  );

  if (keys.length === 0) {
    section.append(el("p", { class: "block__empty", text: `No ${title.toLowerCase()}.` }));
    return section;
  }

  section.append(renderEntries(keys.map((k) => [k, value[k]!]), 0, false));
  return section;
}

export { renderScalar };
