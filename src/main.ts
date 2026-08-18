import "@fontsource-variable/martian-mono";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

import { copyBlob, copyText, downloadText } from "./clipboard.js";
import { el } from "./dom.js";
import { formatBytes, formatDuration } from "./format.js";
import {
  applyDocumentLanguage,
  LOCALE_CODES,
  LOCALE_NAMES,
  LOCALES,
  locale,
  setLocale,
  t,
} from "./i18n/index.js";
import type { Locale } from "./i18n/index.js";
import { localiseStaticDom } from "./i18n/static-dom.js";
import { legal } from "./legal/index.js";
import { domId, parseDomId, resourceKey } from "./ident.js";
import { openJumpModal } from "./jump.js";
import { openLibraryModal, openRawModal, openSaveModal, openShortcutsModal } from "./panels.js";
import { DocumentError, readDocument } from "./parse.js";
import { resolve as resolvePointer } from "./pointer.js";
import {
  EAGER_BODY_LIMIT,
  groupsHtml,
  renderDangling,
  renderErrors,
  renderOverview,
  renderPrimary,
  renderRail,
  renderTopLevel,
} from "./render-document.js";
import { buildResourceBody } from "./render-resource.js";
import { currentRoute, navigate, parseRoute, PASTE_PATH, VIEW_PATH } from "./router.js";
import type { LegalRoute, Route } from "./router.js";
import { applyPageMeta, applyRouteMeta, documentMeta, metaForRoute } from "./seo.js";
import { renderLegalPage } from "./views/legal.js";
import { fetchShare, openShareModal } from "./share.js";
import { ShareError } from "./crypto.js";
import {
  clearDocument,
  countLibrary,
  loadDocument,
  saveDocument,
  saveToLibrary,
} from "./store.js";
import type { LibraryEntry } from "./store.js";
import { closeModal, modalIsOpen, toast } from "./ui.js";
import type { DocumentIndex, JsonValue, Resource } from "./types.js";

import sampleArticles from "./samples/articles.json?raw";
import sampleSingle from "./samples/single.json?raw";
import sampleDangling from "./samples/dangling.json?raw";
import sampleErrors from "./samples/errors.json?raw";
import sampleEdge from "./samples/edge.json?raw";

/**
 * The sample payloads, with the label each one gets once loaded.
 *
 * A function rather than a constant because the labels are translated, and a
 * constant would freeze whichever language happened to be active when this
 * module first ran.
 */
function samples(): Record<string, { text: string; label: string }> {
  const m = t().samples;
  return {
    articles: { text: sampleArticles, label: m.articlesFile },
    single: { text: sampleSingle, label: m.singleFile },
    dangling: { text: sampleDangling, label: m.danglingFile },
    errors: { text: sampleErrors, label: m.errorsFile },
    edge: { text: sampleEdge, label: m.edgeFile },
  };
}

/* ------------------------------------------------------------- elements --- */

const need = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
};

const bootEl = need("boot");
const bootMessageEl = need("boot-message");
const pasteEl = need("paste");
const docEl = need("doc");
const inputEl = need<HTMLTextAreaElement>("input");
const dropEl = need("drop");
const dropMetaEl = need("drop-meta");
const fileEl = need<HTMLInputElement>("file");
const errorEl = need("error");
const errorHeadlineEl = need("error-headline");
const errorHintEl = need("error-hint");
const errorWhereEl = need("error-where");
const resumeEl = need("resume");
const newDocEl = need<HTMLButtonElement>("new-doc");
const topbarDocEl = need("topbar-doc");
const topbarLabelEl = need("topbar-label");
const topbarStatsEl = need("topbar-stats");
const themeEl = need<HTMLButtonElement>("theme-toggle");
const libraryEl = need<HTMLButtonElement>("open-library");
const libraryCountEl = need("library-count");
const legalEl = need("legal");
const languageEl = need<HTMLSelectElement>("language");

/* ------------------------------------------------------------- language --- */

/*
 * Runs before the theme, the library badge or any view, because all three write
 * copy and would otherwise write it in whatever language `index.html` shipped
 * with. `applyDocumentLanguage` also puts the chosen tag on `<html lang>`, so
 * screen readers and hyphenation follow the switch.
 */
applyDocumentLanguage();
localiseStaticDom();

// The head describes a page, not just a language: which title, description,
// canonical and robots directive are right depends on the route. Applied here
// for the route the page was loaded with, and again on every change below.
applyRouteMeta(currentRoute());

for (const code of LOCALES) {
  languageEl.append(el("option", { value: code, text: LOCALE_NAMES[code] }));
}
languageEl.value = locale();
languageEl.addEventListener("change", () => {
  setLocale(languageEl.value as Locale);
});

