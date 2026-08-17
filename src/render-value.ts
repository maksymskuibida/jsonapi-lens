import { el } from "./dom.js";
import { classify, formatDate, formatNumber, humanizeKey, previewValue } from "./format.js";
import { join as pointerJoin } from "./pointer.js";
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

/**
 * Copy affordances for one value row.
 *
 * These are plain markup with no event listeners: a single delegated handler
 * reads `data-copy` and walks up to the nearest `data-pointer`. On a document
 * with tens of thousands of value rows, not attaching two closures per row is
 * the difference between this being free and being a memory problem.
 *
 * The value itself is not duplicated into the DOM either — it is resolved from
 * the parsed document by following the pointer, which is exactly what a JSON
 * Pointer is for.
 */
function rowActions(): HTMLElement {
  return el(
    "span",
    { class: "kv__actions" },
    el("button", {
      class: "act act--mini",
      type: "button",
      "data-copy": "path",
      title: "Copy JSON Pointer to this value",
      "aria-label": "Copy JSON Pointer to this value",
      text: "path",
    }),
    el("button", {
      class: "act act--mini",
      type: "button",
      "data-copy": "value",
      title: "Copy this value",
      "aria-label": "Copy this value",
      text: "value",
    }),
  );
}

/**
 * An object or array, as a disclosure with a one-line preview in the summary.
 *
 * `actions` go inside the summary rather than after the tree, so the buttons for
 * "this whole object" sit on the line that names it instead of drifting below
 * its children.
 */
function renderNested(
  value: JsonValue,
  depth: number,
  pointer: string,
  actions: HTMLElement | null,
): HTMLElement {
  const isArray = Array.isArray(value);
  const entries: [string, JsonValue][] = isArray
    ? (value as JsonValue[]).map((v, i) => [String(i), v])
    : Object.keys(value as JsonObject).map((k) => [k, (value as JsonObject)[k]!]);

  if (entries.length === 0) {
    return el(
      "span",
      { class: "v v--empty-wrap" },
      el("span", { class: "v v--empty", text: isArray ? "empty array" : "empty object" }),
      actions,
    );
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
      actions,
    ),
    renderEntries(entries, depth + 1, isArray, pointer),
  );

  return details;
}

function renderEntries(
  entries: [string, JsonValue][],
  depth: number,
  numericKeys: boolean,
  pointer: string,
): HTMLElement {
  const list = el("dl", { class: "kv" });

  for (const [key, value] of entries) {
    const kind = classify(value);
    const isNested = kind === "object" || kind === "array";
    const childPointer = pointerJoin(pointer, key);

    list.append(
      el(
        "dt",
        { class: numericKeys ? "kv__key kv__key--index" : "kv__key", title: childPointer },
        numericKeys ? key : humanizeKey(key),
        // The humanised key is what you read; the raw key is what you grep for
        // and what appears in the payload, so both are always shown.
        !numericKeys && humanizeKey(key) !== key
          ? el("span", { class: "kv__raw-key", text: key })
          : null,
      ),
      el(
        "dd",
        {
          class: `kv__val${isNested ? " kv__val--nested" : ""}`,
          "data-pointer": childPointer,
        },
        isNested
          ? renderNested(value, depth, childPointer, rowActions())
          : renderScalar(value),
        isNested ? null : rowActions(),
      ),
    );
  }

  return list;
}

/** A `attributes` / `meta` / `links` block. */
export function renderObjectBlock(
  title: string,
  value: JsonObject,
  pointer: string,
  modifier = "",
): HTMLElement {
  const keys = Object.keys(value);
  const section = el("div", { class: `block${modifier ? ` block--${modifier}` : ""}` });

  section.append(
    el(
      "h4",
      { class: "block__title" },
      title,
      el("span", { class: "block__count", text: String(keys.length) }),
      el("code", { class: "block__pointer", text: pointer, title: "JSON Pointer to this block" }),
    ),
  );

  if (keys.length === 0) {
    section.append(el("p", { class: "block__empty", text: `No ${title.toLowerCase()}.` }));
    return section;
  }

  section.append(renderEntries(keys.map((k) => [k, value[k]!]), 0, false, pointer));
  return section;
}

export { renderScalar };
