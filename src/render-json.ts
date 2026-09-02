/**
 * Rendering a plain-JSON document's body: the anchored collection sections
 * the rail jumps to, and everything else the document carries at its top
 * level. See `docs/task-specs/T1.md`.
 *
 * This module owns the *shape* of that layout — which pointers get their own
 * section, which stay inline, which pointer a reference should land on — and
 * delegates every actual value to `render-value.ts`'s existing tree renderer
 * via `TreeAnnotations`. It does not build HTML strings or know what an
 * object's keys mean; `render-value.ts` still does all of that, unchanged for
 * the JSON:API path and reused rather than duplicated here.
 *
 * ## Why a collection gets its own section, and a nested one does not
 *
 * A **top-level** collection (`JsonCollection.topLevel`) — one with no
 * collection between it and the root — is pulled out into its own `.group`
 * section, the same element the rail's solo filter already knows how to
 * show and hide; see `render-document.ts#renderRail`'s header for why that
 * reuse needs no new filter code. Pulling it out means the generic "leftover"
 * tree must not *also* render it inline, which would mint its members'
 * anchor ids twice — so `buildAnnotations` tells `render-value.ts` to render
 * a short cross-reference at that pointer instead (`NestedAnnotation`'s
 * `collapsed` kind).
 *
 * A collection nested inside another collection's member has nowhere of its
 * own to be pulled out to that would not itself need the same treatment
 * recursively, and the spec does not ask for that: it asks for the rail to
 * list collections, not for every array in the document to become a rail
 * row. So a nested collection renders in place, through the ordinary
 * recursive tree — it still gets an anchor on itself and on each of its
 * members, which is what lets a reference inside it resolve.
 */

import { el } from "./dom.js";
import { t } from "./i18n/index.js";
import { nodeDomId, nodeHref } from "./ident.js";
import { EAGER_BODY_LIMIT } from "./render-document.js";
import { resolve as resolvePointer } from "./pointer.js";
import { renderObjectBlock, renderTopLevelValue } from "./render-value.js";
import type { NestedAnnotation, ScalarAnnotation, TreeAnnotations } from "./render-value.js";
import type { JsonCollection, JsonIndex, JsonObject, JsonValue } from "./types.js";

function isPlainObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turn a `JsonIndex` into the lookups `render-value.ts` needs, without that
 * module ever having to know what a collection or an identity is. Built once
 * per document and shared between `renderJsonGroups` and `renderJsonLeftover`
 * so a pointer resolves to the same anchor id wherever it is asked about.
 */
export function buildAnnotations(index: JsonIndex): TreeAnnotations {
  const topLevelByPointer = new Map(
    index.collections.filter((c) => c.topLevel).map((c) => [c.pointer, c] as const),
  );

  const anchorPointers = new Set<string>();
  for (const collection of index.collections) {
    anchorPointers.add(collection.pointer);
    for (const member of collection.memberPointers) anchorPointers.add(member);
  }
  for (const pointer of index.definitionAt.keys()) anchorPointers.add(pointer);

  return {
    nestedAt(pointer: string): NestedAnnotation | null {
      const collection = topLevelByPointer.get(pointer);
      if (collection) {
        return {
          kind: "collapsed",
          href: nodeHref(pointer),
          text: t().identity.seeCollection(collectionLabel(collection), collection.memberPointers.length),
        };
      }
      if (anchorPointers.has(pointer)) return { kind: "anchor", id: nodeDomId(pointer) };
      return null;
    },
    scalarAt(pointer: string): ScalarAnnotation | null {
      const reference = index.referenceAt.get(pointer);
      if (!reference) return null;
      switch (reference.resolution) {
        case "resolved":
          return { kind: "resolved", href: nodeHref(reference.targetPointer) };
        case "ambiguous":
          return { kind: "ambiguous", count: reference.candidates };
        case "dangling":
          return { kind: "dangling" };
      }
    },
  };
}

function collectionLabel(collection: JsonCollection): string {
  return collection.label || t().shape.rootCollectionLabel;
}

/** One top-level collection, as a `.group` section — the same element JSON:API's groups use, so the rail's solo filter needs no changes to work here. */
function renderJsonGroup(collection: JsonCollection, root: JsonValue, annotations: TreeAnnotations): HTMLElement {
  const label = collectionLabel(collection);
  const section = el("section", {
    class: "group",
    id: collection.domId,
    "data-type": collection.pointer,
    "data-hue": collection.hue,
  });

  section.append(
    el(
      "header",
      { class: "group__head" },
      el(
        "h2",
        { class: "group__title" },
        el("b", { class: "group__sigil", text: collection.sigil }),
        el("span", { class: "group__name", text: label }),
        el("span", { class: "group__count", text: t().num(collection.memberPointers.length) }),
      ),
    ),
  );

  const rows = el("div", { class: "group__rows" });
  // Unlike the JSON:API path, a member's row *is* its full detail — there is
  // no separate lazy body to defer, since "reuse render-value.ts as it is"
  // means no second, collapsed-by-default row shape exists to build instead.
  // Capping at the same limit that gates JSON:API's eager bodies keeps a
  // collection with an extreme member count from building all of them at
  // once; see the evidence file for what this does and does not cover.
  const shown = collection.memberPointers.slice(0, EAGER_BODY_LIMIT);
  for (const pointer of shown) {
    const value = resolvePointer(root, pointer);
    // Every member pointer comes from the array's own length, so this should
    // always resolve — the check is defensive, not an expected path.
    if (value === undefined) continue;
    rows.append(
      el("div", { class: "node-row" }, renderTopLevelValue(value as JsonValue, pointer, annotations)),
    );
  }
  if (collection.memberPointers.length > shown.length) {
    rows.append(
      el("p", {
        class: "group__truncated-note",
        text: t().shape.tooManyMembers(collection.memberPointers.length - shown.length),
      }),
    );
  }
  section.append(rows);

  return section;
}

/** Every top-level collection, largest first — the same ordering `parse.ts#orderGroups` gives JSON:API's groups. */
export function renderJsonGroups(index: JsonIndex, annotations: TreeAnnotations): HTMLElement {
  const container = el("div", { class: "groups" });
  const topLevel = index.collections
    .filter((c) => c.topLevel)
    .sort((a, b) => b.memberPointers.length - a.memberPointers.length);

  for (const collection of topLevel) {
    container.append(renderJsonGroup(collection, index.root, annotations));
  }

  return container;
}

/**
 * What the document carries outside its collections: everything when there
 * are none, the rest of the object when there are some, `null` when a
 * top-level collection already *is* the whole document (a bare array) or the
 * root is an empty object — the overview's own empty note covers that case.
 */
export function renderJsonLeftover(index: JsonIndex, annotations: TreeAnnotations): HTMLElement | null {
  const root = index.root;

  if (Array.isArray(root)) return null;

  if (isPlainObject(root)) {
    if (Object.keys(root).length === 0) return null;
    return renderObjectBlock(t().shape.topLevelMembers, root, "", "", annotations);
  }

  const wrap = el("div", { class: "block block--root-scalar" });
  wrap.append(renderTopLevelValue(root, "", annotations));
  return wrap;
}