/*
 * A `<select>` is as wide as its widest option, and the full names push the top
 * bar past 320px. Below the same breakpoint the buttons use, the options become
 * language tags — which is also what the control is doing at that size: naming
 * a choice, not explaining it.
 */
const narrowBar = window.matchMedia("(max-width: 52rem)");

/*
 * Idempotent, and driven by both the media query and `resize`. The query's own
 * `change` event is the right signal and fires in a real browser, but it is one
 * event: anything that resizes the viewport without dispatching it would leave
 * the wrong labels sitting there until the next reload. Rewriting three
 * `textContent`s is far cheaper than the bug.
 */
let narrowLabels: boolean | null = null;

function labelLanguageOptions(): void {
  if (narrowLabels === narrowBar.matches) return;
  narrowLabels = narrowBar.matches;
  for (const option of languageEl.options) {
    const code = option.value as Locale;
    option.textContent = narrowLabels ? LOCALE_CODES[code] : LOCALE_NAMES[code];
  }
}

labelLanguageOptions();
narrowBar.addEventListener("change", labelLanguageOptions);
window.addEventListener("resize", labelLanguageOptions, { passive: true });

/* ---------------------------------------------------------------- state --- */

interface Loaded {
  index: DocumentIndex;
  label: string;
  bytes: number;
  text: string;
}

let current: Loaded | null = null;
let soloType: string | null = null;

/* ---------------------------------------------------------------- theme --- */

type Theme = "auto" | "light" | "dark";
const THEME_KEY = "jsonapi-lens:theme";

function applyTheme(theme: Theme): void {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  // The word is a separate element so narrow viewports can drop it and keep
  // the value, rather than the whole control overflowing the bar.
  const name = t().topbar.themeName(theme);
  themeEl.replaceChildren(
    el("span", { class: "btn__wide", text: t().topbar.themeLabel }),
    el("span", { text: name }),
  );
  themeEl.title = t().topbar.themeTitle(name);
}

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark" || stored === "auto") return stored;
  } catch {
    /* storage may be blocked; auto is a fine default */
  }
  return "auto";
}

let theme = readTheme();
applyTheme(theme);

themeEl.addEventListener("click", () => {
  theme = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
});

/* -------------------------------------------------------- library badge --- */

/**
 * Show how many documents are saved, and nothing when there are none — a "0"
 * badge is just noise on a button that already says what it does.
 */
async function refreshLibraryCount(): Promise<void> {
  const count = await countLibrary();
  libraryCountEl.textContent = count > 0 ? t().num(count) : "";
  libraryCountEl.hidden = count === 0;
  libraryEl.title = count > 0 ? t().topbar.savedTitleCount(count) : t().topbar.savedTitle;
}

/* ----------------------------------------------------------- view state --- */

function showView(which: "boot" | "paste" | "doc" | "legal", bootMessage?: string): void {
  bootEl.hidden = which !== "boot";
  pasteEl.hidden = which !== "paste";
  docEl.hidden = which !== "doc";
  legalEl.hidden = which !== "legal";
  newDocEl.hidden = which !== "doc";
  topbarDocEl.hidden = which !== "doc";
  if (which === "boot") bootMessageEl.textContent = bootMessage ?? t().boot.reading;
}

