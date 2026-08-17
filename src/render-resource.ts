import { el, escapeHtml } from "./dom.js";
import { humanizeKey, previewValue, summaryAttribute } from "./format.js";
import { domId, resourceHref, resourceKey, typeHue, typeSigil } from "./ident.js";
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
    (resolved ? "" : `<span class="chip__absent">not in document</span>`);

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
        title: `No resource with type "${type}" and id "${id}" appears in this document`,
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
    tags.push(`<span class="tag tag--primary" title="Part of the document's primary data">primary</span>`);
  }
  if (resource.relationships.length) {
    tags.push(
      `<span class="tag" title="${resource.relationships.length} relationship${resource.relationships.length === 1 ? "" : "s"}">${resource.relationships.length} rel</span>`,
    );
  }
  if (resource.danglingCount) {
    tags.push(
      `<span class="tag tag--absent" title="${resource.danglingCount} pointer${resource.danglingCount === 1 ? "" : "s"} on this resource resolve to nothing in this document">${resource.danglingCount} unresolved</span>`,
    );
  }
  if (resource.duplicated) {
    tags.push(
      `<span class="tag tag--dupe" title="This type/id appeared more than once in the document; the occurrences were merged">duplicated</span>`,
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
    : `<span class="res__sum res__sum--none">${resource.attributes ? "no summary attribute" : "no attributes"}</span>`;

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
      text: `Show ${remaining} more`,
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
  switch (rel.kind) {
    case "to-one":
      return "to-one";
    case "to-many":
      return `to-many · ${rel.targets.length}`;
    case "empty":
      return "to-one · null";
    case "no-linkage":
      return "no linkage";
  }
}

function renderRelationships(resource: Resource, index: DocumentIndex): HTMLElement {
  const block = el("div", { class: "block block--rels" });
  block.append(
    el(
      "h4",
      { class: "block__title" },
      "Relationships",
      el("span", { class: "block__count", text: String(resource.relationships.length) }),
    ),
  );

  if (!resource.relationships.length) {
    block.append(el("p", { class: "block__empty", text: "No relationships." }));
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
          text: "Linkage is explicitly null — related to nothing.",
        }),
      );
    } else if (rel.kind === "no-linkage") {
      item.append(
        el("p", {
          class: "rel__note",
          text: "No linkage data. The server did not say what this relates to; fetch the related link to find out.",
        }),
      );
    } else {
      item.append(relationshipTargets(rel, index));
    }

    if (rel.links) item.append(renderObjectBlock("Links", rel.links, "sub"));
    if (rel.meta) item.append(renderObjectBlock("Meta", rel.meta, "sub"));

    block.append(item);
  }

  return block;
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
      el("a", {
        class: "res__permalink",
        href: resourceHref(resource.type, resource.id),
        title: "Link to this resource",
        text: "permalink",
      }),
    ),
  );

  body.append(renderObjectBlock("Attributes", resource.attributes ?? {}));
  body.append(renderRelationships(resource, index));
  if (resource.links) body.append(renderObjectBlock("Links", resource.links));
  if (resource.meta) body.append(renderObjectBlock("Meta", resource.meta));

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
