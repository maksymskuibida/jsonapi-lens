import { el } from "./dom.js";
import { classify, formatDate, formatNumber, humanizeKey, previewValue } from "./format.js";
import { join as pointerJoin } from "./pointer.js";
import type { JsonObject, JsonValue } from "./types.js";
import { t } from "./i18n/index.js";

/** Nested structures past this depth stay collapsed, to keep expansion cheap. */
const AUTO_OPEN_DEPTH = 1;

/**
 * The one hook plain-JSON rendering needs into this otherwise JSON:API-and-
 * plain-JSON-agnostic tree — see `docs/task-specs/T1.md`'s "reuses
 * render-value.ts as it is". Every function below takes this as a trailing
 * optional parameter that every existing call site simply omits, so the
 * JSON:API render path — `render-resource.ts#buildResourceBody`'s
 * `attributes`/`meta`/`links`/`jsonapi` blocks — is untouched: `undefined`
 * flows through every `?.` below to the same output as before this existed.
 *
 * `render-json.ts` is the one place that builds a real `TreeAnnotations`, from
 * a `JsonIndex`'s `collections`/`referenceAt`/`definitionAt`. This module
 * only calls it — it stays ignorant of what a "collection" or an "identity"
 * is, which is what keeps this a single tree renderer rather than a second
 * one that happens to look similar.
 */
export interface TreeAnnotations {
  /** Called before rendering a nested (object/array) value's container, keyed by its own pointer. */
  nestedAt(pointer: string): NestedAnnotation | null;
  /** Called before rendering a scalar value, keyed by its own pointer. */
  scalarAt(pointer: string): ScalarAnnotation | null;
}

export type NestedAnnotation =
  | { kind: "anchor"; id: string }
  | { kind: "collapsed"; href: string; text: string };

export type ScalarAnnotation =
  | { kind: "resolved"; href: string }
  | { kind: "ambiguous"; count: number }
  | { kind: "dangling" };

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
 * A scalar that the identity graph has something to say about: a resolved
 * reference renders as a real link to its definition; ambiguous and dangling
 * render as text, deliberately not a link — "more than one candidate
 * definition renders as ambiguous… never resolved by picking the first."
 * Overrides `renderScalar`'s usual classification (date, uuid, url…)
 * entirely, since the identity reading is the more specific fact about this
 * value once it applies.
 */