function showError(error: unknown): void {
  const documentError =
    error instanceof DocumentError
      ? error
      : error instanceof ShareError
        ? new DocumentError(error.headline, error.hint)
        : new DocumentError(
            t().parseErrors.unknown.headline,
            error instanceof Error ? error.message : String(error),
          );

  errorHeadlineEl.textContent = documentError.headline;
  errorHintEl.textContent = documentError.hint;
  if (documentError.line !== undefined) {
    errorWhereEl.textContent = t().paste.errorWhere(documentError.line);
    errorWhereEl.hidden = false;
  } else {
    errorWhereEl.hidden = true;
  }
  errorEl.hidden = false;
  errorEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function hideError(): void {
  errorEl.hidden = true;
}

/* ------------------------------------------------------------ filtering --- */

function applyFilter(): void {
  for (const group of docEl.querySelectorAll<HTMLElement>(".group")) {
    const type = group.dataset["type"];
    if (soloType && type !== soloType) group.setAttribute("data-filtered", "");
    else group.removeAttribute("data-filtered");
  }

  for (const button of docEl.querySelectorAll<HTMLButtonElement>(".railrow__solo")) {
    button.setAttribute("aria-pressed", String(button.dataset["solo"] === soloType));
  }

  const clear = docEl.querySelector<HTMLButtonElement>("#clear-filter");
  if (clear) clear.hidden = soloType === null;
}

function setSolo(type: string | null): void {
  soloType = type;
  applyFilter();
}

/* ------------------------------------------------------- landing on a row -- */

/** Open the `<details>` for a resource section so its detail is visible on arrival. */
function openSection(section: Element): void {
  const details = section.querySelector<HTMLDetailsElement>(".res__d");
  if (details && !details.open) details.open = true;
}

/**
 * Resolve `location.hash` against the rendered document.
 *
 * Called on boot (where the browser's own scroll-to-fragment already failed,
 * because the DOM did not exist yet) and on `hashchange` (where the browser has
 * scrolled, but the target may be collapsed or filtered out).
 *
 * `restore` is what the history entry being returned to remembered. When it is
 * present — Back or Forward — the document is folded back to the shape it had,
 * and then the exact offset is used, so you land where you were rather than at
 * the top of whatever the fragment names. When it is absent — following a link
 * for the first time — the fragment is scrolled to.
 *
 * Order matters throughout: the fold state is applied first, then the target's
 * own row is opened, and only then does anything scroll. Every one of those
 * steps changes how tall the page is, and an offset applied before them lands
 * against a layout that no longer exists.
 *
 * The highlight needs no help from here: `:target` starts matching as soon as an
 * element with that id exists, including one rendered long after the navigation.
 */
function resolveHash(restore: EntryState | null = null): void {
  // Fold the page back before measuring anything against it.
  if (restore?.open) applyOpenRows(restore.open);
  const restoreY = typeof restore?.y === "number" ? restore.y : null;

  const raw = location.hash;

  if (!raw || raw === "#") {
    // No fragment, but there may still be a position to return to.
    if (restoreY !== null) window.scrollTo(0, restoreY);
    return;
  }

  let fragment = raw.slice(1);
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    /* keep the raw fragment if it is not valid percent-encoding */
  }

  const target = document.getElementById(fragment);
  if (!target) {
    const identity = parseDomId(fragment);
    if (identity) toast(t().toast.noResource(identity.type, identity.id));
    if (restoreY !== null) window.scrollTo(0, restoreY);
    return;
  }

  // A filtered-out group cannot be scrolled to, so a link into one clears the
  // filter rather than silently doing nothing.
  const group = target.closest<HTMLElement>(".group");
  if (group?.hasAttribute("data-filtered")) {
    setSolo(null);
    toast(t().toast.filterCleared(group.dataset["type"] ?? ""));
  }

  // Open before scrolling, so the scroll lands against final layout.
  if (target.classList.contains("res")) openSection(target);

  if (restoreY !== null) window.scrollTo(0, restoreY);
  else target.scrollIntoView({ block: "start" });
}

/* --------------------------------------------------- scroll restoration --- */

/**
 * Where you were, per history entry.
 *
 * The browser's own restoration is turned off, because it fights the fragment
 * scrolling above and it cannot know that expanding a row changed the layout.
 * Instead the current position is written into `history.state` as you scroll,
 * so Back and Forward can put you back exactly where you left — including the
 * position inside a long resource, not just the top of its row.
 *
 * It survives a reload too: `history.state` persists, so returning to `/view`
 * lands where you were rather than at the top.
 */
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

/**
 * What a history entry remembers.
 *
 * A scroll offset on its own is not enough. The offset only means anything
 * against a particular layout, and expanding one row moves everything below it
 * by hundreds of pixels — so returning to `y` after the page has been folded
 * differently lands somewhere unrelated. The set of open rows travels with the
 * offset, and is re-applied before the scroll.
 */
interface EntryState {
  y?: number;
  /** DOM ids of the resource sections that were expanded. */
  open?: string[];
  /** Set when there were too many open rows to record; see OPEN_ROWS_LIMIT. */
  openTruncated?: boolean;
}

/**
 * Above this, the open set is not recorded. `history.state` is capped by the
 * browser (Firefox rejects past ~640 kB), and "Expand all" on a big group could
 * otherwise push tens of thousands of ids into every entry. Past the limit the
 * scroll offset is still stored; only the fold state is given up.
 */
const OPEN_ROWS_LIMIT = 2000;

let saveStateTimer: number | undefined;

/** The resource sections currently expanded. Only open rows are scanned. */
function openRowIds(): string[] {
  const ids: string[] = [];
  for (const details of docEl.querySelectorAll<HTMLElement>(".res__d[open]")) {
    const section = details.closest<HTMLElement>(".res");
    if (section?.id) {
      ids.push(section.id);
      if (ids.length > OPEN_ROWS_LIMIT) return ids;
    }
  }
  return ids;
}

/** Fold the document back to exactly the given set, touching only what differs. */
function applyOpenRows(ids: string[]): void {
  const wanted = new Set(ids);
  const currentlyOpen = new Set<string>();

  for (const details of docEl.querySelectorAll<HTMLDetailsElement>(".res__d[open]")) {
    const section = details.closest<HTMLElement>(".res");
    if (!section?.id) continue;
    currentlyOpen.add(section.id);
    if (!wanted.has(section.id)) details.open = false;
  }

  for (const id of wanted) {
    if (currentlyOpen.has(id)) continue;
    const details = document.getElementById(id)?.querySelector<HTMLDetailsElement>(".res__d");
    if (details) details.open = true;
  }
}

