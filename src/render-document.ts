import { el, escapeHtml } from "./dom.js";
import { formatBytes, formatDuration } from "./format.js";
import { encodeSegment, resourceKey } from "./ident.js";
import { chip, groupRowsHtml } from "./render-resource.js";
import { renderObjectBlock } from "./render-value.js";
import type { DocumentIndex, JsonApiError, TypeGroup } from "./types.js";

/**
 * Above this many resources, attribute detail is built on expand rather than
 * up front. The ceiling is about node count: eager bodies for a 50k-resource
 * document would be millions of nodes, and no amount of instant-expand is worth
 * a first render measured in minutes.
 */
export const EAGER_BODY_LIMIT = 2000;

export function groupDomId(type: string): string {
  return "g_" + encodeSegment(type);
}

function count(n: number): string {
  return n.toLocaleString();
}

/* ------------------------------------------------------------------ *
 * Jump rail
 * ------------------------------------------------------------------ */

export function renderRail(index: DocumentIndex): HTMLElement {
  const rail = el("nav", { class: "rail", "aria-label": "Document contents" });
  const max = index.groups.reduce((m, g) => Math.max(m, g.resources.length), 1);

  rail.append(
    el(
      "div",
      { class: "rail__head" },
      el("h2", { class: "rail__title", text: "Types" }),
      el("span", { class: "rail__title-count", text: count(index.groups.length) }),
    ),
  );

  if (index.groups.length > 8) {
    rail.append(
      el("input", {
        class: "rail__search",
        type: "search",
        id: "rail-search",
        placeholder: "Narrow this list",
        "aria-label": "Narrow the type list",
        autocomplete: "off",
        spellcheck: false,
      }),
    );
  }

  const list = el("ol", { class: "rail__types" });

  for (const group of index.groups) {
    const share = Math.max(2, Math.round((group.resources.length / max) * 100));
    const isPrimary = index.primary.some((p) => p.type === group.type);

    const row = el("li", { class: "railrow", "data-type": group.type });
    row.append(
      el(
        "a",
        {
          class: "railrow__link",
          href: "#" + groupDomId(group.type),
          "data-hue": group.hue,
          title: `Jump to ${group.type}`,
        },
        el("b", { class: "railrow__sigil", text: group.sigil }),
        el(
          "span",
          { class: "railrow__body" },
          el(
            "span",
            { class: "railrow__name-line" },
            el("span", { class: "railrow__name", text: group.type }),
            isPrimary && el("span", { class: "railrow__primary", title: "In primary data", text: "•" }),
            el("span", { class: "railrow__count", text: count(group.resources.length) }),
          ),
          // A proportion bar, because the shape of a payload — which type
          // dominates it — is usually the first thing worth knowing.
          el(
            "span",
            { class: "railrow__bar" },
            el("span", { class: "railrow__bar-fill", style: `--share:${share}%` }),
          ),
        ),
      ),
      el("button", {
        class: "railrow__solo",
        type: "button",
        "data-solo": group.type,
        title: `Show only ${group.type}`,
        "aria-pressed": "false",
        text: "only",
      }),
    );

    list.append(row);
  }

  rail.append(list);

  rail.append(
    el(
      "div",
      { class: "rail__foot" },
      el("button", {
        class: "rail__clear-filter",
        type: "button",
        id: "clear-filter",
        hidden: true,
        text: "Show all types",
      }),
    ),
  );

  return rail;
}

/* ------------------------------------------------------------------ *
 * Document header: what is in here
 * ------------------------------------------------------------------ */

interface DocumentStats {
  bytes: number;
  parseMs: number;
  renderMs?: number;
  label?: string;
  savedAt?: number;
}

function stat(label: string, value: string, modifier = ""): HTMLElement {
  return el(
    "div",
    { class: `stat${modifier ? ` stat--${modifier}` : ""}` },
    el("dt", { class: "stat__label", text: label }),
    el("dd", { class: "stat__value", text: value }),
  );
}

