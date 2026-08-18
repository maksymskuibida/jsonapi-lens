import { el, escapeHtml } from "./dom.js";
import { humanizeKey, previewValue, summaryAttribute } from "./format.js";
import { t } from "./i18n/index.js";
import { domId, resourceHref, resourceKey, typeHue, typeSigil } from "./ident.js";
import { referencesTo } from "./parse.js";
import { join as pointerJoin } from "./pointer.js";
import { renderObjectBlock, renderScalar } from "./render-value.js";
import type { DocumentIndex, RelationshipEntry, Resource } from "./types.js";

/**
 * Targets rendered per to-many relationship before the rest go behind a button.
 * A single resource with 4,000 pointers should not cost 4,000 nodes on expand.
 */
const TARGET_CHUNK = 50;

/* ------------------------------------------------------------------ *
 * The identity chip
 *
 * Every resource identity in the app — a section heading, a relationship
 * pointer, a dangling pointer, an entry in the jump list — is this one device:
 * a type sigil, then the type, then the id in mono. It is the thing the whole
 * tool is about, so it gets one definition and one look, and the only thing
 * that varies is whether the pointer lands (a link) or does not (struck
 * through, and labelled).
 * ------------------------------------------------------------------ */

interface ChipOptions {
  /** Omit the type name — used inside a type group, where it is implied. */
  implyType?: boolean;
  extraClass?: string;
}

/** String form, for the bulk row path. */
function chipHtml(type: string, id: string, resolved: boolean, options: ChipOptions = {}): string {
  const classes = ["chip", resolved ? "chip--link" : "chip--absent", options.extraClass]
    .filter(Boolean)
    .join(" ");
  const inner =
    `<b class="chip__sigil">${escapeHtml(typeSigil(type))}</b>` +
    (options.implyType ? "" : `<span class="chip__type">${escapeHtml(type)}</span>`) +
    `<span class="chip__id">${escapeHtml(id)}</span>` +
    (resolved ? "" : `<span class="chip__absent">${escapeHtml(t().resource.notInDocument)}</span>`);

  // `domId` output is `[A-Za-z0-9_]` by construction, so it is safe unquoted —
  // it is still emitted inside quotes for uniformity with the escaped values.
  return resolved
    ? `<a class="${classes}" data-hue="${typeHue(type)}" href="${resourceHref(type, id)}">${inner}</a>`
    : `<span class="${classes}" data-hue="${typeHue(type)}" title="No resource with type &quot;${escapeHtml(type)}&quot; and id &quot;${escapeHtml(id)}&quot; appears in this document">${inner}</span>`;
}

/** DOM form, for the detail path. */
export function chip(
  type: string,
  id: string,
  resolved: boolean,
  options: ChipOptions = {},
): HTMLElement {
  const classes = ["chip", resolved ? "chip--link" : "chip--absent", options.extraClass]
    .filter(Boolean)
    .join(" ");

  const node = resolved
    ? el("a", { class: classes, href: resourceHref(type, id) })
    : el("span", {
        class: classes,
        title: t().resource.absentChipTitle(type, id),
      });

  node.dataset["hue"] = String(typeHue(type));
  node.append(el("b", { class: "chip__sigil", text: typeSigil(type) }));
  if (!options.implyType) node.append(el("span", { class: "chip__type", text: type }));
  node.append(el("span", { class: "chip__id", text: id }));
  if (!resolved) node.append(el("span", { class: "chip__absent", text: "not in document" }));

  return node;
}

/* ------------------------------------------------------------------ *
 * Collapsed rows
 * ------------------------------------------------------------------ */

function tagsHtml(resource: Resource): string {
  const tags: string[] = [];

  if (resource.origin === "data") {
    tags.push(
      `<span class="tag tag--primary" title="${escapeHtml(t().resource.primaryTagTitle)}">${escapeHtml(t().resource.primaryTag)}</span>`,
    );
  }
  if (resource.relationships.length) {
    tags.push(
      `<span class="tag" title="${escapeHtml(t().resource.relTagTitle(resource.relationships.length))}">${escapeHtml(t().resource.relTag(resource.relationships.length))}</span>`,
    );
  }
  if (resource.danglingCount) {
    tags.push(
      `<span class="tag tag--absent" title="${escapeHtml(t().resource.unresolvedTagTitle(resource.danglingCount))}">${escapeHtml(t().resource.unresolvedTag(resource.danglingCount))}</span>`,
    );
  }
  if (resource.duplicated) {
    tags.push(
      `<span class="tag tag--dupe" title="${escapeHtml(t().resource.duplicatedTagTitle)}">${escapeHtml(t().resource.duplicatedTag)}</span>`,
    );
  }

  return tags.join("");
}

/**
 * One resource, as an HTML string.
 *
 * `content-visibility: auto` lives on the `<section>`, so the row is a real DOM
 * node with a real id — the anchor target and browser find both still work —
 * while layout and paint are skipped while it is off-screen.
 */