function rememberState(): void {
  try {
    const state = (history.state ?? {}) as Record<string, unknown>;
    const open = openRowIds();
    const next: EntryState = { ...state, y: Math.round(window.scrollY) };
    if (open.length > OPEN_ROWS_LIMIT) {
      delete next.open;
      next.openTruncated = true;
    } else {
      next.open = open;
      delete next.openTruncated;
    }
    history.replaceState(next, "");
  } catch {
    /* replaceState can throw if called too often; losing one sample is fine */
  }
}

function scheduleRemember(): void {
  window.clearTimeout(saveStateTimer);
  saveStateTimer = window.setTimeout(rememberState, 120);
}

window.addEventListener("scroll", scheduleRemember, { passive: true });

/* Folding a row changes the layout the offset is measured against, and fires no
   scroll event, so expansion has to be recorded in its own right. `toggle` does
   not bubble — hence the capture phase, as elsewhere. */
docEl.addEventListener("toggle", scheduleRemember, true);

/*
 * The debounced listener above keeps the entry roughly current, but the moment
 * that actually matters is the instant before the page navigates away — and a
 * debounce can easily still be pending then. So the position is also captured
 * synchronously on the way out:
 *
 *  - a capture-phase click on any in-page anchor, which runs before the browser
 *    performs the fragment navigation and pushes the new entry;
 *  - `pagehide`, which covers reloads and closing the tab.
 *
 * This is what makes Back land where you were rather than where the last
 * debounce happened to fire.
 */
document.addEventListener(
  "click",
  (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');
    if (anchor) rememberState();
  },
  true,
);

window.addEventListener("pagehide", rememberState);

/* `scrollend` is the exact moment a scroll settles, so it records the real
   resting position instead of wherever the debounce happened to land. */
window.addEventListener("scrollend", rememberState, { passive: true });

/*
 * There is deliberately no Navigation API `navigate` hook here, tempting as it
 * looks. It fires during a traversal, by which point `history.state` already
 * refers to the entry being restored — so writing the outgoing scroll position
 * there overwrites the very state that is about to be read back, and Back stops
 * working entirely. `scrollend` above closes the same gap without that risk.
 */

/** What the current entry remembered — used after a reload, where state survives. */
function savedEntryState(): EntryState | null {
  return (history.state as EntryState | null) ?? null;
}

/**
 * A history traversal fires `popstate` and, if the fragment changed,
 * `hashchange` as well. Both funnel here, and the shared timer means the work
 * runs once after whichever arrives last — so the two cannot fight over the
 * scroll position, whatever order the browser delivers them in.
 */
let pendingRestore: EntryState | null = null;
let settleTimer: number | undefined;

function scheduleSettle(): void {
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    const restore = pendingRestore;
    pendingRestore = null;
    resolveHash(restore);
  }, 0);
}

window.addEventListener("hashchange", scheduleSettle);

/* --------------------------------------------------------------- render --- */

function fillBody(details: HTMLDetailsElement, index: DocumentIndex): void {
  const body = details.querySelector<HTMLElement>(".res__body");
  if (!body || !body.hasAttribute("data-pending")) return;

  const resource = resourceOf(details);
  if (!resource) return;

  body.removeAttribute("data-pending");
  body.append(buildResourceBody(resource, index));
}

/** The resource a DOM node belongs to, via its section's encoded id. */
function resourceOf(node: Element): Resource | null {
  if (!current) return null;
  const section = node.closest<HTMLElement>(".res");
  const identity = section ? parseDomId(section.id) : null;
  if (!identity) return null;
  return current.index.byKey.get(resourceKey(identity.type, identity.id)) ?? null;
}

/** Actions that operate on the whole document, shown in the overview card. */
function documentActions(): HTMLElement {
  const button = (label: string, title: string, onClick: () => void, primary = false) => {
    const node = el("button", {
      class: `btn${primary ? " btn--primary" : ""} btn--sm`,
      type: "button",
      title,
      text: label,
    });
    node.addEventListener("click", onClick);
    return node;
  };

  const m = t().overview;

  return el(
    "div",
    { class: "overview__actions" },
    button(m.shareLink, m.shareLinkTitle, () => shareDocument(), true),
    button(m.save, m.saveTitle, () => saveCurrent()),
    button(m.export, m.exportTitle, () => exportCurrent()),
    button(m.raw, m.rawTitle, () => rawDocument()),
    button(m.copy, m.copyTitle, () => {
      if (current) void copyBlob(current.text, t().copyKinds.document);
    }),
  );
}