function renderAnnotatedScalar(value: JsonValue, annotation: ScalarAnnotation): HTMLElement {
  const text = String(value);
  switch (annotation.kind) {
    case "resolved":
      return el("a", { class: "v v--ref", href: annotation.href, text });
    case "ambiguous":
      return el("span", {
        class: "v v--ref v--ref-ambiguous",
        title: t().identity.ambiguousTitle(annotation.count),
        text,
      });
    case "dangling":
      return el("span", { class: "v v--ref v--ref-dangling", title: t().identity.danglingTitle, text });
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
export function rowActions(): HTMLElement {
  return el(
    "span",
    { class: "kv__actions" },
    el("button", {
      class: "act act--mini",
      type: "button",
      "data-copy": "path",
      title: t().value.copyPointerTitle,
      "aria-label": "Copy JSON Pointer to this value",
      text: t().value.copyPointerLabel,
    }),
    el("button", {
      class: "act act--mini",
      type: "button",
      "data-copy": "value",
      title: t().value.copyValueTitle,
      "aria-label": "Copy this value",
      text: t().value.copyValueLabel,
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
  annotations?: TreeAnnotations,
): HTMLElement {
  const annotation = annotations?.nestedAt(pointer) ?? null;

  if (annotation?.kind === "collapsed") {
    // A collection found elsewhere in the tree renders its own section; this
    // pointer just points there, so it is not expanded here too — which
    // would otherwise mint the same anchor id twice.
    return el(
      "span",
      { class: "v v--collapsed-wrap" },
      el("a", { class: "v v--collapsed-ref", href: annotation.href, text: annotation.text }),
      actions,
    );
  }

  const anchorId = annotation?.kind === "anchor" ? annotation.id : undefined;
  const isArray = Array.isArray(value);
  const entries: [string, JsonValue][] = isArray
    ? (value as JsonValue[]).map((v, i) => [String(i), v])
    : Object.keys(value as JsonObject).map((k) => [k, (value as JsonObject)[k]!]);

  if (entries.length === 0) {
    return el(
      "span",
      { class: "v v--empty-wrap", id: anchorId },
      el("span", {
        class: "v v--empty",
        text: isArray ? t().value.emptyArray : t().value.emptyObject,
      }),
      actions,
    );
  }

  const details = el("details", { class: "tree", open: depth < AUTO_OPEN_DEPTH, id: anchorId });
  const label = isArray ? t().value.items(entries.length) : t().value.keys(entries.length);

  details.append(
    el(
      "summary",
      { class: "tree__summary" },
      el("span", { class: "tree__marker", text: isArray ? "[ ]" : "{ }" }),
      el("span", { class: "tree__count", text: label }),
      el("span", { class: "tree__preview", text: previewValue(value) }),
      actions,
    ),
    renderEntries(entries, depth + 1, isArray, pointer, annotations),
  );

  return details;
}

function renderEntries(
  entries: [string, JsonValue][],
  depth: number,
  numericKeys: boolean,
  pointer: string,
  annotations?: TreeAnnotations,
): HTMLElement {
  const list = el("dl", { class: "kv" });

  for (const [key, value] of entries) {
    const kind = classify(value);
    const isNested = kind === "object" || kind === "array";
    const childPointer = pointerJoin(pointer, key);
    const scalarAnnotation = isNested ? null : (annotations?.scalarAt(childPointer) ?? null);

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
          ? renderNested(value, depth, childPointer, rowActions(), annotations)
          : scalarAnnotation
            ? renderAnnotatedScalar(value, scalarAnnotation)
            : renderScalar(value),
        isNested ? null : rowActions(),
      ),
    );
  }

  return list;
}

/**
 * An `attributes` / `meta` / `links` block.
 *
 * `label` carries both the heading and the sentence for an empty block, because
 * "No attributes." cannot be derived from "Attributes" by lower-casing it in a
 * language that inflects — which is what this used to do.
 */
export function renderObjectBlock(
  label: { title: string; empty: string },
  value: JsonObject,
  pointer: string,
  modifier = "",
  annotations?: TreeAnnotations,
): HTMLElement {
  const keys = Object.keys(value);
  const section = el("div", { class: `block${modifier ? ` block--${modifier}` : ""}` });

  section.append(
    el(
      "h4",
      { class: "block__title" },
      label.title,
      el("span", { class: "block__count", text: t().num(keys.length) }),
      el("code", { class: "block__pointer", text: pointer, title: t().value.pointerTitle }),
    ),
  );

  if (keys.length === 0) {
    section.append(el("p", { class: "block__empty", text: label.empty }));
    return section;
  }

  section.append(renderEntries(keys.map((k) => [k, value[k]!]), 0, false, pointer, annotations));
  return section;
}

/**
 * A value with no enclosing `dt`/`dd` row of its own — a collection member,
 * most often, or a bare-scalar document's one value. Handles both nested and
 * scalar shapes, and — since a collection member can itself be an identity
 * definition, or (a scalar member of a bare array of UUIDs) a reference —
 * carries its own anchor id when `annotations` says it needs one, which a
 * plain `renderScalar` result has nowhere to put.
 */
export function renderTopLevelValue(
  value: JsonValue,
  pointer: string,
  annotations?: TreeAnnotations,
): HTMLElement {
  const kind = classify(value);
  if (kind === "object" || kind === "array") {
    return renderNested(value, 0, pointer, rowActions(), annotations);
  }

  const anchor = annotations?.nestedAt(pointer) ?? null;
  const scalarAnnotation = annotations?.scalarAt(pointer) ?? null;
  const inner = scalarAnnotation ? renderAnnotatedScalar(value, scalarAnnotation) : renderScalar(value);

  const wrap = el("span", {
    class: "v v--top-level",
    id: anchor?.kind === "anchor" ? anchor.id : undefined,
  });
  wrap.append(inner, rowActions());
  return wrap;
}

export { renderScalar };