export function renderOverview(index: DocumentIndex, stats: DocumentStats): HTMLElement {
  const section = el("section", { class: "overview", id: "overview" });

  // JSON-ish shorthand keeps these short enough not to wrap, and reads the way
  // the document itself is written.
  const shape = index.primaryIsNull
    ? "data: null"
    : index.errors.length
      ? `errors[${count(index.errors.length)}]`
      : index.primary.length === 0
        ? index.counts.total > 0
          ? "included only"
          : "meta only"
        : index.primary.length === 1
          ? "data{1}"
          : `data[${count(index.primary.length)}]`;

  const list = el("dl", { class: "overview__stats" });
  list.append(
    stat("Shape", shape),
    stat("Resources", count(index.counts.total)),
    stat("Types", count(index.groups.length)),
    stat("Included", count(index.counts.fromIncluded)),
    stat("Relationships", count(index.counts.relationships)),
  );
  if (index.counts.danglingPointers) {
    list.append(
      stat(
        index.counts.danglingPointers === 1 ? "Unresolved pointer" : "Unresolved pointers",
        count(index.counts.danglingPointers),
        "absent",
      ),
    );
  }
  if (index.counts.duplicates) {
    list.append(stat("Duplicate identities", count(index.counts.duplicates), "warn"));
  }
  list.append(
    stat("Size", formatBytes(stats.bytes)),
    stat("Indexed in", formatDuration(stats.parseMs)),
  );

  section.append(list);

  if (index.primaryIsNull) {
    section.append(
      el("p", {
        class: "overview__note",
        text: "Primary data is explicitly null. That is a valid response for a to-one relationship that relates to nothing — not an error.",
      }),
    );
  }

  if (index.counts.total === 0 && !index.errors.length) {
    section.append(
      el("p", {
        class: "overview__note",
        text: "This document carries no resources. Only its top-level members are shown below.",
      }),
    );
  }

  if (index.counts.total > EAGER_BODY_LIMIT) {
    section.append(
      el(
        "p",
        { class: "overview__note overview__note--perf" },
        `Large document: all ${count(index.counts.total)} resources are on the page and every anchor resolves, but attribute detail is built when you expand a resource. Find-in-page reaches every summary row, including off-screen ones — to search inside attributes, expand the resources first.`,
      ),
    );
  }

  return section;
}

/* ------------------------------------------------------------------ *
 * Unresolved pointers — usually the thing being diagnosed
 * ------------------------------------------------------------------ */