function renderDocumentView(loaded: Loaded, parseMs: number): void {
  const { index } = loaded;
  const started = performance.now();

  const main = el("div", { class: "main" });

  const overview = renderOverview(index, { bytes: loaded.bytes, parseMs });
  overview.append(documentActions());
  main.append(overview);

  const errors = renderErrors(index);
  if (errors) main.append(errors);

  const dangling = renderDangling(index);
  if (dangling) main.append(dangling);

  const primary = renderPrimary(index);
  if (primary) main.append(primary);

  const topLevel = renderTopLevel(index);
  if (topLevel) main.append(topLevel);

  // One string, one parse. On a 50k-resource document this is where the render
  // budget is spent, and it is several times cheaper than per-node creation.
  const groups = el("div", { class: "groups" });
  groups.innerHTML = groupsHtml(index);
  main.append(groups);

  // An errors-only or meta-only document has no types to jump between, so the
  // rail would be an empty column headed "Types 0".
  if (index.groups.length > 0) {
    docEl.classList.remove("doc--no-rail");
    docEl.replaceChildren(renderRail(index), main);
  } else {
    docEl.classList.add("doc--no-rail");
    docEl.replaceChildren(main);
  }

  // Small documents get their detail built up front: expanding is then instant,
  // and "Expand all" on a group is a single reflow rather than N builds — which
  // is also the reliable way to get every attribute value in front of
  // find-in-page, since a closed `<details>` is not dependably revealed by it.
  const eager = index.counts.total <= EAGER_BODY_LIMIT;
  if (eager) {
    for (const details of groups.querySelectorAll<HTMLDetailsElement>(".res__d")) {
      fillBody(details, index);
    }
  }

  const renderMs = performance.now() - started;

  showView("doc");
  soloType = null;
  applyFilter();

  topbarLabelEl.textContent = loaded.label;
  topbarStatsEl.textContent = t().overview.stats(
    index.counts.total,
    index.groups.length,
    formatBytes(loaded.bytes),
  );

  // Numbers worth having in front of you when a payload feels slow.
  console.info("[jsonapi-lens] timings", {
    resources: index.counts.total,
    types: index.groups.length,
    bytes: loaded.bytes,
    parseAndIndex: formatDuration(parseMs),
    render: formatDuration(renderMs),
    bodies: eager ? "eager" : "lazy (on expand)",
  });

  // `/view` shows a document held in this browser alone, so the head stops
  // claiming to be an indexable page for as long as one is open.
  applyPageMeta(documentMeta(loaded.label));
}

/* Lazy bodies. `toggle` does not bubble, so this listens in the capture phase,
   which non-bubbling events still traverse. Using `toggle` rather than `click`
   also catches the browser expanding a row itself during find-in-page. */
docEl.addEventListener(
  "toggle",
  (event) => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open) return;
    if (!details.classList.contains("res__d")) return;
    if (current) fillBody(details, current.index);
  },
  true,
);

/* ------------------------------------------------------- copy delegation --- */

/** Render a value for the clipboard: bare text for strings, JSON for the rest. */
function valueForClipboard(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object") return String(value);
  return JSON.stringify(value, null, 2);
}

function handleValueCopy(button: HTMLElement): void {
  if (!current) return;
  const row = button.closest<HTMLElement>("[data-pointer]");
  const pointer = row?.dataset["pointer"];
  if (!pointer) return;

  if (button.dataset["copy"] === "path") {
    void copyText(pointer, t().copyKinds.pointer);
    return;
  }

  const value = resolvePointer(current.index.root, pointer);
  if (value === undefined) {
    toast(t().toast.pointerGone(pointer), "error");
    return;
  }
  const text = valueForClipboard(value as JsonValue);
  if (text.length > 400) void copyBlob(text, t().copyKinds.value);
  else void copyText(text, t().copyKinds.value);
}

function handleObjectAction(button: HTMLElement): void {
  const resource = resourceOf(button);
  if (!resource) return;

  switch (button.dataset["objectAction"]) {
    case "raw":
      openRawModal({
        title: `${resource.type} · ${resource.id}`,
        subtitle: resource.pointer,
        value: resource.raw,
        filename: `${resource.type.replace(/[^\w.-]+/g, "_")}-${resource.id.replace(/[^\w.-]+/g, "_")}.json`,
      });
      break;
    case "copy-object":
      void copyBlob(
        JSON.stringify(resource.raw, null, 2),
        t().copyKinds.resource(resource.type, resource.id),
      );
      break;
    case "copy-pointer":
      void copyText(resource.pointer, t().copyKinds.pointer);
      break;
    case "copy-link":
      void copyText(
        `${location.origin}${VIEW_PATH}#${domId(resource.type, resource.id)}`,
        t().copyKinds.deepLink,
      );
      break;
  }
}

docEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  // These buttons can sit inside a `<summary>`, where a bubbling click would
  // toggle the disclosure as well as copying.
  const copyButton = target.closest<HTMLElement>("[data-copy]");
  if (copyButton) {
    event.preventDefault();
    event.stopPropagation();
    handleValueCopy(copyButton);
    return;
  }

  const objectButton = target.closest<HTMLElement>("[data-object-action]");
  if (objectButton) {
    event.preventDefault();
    event.stopPropagation();
    handleObjectAction(objectButton);
    return;
  }

  const solo = target.closest<HTMLButtonElement>(".railrow__solo");
  if (solo) {
    const type = solo.dataset["solo"] ?? null;
    setSolo(soloType === type ? null : type);
    return;
  }

  if (target.closest("#clear-filter")) {
    setSolo(null);
    return;
  }

  const expand = target.closest<HTMLButtonElement>(".group__toggle");
  if (expand) {
    const group = expand.closest<HTMLElement>(".group");
    if (!group) return;
    const rows = group.querySelectorAll<HTMLDetailsElement>(".res__d");
    const opening = expand.dataset["state"] !== "open";
    for (const row of rows) row.open = opening;
    expand.dataset["state"] = opening ? "open" : "closed";
    expand.textContent = opening ? t().group.collapseAll : t().group.expandAll;
  }
});

docEl.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.id !== "rail-search") return;
  const query = target.value.trim().toLowerCase();
  for (const row of docEl.querySelectorAll<HTMLElement>(".railrow")) {
    const type = row.dataset["type"] ?? "";
    row.hidden = query !== "" && !type.toLowerCase().includes(query);
  }
});

/* ---------------------------------------------------- document actions --- */

function safeFilename(label: string): string {
  const base = label.replace(/\.json$/i, "").replace(/[^\w.-]+/g, "-") || "document";
  return `${base}.json`;
}

function exportCurrent(): void {
  if (!current) return;
  const filename = safeFilename(current.label);
  downloadText(current.text, filename);
  toast(t().toast.downloading(filename));
}

function rawDocument(): void {
  if (!current) return;
  openRawModal({
    title: current.label,
    subtitle: t().raw.wholeDocument,
    value: current.index.root,
    filename: safeFilename(current.label),
  });
}

function shareDocument(): void {
  if (!current) return;
  openShareModal(current.text, current.label);
}

function saveCurrent(): void {
  if (!current) return;
  const loaded = current;
  openSaveModal(loaded.label, async (label) => {
    const entry: LibraryEntry = {
      label,
      text: loaded.text,
      savedAt: Date.now(),
      bytes: loaded.bytes,
      resources: loaded.index.counts.total,
      types: loaded.index.groups.length,
      shape: loaded.index.primaryIsNull
        ? "data: null"
        : loaded.index.errors.length
          ? `errors[${loaded.index.errors.length}]`
          : loaded.index.primary.length === 1
            ? "data{1}"
            : `data[${loaded.index.primary.length}]`,
    };
    const id = await saveToLibrary(entry);
    if (id === null) {
      toast(t().save.failed, "error");
      return;
    }
    loaded.label = label;
    topbarLabelEl.textContent = label;
    applyPageMeta(documentMeta(label));
    void refreshLibraryCount();
    toast(t().save.done(label));
  });
}

function openLibrary(): void {
  void openLibraryModal(
    (entry) => {
      closeModal();
      void load(entry.text, entry.label, { persist: true, push: true });
    },
    // Renames and deletes happen inside the modal, so the badge is refreshed
    // from there rather than guessed at here.
    () => void refreshLibraryCount(),
  );
}

/* ---------------------------------------------------------------- legal --- */

function showLegal(page: LegalRoute): void {
  const pages = legal();
  legalEl.replaceChildren(renderLegalPage(page === "impressum" ? pages.impressum : pages.privacy));
  showView("legal");
  // These two are the only paths besides `/` that a search engine should hold,
  // and each has its own title and description in each language.
  applyPageMeta(metaForRoute({ kind: "legal", page }));
  window.scrollTo(0, 0);
}

/*
 * The footer links and the cross-link between the two pages are ordinary
 * anchors, so they work with middle-click, "open in new tab" and no JavaScript.
 * This intercepts the plain left-click case only, to keep the loaded document
 * and the scroll history intact — everything else falls through to the browser.
 */
document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || anchor.target === "_blank" || anchor.origin !== location.origin) return;

  const route = parseRoute(anchor.pathname);
  if (route.kind !== "legal") return;

  event.preventDefault();
  navigate(anchor.pathname);
  showLegal(route.page);
});

/* ------------------------------------------------------------- loading --- */