function rowHtml(resource: Resource): string {
  const summary = summaryAttribute(resource.attributes);
  const summaryHtml = summary
    ? `<span class="res__sum"><span class="res__sum-key">${escapeHtml(humanizeKey(summary.key))}</span>` +
      `<span class="res__sum-val">${escapeHtml(previewValue(summary.value, 90))}</span></span>`
    : `<span class="res__sum res__sum--none">${escapeHtml(
        resource.attributes ? t().resource.noSummaryAttribute : t().resource.noAttributes,
      )}</span>`;

  return (
    `<section class="res" id="${domId(resource.type, resource.id)}" data-type="${escapeHtml(resource.type)}">` +
    `<details class="res__d">` +
    `<summary class="res__row">` +
    `<span class="res__caret" aria-hidden="true"></span>` +
    chipHtml(resource.type, resource.id, true, { implyType: true, extraClass: "chip--self" }) +
    summaryHtml +
    `<span class="res__tags">${tagsHtml(resource)}</span>` +
    `</summary>` +
    // `data-pending` means "body not built yet" — it is set on every row, and
    // cleared by whoever fills it first. For a small document that is the eager
    // pass right after render; for a large one it is the `toggle` handler.
    `<div class="res__body" data-pending="1"></div>` +
    `</details></section>`
  );
}

/* ------------------------------------------------------------------ *
 * Expanded detail
 * ------------------------------------------------------------------ */

function relationshipTargets(rel: RelationshipEntry, index: DocumentIndex): HTMLElement {
  const list = el("ul", { class: "rel__targets" });

  const append = (from: number, to: number): void => {
    for (let i = from; i < to; i++) {
      const target = rel.targets[i]!;
      const resolved = index.byKey.has(resourceKey(target.type, target.id));
      list.append(el("li", { class: "rel__target" }, chip(target.type, target.id, resolved)));
    }
  };

  const shown = Math.min(rel.targets.length, TARGET_CHUNK);
  append(0, shown);

  if (rel.targets.length > shown) {
    const remaining = rel.targets.length - shown;
    const more = el("button", {
      class: "rel__more",
      type: "button",
      text: t().resource.showMore(remaining),
    });
    more.addEventListener("click", () => {
      more.remove();
      append(shown, rel.targets.length);
    });
    list.append(el("li", { class: "rel__target rel__target--more" }, more));
  }

  return list;
}

function relationshipCardinality(rel: RelationshipEntry): string {
  const m = t().relationships;
  switch (rel.kind) {
    case "to-one":
      return m.toOne;
    case "to-many":
      return m.toMany(rel.targets.length);
    case "empty":
      return m.toOneNull;
    case "no-linkage":
      return m.noLinkage;
  }
}

function renderRelationships(resource: Resource, index: DocumentIndex): HTMLElement {
  const block = el("div", { class: "block block--rels" });
  block.append(
    el(
      "h4",
      { class: "block__title" },
      t().relationships.title,
      el("span", { class: "block__count", text: t().num(resource.relationships.length) }),
    ),
  );

  if (!resource.relationships.length) {
    block.append(el("p", { class: "block__empty", text: t().relationships.empty }));
    return block;
  }

  for (const rel of resource.relationships) {
    const item = el(
      "div",
      { class: `rel${rel.targets.length === 0 ? " rel--empty" : ""}` },
      el(
        "div",
        { class: "rel__head" },
        el("span", { class: "rel__name", text: rel.name }),
        el("span", { class: "rel__card", text: relationshipCardinality(rel) }),
      ),
    );

    if (rel.kind === "empty") {
      item.append(
        el("p", {
          class: "rel__note",
          text: t().relationships.nullNote,
        }),
      );
    } else if (rel.kind === "no-linkage") {
      item.append(
        el("p", {
          class: "rel__note",
          text: t().relationships.noLinkageNote,
        }),
      );
    } else {
      item.append(relationshipTargets(rel, index));
    }

    const relPointer = pointerJoin(resource.pointer, "relationships", rel.name);
    if (rel.links) {
      item.append(renderObjectBlock(t().block.links, rel.links, pointerJoin(relPointer, "links"), "sub"));
    }
    if (rel.meta) {
      item.append(renderObjectBlock(t().block.meta, rel.meta, pointerJoin(relPointer, "meta"), "sub"));
    }

    block.append(item);
  }

  return block;
}

/**
 * Which resources point at this one.
 *
 * JSON:API only encodes pointers in one direction: a comment names its author,
 * but a person has no idea which comments are theirs. Answering that by hand
 * means reading every resource in the document, which is exactly the work this
 * tool exists to remove — so it is worth a block of its own.
 */