export function renderDangling(index: DocumentIndex): HTMLElement | null {
  if (!index.dangling.length) return null;

  const details = el("details", { class: "absent-list", id: "unresolved" });
  details.append(
    el(
      "summary",
      { class: "absent-list__summary" },
      el("span", { class: "absent-list__icon", "aria-hidden": "true", text: "!" }),
      el(
        "span",
        null,
        `${count(index.dangling.length)} distinct ${index.dangling.length === 1 ? "pointer" : "pointers"} resolve to nothing in this document`,
      ),
      el("span", {
        class: "absent-list__hint",
        text: `${count(index.counts.danglingPointers)} total`,
      }),
    ),
  );

  const body = el("div", { class: "absent-list__body" });
  body.append(
    el("p", {
      class: "absent-list__note",
      text: "These are referenced by relationships but were not sent in data or included. Usually that means the request was missing an include parameter — or the server dropped something it should have sent.",
    }),
  );

  const list = el("ul", { class: "absent-list__items" });
  for (const target of index.dangling) {
    list.append(el("li", null, chip(target.type, target.id, false)));
  }
  body.append(list);
  details.append(body);

  return details;
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

function renderError(error: JsonApiError, position: number): HTMLElement {
  const item = el("li", { class: "err" });

  const head = el("div", { class: "err__head" });
  if (error.status) head.append(el("span", { class: "err__status", text: error.status }));
  if (error.code) head.append(el("code", { class: "err__code", text: error.code }));
  head.append(
    el("h3", {
      class: "err__title",
      text: error.title ?? `Error ${position + 1}`,
    }),
  );
  item.append(head);

  if (error.detail) item.append(el("p", { class: "err__detail", text: error.detail }));

  const pointer = error.source?.["pointer"];
  const parameter = error.source?.["parameter"];
  if (typeof pointer === "string" || typeof parameter === "string") {
    item.append(
      el(
        "p",
        { class: "err__source" },
        el("span", { class: "err__source-label", text: typeof pointer === "string" ? "pointer" : "parameter" }),
        el("code", { class: "err__source-value", text: String(pointer ?? parameter) }),
      ),
    );
  }

  const errorPointer = `/errors/${position}`;
  if (error.meta) item.append(renderObjectBlock("Meta", error.meta, `${errorPointer}/meta`, "sub"));
  if (error.links) item.append(renderObjectBlock("Links", error.links, `${errorPointer}/links`, "sub"));

  return item;
}

export function renderErrors(index: DocumentIndex): HTMLElement | null {
  if (!index.errors.length) return null;

  const section = el("section", { class: "errors", id: "errors" });
  section.append(
    el(
      "h2",
      { class: "errors__title" },
      "Errors",
      el("span", { class: "errors__count", text: count(index.errors.length) }),
    ),
  );

  const list = el("ol", { class: "errors__list" });
  index.errors.forEach((error, i) => list.append(renderError(error, i)));
  section.append(list);

  return section;
}

/* ------------------------------------------------------------------ *
 * Top-level members
 * ------------------------------------------------------------------ */

export function renderTopLevel(index: DocumentIndex): HTMLElement | null {
  if (!index.meta && !index.links && !index.jsonapi) return null;

  const details = el("details", { class: "toplevel", id: "top-level" });
  details.append(el("summary", { class: "toplevel__summary", text: "Top-level members" }));

  const body = el("div", { class: "toplevel__body" });
  if (index.jsonapi) body.append(renderObjectBlock("jsonapi", index.jsonapi, "/jsonapi", "sub"));
  if (index.links) body.append(renderObjectBlock("Links", index.links, "/links", "sub"));
  if (index.meta) body.append(renderObjectBlock("Meta", index.meta, "/meta", "sub"));
  details.append(body);

  return details;
}

/* ------------------------------------------------------------------ *
 * Primary data pointer list
 * ------------------------------------------------------------------ */

export function renderPrimary(index: DocumentIndex): HTMLElement | null {
  if (index.primary.length === 0) return null;

  const section = el("section", { class: "primary" });
  section.append(
    el(
      "h2",
      { class: "primary__title" },
      "Primary data",
      el("span", { class: "primary__count", text: count(index.primary.length) }),
    ),
  );

  const list = el("ul", { class: "primary__items" });
  const shown = index.primary.slice(0, 60);
  for (const identity of shown) {
    list.append(
      el(
        "li",
        null,
        chip(identity.type, identity.id, index.byKey.has(resourceKey(identity.type, identity.id))),
      ),
    );
  }
  if (index.primary.length > shown.length) {
    list.append(
      el("li", {
        class: "primary__more",
        text: `+ ${count(index.primary.length - shown.length)} more in the sections below`,
      }),
    );
  }
  section.append(list);

  return section;
}

/* ------------------------------------------------------------------ *
 * Type groups
 * ------------------------------------------------------------------ */

/**
 * Above this many rows in a group, "Expand all" is not offered. Opening 40,000
 * rows at once would build every body and undo the point of the collapsed
 * default, so the control is absent rather than present and punishing.
 */
const EXPAND_ALL_LIMIT = 500;

function groupHtml(group: TypeGroup): string {
  const tools =
    group.resources.length <= EXPAND_ALL_LIMIT
      ? `<button class="group__toggle" type="button">Expand all</button>`
      : `<span class="group__toggle-note" title="Too many rows to expand at once">${count(group.resources.length)} rows</span>`;

  return (
    `<section class="group" id="${groupDomId(group.type)}" data-type="${escapeHtml(group.type)}" data-hue="${group.hue}">` +
    `<header class="group__head">` +
    `<h2 class="group__title">` +
    `<b class="group__sigil">${escapeHtml(group.sigil)}</b>` +
    `<span class="group__name">${escapeHtml(group.type)}</span>` +
    `<span class="group__count">${count(group.resources.length)}</span>` +
    `</h2>` +
    `<div class="group__tools">${tools}</div>` +
    `</header>` +
    `<div class="group__rows">${groupRowsHtml(group.resources)}</div>` +
    `</section>`
  );
}

/** All type groups, as one HTML string. */
export function groupsHtml(index: DocumentIndex): string {
  const parts: string[] = [];
  for (const group of index.groups) parts.push(groupHtml(group));
  return parts.join("");
}