interface LoadOptions {
  /** Write to IndexedDB as the current document, and reset the fragment. */
  persist: boolean;
  /** Push `/view` onto history rather than replacing the current entry. */
  push?: boolean;
}

async function load(text: string, label: string, options: LoadOptions): Promise<boolean> {
  hideError();

  const bytes = new TextEncoder().encode(text).byteLength;
  const started = performance.now();

  let index: DocumentIndex;
  try {
    index = readDocument(text);
  } catch (error) {
    showView("paste");
    showError(error);
    return false;
  }

  const parseMs = performance.now() - started;
  current = { index, label, bytes, text };

  if (options.persist) {
    // A fresh document invalidates any fragment from the previous one, and the
    // document view lives at /view.
    if (options.push) navigate(VIEW_PATH);
    else navigate(VIEW_PATH, { replace: true });
  }

  renderDocumentView(current, parseMs);

  if (options.persist) {
    window.scrollTo(0, 0);
    const saved = await saveDocument({ text, savedAt: Date.now(), label });
    if (!saved) toast(t().toast.notStored);
  }

  return true;
}

function loadFromInput(): void {
  const text = inputEl.value;
  if (!text.trim()) {
    showError(
      new DocumentError(t().parseErrors.nothingYet.headline, t().parseErrors.nothingYet.hint),
    );
    return;
  }
  void load(text, t().labels.pastedDocument, { persist: true, push: true });
}

/* ----------------------------------------------------------- paste view --- */

function updateDropMeta(): void {
  const length = inputEl.value.length;
  dropMetaEl.textContent = length ? t().paste.characters(length) : "";
}

inputEl.addEventListener("input", () => {
  updateDropMeta();
  hideError();
});

need("parse").addEventListener("click", loadFromInput);

inputEl.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    loadFromInput();
  }
});

need("open-file").addEventListener("click", () => fileEl.click());
need("open-library").addEventListener("click", openLibrary);
need("shortcuts").addEventListener("click", openShortcutsModal);

fileEl.addEventListener("change", () => {
  const file = fileEl.files?.[0];
  if (file) void readFile(file);
  fileEl.value = "";
});

async function readFile(file: File): Promise<void> {
  try {
    const text = await file.text();
    inputEl.value = text;
    updateDropMeta();
    await load(text, file.name, { persist: true, push: true });
  } catch {
    showError(
      new DocumentError(
        t().parseErrors.fileUnreadable.headline,
        t().parseErrors.fileUnreadable.hint,
      ),
    );
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-sample]")) {
  button.addEventListener("click", () => {
    const sample = samples()[button.dataset["sample"] ?? ""];
    if (!sample) return;
    inputEl.value = sample.text;
    updateDropMeta();
    void load(sample.text, sample.label, { persist: true, push: true });
  });
}

/* Drag and drop. `dragover` must be cancelled or the browser navigates away. */
let dragDepth = 0;

dropEl.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth++;
  dropEl.classList.add("is-dragging");
});

dropEl.addEventListener("dragover", (event) => event.preventDefault());

dropEl.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropEl.classList.remove("is-dragging");
});

dropEl.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropEl.classList.remove("is-dragging");
  const file = event.dataTransfer?.files?.[0];
  if (file) void readFile(file);
});

// Dropping anywhere else on the page should not have the browser open the file.
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());

/** Leave the document without discarding it — Back and Forward still work. */
function leaveDocument(): void {
  if (docEl.hidden) return;
  navigate(PASTE_PATH);
  applyRouteMeta({ kind: "paste" });
  showView("paste");
  offerResume();
  window.scrollTo(0, 0);
}

newDocEl.addEventListener("click", () => {
  void clearDocument();
  current = null;
  soloType = null;
  docEl.replaceChildren();
  inputEl.value = "";
  updateDropMeta();
  resumeEl.hidden = true;
  navigate(PASTE_PATH);
  applyRouteMeta({ kind: "paste" });
  showView("paste");
  inputEl.focus();
});

/**
 * `/` is always the paste view, even when a document is loaded — so it offers a
 * way back into the one you already have rather than making you paste again.
 */
function offerResume(): void {
  if (!current) {
    resumeEl.hidden = true;
    return;
  }
  resumeEl.replaceChildren(
    el("span", { class: "resume__text" }, t().resume.stillOpen(current.label)),
    (() => {
      const button = el("button", {
        class: "btn btn--primary btn--sm",
        type: "button",
        text: t().resume.back,
      });
      button.addEventListener("click", () => {
        navigate(VIEW_PATH);
        if (current) applyPageMeta(documentMeta(current.label));
        showView("doc");
      });
      return button;
    })(),
  );
  resumeEl.hidden = false;
}

/* ------------------------------------------------------------ shortcuts --- */