function renderReferencedBy(resource: Resource, index: DocumentIndex): HTMLElement {
  const block = el("div", { class: "block block--rev" });
  const references = referencesTo(index, resource.type, resource.id);

  if (references === null) {
    block.append(
      el("h4", { class: "block__title" }, t().referencedBy.title),
      el("p", { class: "block__empty", text: t().referencedBy.tooMany }),
    );
    return block;
  }

  block.append(
    el(
      "h4",
      { class: "block__title" },
      t().referencedBy.title,
      el("span", { class: "block__count", text: t().num(references.length) }),
    ),
  );

  if (!references.length) {
    block.append(
      el("p", {
        class: "block__empty",
        text: t().referencedBy.none,
      }),
    );
    return block;
  }

  // Group by relationship name so "12 segments via origin_station" reads as one
  // fact rather than twelve.
  const byRelationship = new Map<string, typeof references>();
  for (const reference of references) {
    const bucket = byRelationship.get(reference.relationship);
    if (bucket) bucket.push(reference);
    else byRelationship.set(reference.relationship, [reference]);
  }

  for (const [name, group] of byRelationship) {
    const item = el(
      "div",
      { class: "rel" },
      el(
        "div",
        { class: "rel__head" },
        el("span", { class: "rel__name", text: name }),
        el("span", {
          class: "rel__card",
          text: t().referencedBy.inbound(group.length),
        }),
      ),
    );

    const list = el("ul", { class: "rel__targets" });
    const shown = Math.min(group.length, TARGET_CHUNK);
    for (let i = 0; i < shown; i++) {
      const from = group[i]!.from;
      list.append(el("li", { class: "rel__target" }, chip(from.type, from.id, true)));
    }
    if (group.length > shown) {
      const remaining = group.length - shown;
      const more = el("button", {
        class: "rel__more",
        type: "button",
        text: t().resource.showMore(remaining),
      });
      more.addEventListener("click", () => {
        more.remove();
        for (let i = shown; i < group.length; i++) {
          const from = group[i]!.from;
          list.append(el("li", { class: "rel__target" }, chip(from.type, from.id, true)));
        }
      });
      list.append(el("li", { class: "rel__target rel__target--more" }, more));
    }

    item.append(list);
    block.append(item);
  }

  return block;
}

/**
 * Object-level actions.
 *
 * Like the value-row actions, these carry no listeners: a single delegated
 * handler reads `data-object-action` and finds the resource from the enclosing
 * section's id. Nothing here needs to know which resource it belongs to.
 */
function objectActions(resource: Resource): HTMLElement {
  const button = (action: string, label: string, title: string, extra = ""): HTMLElement =>
    el("button", {
      class: `act${extra ? ` ${extra}` : ""}`,
      type: "button",
      "data-object-action": action,
      title,
      "aria-label": title,
      text: label,
    });

  return el(
    "div",
    { class: "res__actions" },
    button("raw", "raw", "Show this resource as raw JSON", "act--accent"),
    button("copy-object", "copy", "Copy this resource as JSON"),
    button("copy-pointer", "path", `Copy the JSON Pointer to this resource (${resource.pointer})`),
    button("copy-link", "link", "Copy a deep link to this resource"),
  );
}

/** Everything shown when a resource is expanded. */
export function buildResourceBody(resource: Resource, index: DocumentIndex): DocumentFragment {
  const body = document.createDocumentFragment();

  body.append(
    el(
      "div",
      { class: "res__identity" },
      el(
        "div",
        { class: "res__identity-pair" },
        el("span", { class: "res__identity-label", text: "type" }),
        el("code", { class: "res__identity-value", text: resource.type }),
      ),
      el(
        "div",
        { class: "res__identity-pair" },
        el("span", { class: "res__identity-label", text: "id" }),
        el("code", { class: "res__identity-value", text: resource.id }),
      ),
      el(
        "div",
        { class: "res__identity-pair res__identity-pair--pointer" },
        el("span", { class: "res__identity-label", text: "at" }),
        el("code", { class: "res__identity-value", text: resource.pointer }),
      ),
      objectActions(resource),
    ),
  );

  body.append(
    renderObjectBlock(
      t().block.attributes,
      resource.attributes ?? {},
      pointerJoin(resource.pointer, "attributes"),
    ),
  );
  body.append(renderRelationships(resource, index));
  body.append(renderReferencedBy(resource, index));
  if (resource.links) {
    body.append(
      renderObjectBlock(t().block.links, resource.links, pointerJoin(resource.pointer, "links")),
    );
  }
  if (resource.meta) {
    body.append(
      renderObjectBlock(t().block.meta, resource.meta, pointerJoin(resource.pointer, "meta")),
    );
  }

  return body;
}

/**
 * All rows for a type group, as one HTML string.
 *
 * Built as a string and parsed once rather than through tens of thousands of
 * `createElement` calls; see `escapeHtml` for why that is safe.
 */
export function groupRowsHtml(resources: Resource[]): string {
  const parts: string[] = [];
  for (const resource of resources) parts.push(rowHtml(resource));
  return parts.join("");
}

export { renderScalar };
