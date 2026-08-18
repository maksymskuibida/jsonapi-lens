import { el, escapeHtml } from "./dom.js";
import { formatBytes, formatDuration } from "./format.js";
import { t } from "./i18n/index.js";
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
  return t().num(n);
}

/* ------------------------------------------------------------------ *
 * Jump rail
 * ------------------------------------------------------------------ */

export function renderRail(index: DocumentIndex): HTMLElement {
  const rail = el("nav", { class: "rail", "aria-label": t().rail.ariaLabel });
  const max = index.groups.reduce((m, g) => Math.max(m, g.resources.length), 1);

  rail.append(
    el(
      "div",
      { class: "rail__head" },
      el("h2", { class: "rail__title", text: t().rail.types }),
      el("span", { class: "rail__title-count", text: count(index.groups.length) }),
    ),
  );

  if (index.groups.length > 8) {
    rail.append(
      el("input", {
        class: "rail__search",
        type: "search",
        id: "rail-search",
        placeholder: t().rail.narrow,
        "aria-label": t().rail.narrowLabel,
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
          title: t().rail.jumpTo(group.type),
        },
        el("b", { class: "railrow__sigil", text: group.sigil }),
        el(
          "span",
          { class: "railrow__body" },
          el(
            "span",
            { class: "railrow__name-line" },
            el("span", { class: "railrow__name", text: group.type }),
            isPrimary &&
              el("span", { class: "railrow__primary", title: t().rail.inPrimary, text: "•" }),
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
        title: t().rail.showOnly(group.type),
        "aria-pressed": "false",
        text: t().rail.only,
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
        text: t().rail.showAllTypes,
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
  const overview = t().overview;
  const shape = index.primaryIsNull
    ? overview.shapeNull
    : index.errors.length
      ? overview.shapeErrors(index.errors.length)
      : index.primary.length === 0
        ? index.counts.total > 0
          ? overview.shapeIncludedOnly
          : overview.shapeMetaOnly
        : index.primary.length === 1
          ? overview.shapeSingle
          : overview.shapeMany(index.primary.length);

  const list = el("dl", { class: "overview__stats" });
  list.append(
    stat(overview.shape, shape),
    stat(overview.resources, count(index.counts.total)),
    stat(overview.types, count(index.groups.length)),
    stat(overview.included, count(index.counts.fromIncluded)),
    stat(overview.relationships, count(index.counts.relationships)),
  );
  if (index.counts.danglingPointers) {
    list.append(
      stat(
        overview.unresolvedPointers(index.counts.danglingPointers),
        count(index.counts.danglingPointers),
        "absent",
      ),
    );
  }
  if (index.counts.duplicates) {
    list.append(stat(overview.duplicateIdentities, count(index.counts.duplicates), "warn"));
  }
  list.append(
    stat(overview.size, formatBytes(stats.bytes)),
    stat(overview.indexedIn, formatDuration(stats.parseMs)),
  );

  section.append(list);

  if (index.primaryIsNull) {
    section.append(
      el("p", {
        class: "overview__note",
        text: overview.nullNote,
      }),
    );
  }

  if (index.counts.total === 0 && !index.errors.length) {
    section.append(
      el("p", {
        class: "overview__note",
        text: overview.emptyNote,
      }),
    );
  }

  if (index.counts.total > EAGER_BODY_LIMIT) {
    section.append(
      el(
        "p",
        { class: "overview__note overview__note--perf" },
        overview.lazyNote(index.counts.total),
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
        t().dangling.distinct(index.dangling.length),
      ),
      el("span", {
        class: "absent-list__hint",
        text: t().dangling.total(index.counts.danglingPointers),
      }),
    ),
  );

  const body = el("div", { class: "absent-list__body" });
  body.append(
    el("p", {
      class: "absent-list__note",
      text: t().dangling.note,
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
      text: error.title ?? t().errors.fallbackTitle(position + 1),
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
        el("span", {
          class: "err__source-label",
          text: typeof pointer === "string" ? t().errors.pointer : t().errors.parameter,
        }),
        el("code", { class: "err__source-value", text: String(pointer ?? parameter) }),
      ),
    );
  }

  const errorPointer = `/errors/${position}`;
  if (error.meta) {
    item.append(renderObjectBlock(t().block.meta, error.meta, `${errorPointer}/meta`, "sub"));
  }
  if (error.links) {
    item.append(renderObjectBlock(t().block.links, error.links, `${errorPointer}/links`, "sub"));
  }

  return item;
}

export function renderErrors(index: DocumentIndex): HTMLElement | null {
  if (!index.errors.length) return null;

  const section = el("section", { class: "errors", id: "errors" });
  section.append(
    el(
      "h2",
      { class: "errors__title" },
      t().errors.title,
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
  details.append(el("summary", { class: "toplevel__summary", text: t().topLevel.summary }));

  const body = el("div", { class: "toplevel__body" });
  if (index.jsonapi) body.append(renderObjectBlock(t().block.jsonapi, index.jsonapi, "/jsonapi", "sub"));
  if (index.links) body.append(renderObjectBlock(t().block.links, index.links, "/links", "sub"));
  if (index.meta) body.append(renderObjectBlock(t().block.meta, index.meta, "/meta", "sub"));
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
      t().primary.title,
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
        text: t().primary.more(index.primary.length - shown.length),
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
      ? `<button class="group__toggle" type="button">${escapeHtml(t().group.expandAll)}</button>`
      : `<span class="group__toggle-note" title="${escapeHtml(t().group.tooManyRowsTitle)}">${escapeHtml(t().group.tooManyRows(group.resources.length))}</span>`;

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