/** Is the user typing? Single-letter shortcuts must not fire mid-word. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable === true
  );
}

document.addEventListener("keydown", (event) => {
  // Shift+Escape leaves the document from anywhere, including out of a dialog.
  if (event.key === "Escape" && event.shiftKey) {
    event.preventDefault();
    closeModal();
    leaveDocument();
    return;
  }

  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (modalIsOpen()) return;

  if (event.key === "?" ) {
    event.preventDefault();
    openShortcutsModal();
    return;
  }

  if (isTyping(event.target)) return;

  switch (event.key) {
    // `/` used to focus the rail's type filter, which only renders above eight
    // types — so on most documents it silently did nothing. It now opens the
    // resource finder, which always exists and is the search you actually want.
    case "/":
    case "g":
      if (current) {
        event.preventDefault();
        openJumpModal(current.index);
      }
      break;
    case "s":
      if (current) {
        event.preventDefault();
        saveCurrent();
      }
      break;
    case "r":
      if (current) {
        event.preventDefault();
        rawDocument();
      }
      break;
    case "e":
      if (current) {
        event.preventDefault();
        exportCurrent();
      }
      break;
    case "l":
      event.preventDefault();
      openLibrary();
      break;
  }
});

/* --------------------------------------------------------------- routes --- */

/** Load a document that arrived as a share link. */
async function loadSharedDocument(route: Extract<Route, { kind: "share" }>): Promise<void> {
  showView("boot", t().boot.fetchingShare);

  try {
    const payload = await fetchShare(route.id, route.secret);
    // Drop the key from the visible URL and from history before rendering, so
    // it does not sit in the address bar or leak through a later Referer.
    navigate(VIEW_PATH, { replace: true });
    await load(payload.text, payload.label || t().labels.sharedDocument(route.id), {
      persist: true,
    });
    toast(t().share.opened);
  } catch (error) {
    navigate(PASTE_PATH, { replace: true });
    applyRouteMeta({ kind: "paste" });
    showView("paste");
    showError(error);
  }
}

async function applyRoute(): Promise<void> {
  const route = currentRoute();
  applyRouteMeta(route);

  if (route.kind === "share") {
    await loadSharedDocument(route);
    return;
  }

  if (route.kind === "legal") {
    showLegal(route.page);
    return;
  }

  if (route.kind === "unknown") {
    toast(t().toast.noPage(route.pathname));
    navigate(PASTE_PATH, { replace: true });
    applyRouteMeta({ kind: "paste" });
    showView("paste");
    offerResume();
    return;
  }

  if (route.kind === "view") {
    // Idempotent: traversing between fragments on /view must not re-render.
    if (current) {
      showView("doc");
      return;
    }
    const stored = await loadDocument();
    if (stored) {
      inputEl.value = stored.text;
      updateDropMeta();
      const ok = await load(stored.text, stored.label ?? t().labels.storedDocument, {
        persist: false,
      });
      // The browser tried to scroll to the fragment before any of this existed,
      // so that attempt hit nothing. Now the sections are in the DOM.
      if (ok) resolveHash(savedEntryState());
      else {
        navigate(PASTE_PATH, { replace: true });
        applyRouteMeta({ kind: "paste" });
      }
      return;
    }
    navigate(PASTE_PATH, { replace: true });
    applyRouteMeta({ kind: "paste" });
    showView("paste");
    toast(t().toast.noDocument);
    return;
  }

  showView("paste");
  offerResume();
}

window.addEventListener("popstate", (event) => {
  pendingRestore = (event.state as EntryState | null) ?? null;
  void applyRoute().then(scheduleSettle);
});

/* ------------------------------------------------------------------ boot -- */

async function boot(): Promise<void> {
  const route = currentRoute();

  if (route.kind === "share") {
    await loadSharedDocument(route);
    return;
  }

  if (route.kind === "view" || route.kind === "unknown" || route.kind === "legal") {
    await applyRoute();
    return;
  }

  // The paste view is the entry point. If a document is already stored, offer a
  // way back to it instead of silently jumping there.
  const stored = await loadDocument();
  showView("paste");

  if (!stored) {
    resumeEl.hidden = true;
    return;
  }

  inputEl.value = stored.text;
  updateDropMeta();

  // Parse it so "Back to document" is instant, but stay on the paste view.
  try {
    const index = readDocument(stored.text);
    current = {
      index,
      label: stored.label ?? t().labels.storedDocument,
      bytes: new TextEncoder().encode(stored.text).byteLength,
      text: stored.text,
    };
    offerResume();
  } catch {
    // A stored document that no longer parses is not worth blocking the paste
    // view over; it stays in the textarea so it can be fixed by hand.
    resumeEl.hidden = true;
  }
}

void refreshLibraryCount();
void boot();
