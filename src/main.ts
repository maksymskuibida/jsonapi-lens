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
import { DocumentError, readAny, readDocument } from "./parse.js";
import { resolve as resolvePointer } from "./pointer.js";
import {
  EAGER_BODY_LIMIT,
  groupsHtml,
  railEntriesForCollections,
  railEntriesForGroups,
  renderDangling,
  renderErrors,
  renderJsonDangling,
  renderJsonOverview,
  renderOverview,
  renderPrimary,
  renderRail,
  renderTopLevel,
} from "./render-document.js";
import { buildAnnotations, renderJsonGroups, renderJsonLeftover } from "./render-json.js";
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
import type { DocumentIndex, JsonIndex, JsonValue, Lens, Resource } from "./types.js";

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
const shapeOfferEl = need("shape-offer");
const shapeOfferHeadlineEl = need("shape-offer-headline");
const shapeOfferHintEl = need("shape-offer-hint");
const shapeOfferPlainEl = need<HTMLButtonElement>("shape-offer-plain");
const shapeOfferJsonApiEl = need<HTMLButtonElement>("shape-offer-jsonapi");
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
  lens: Lens;
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

/* ------------------------------------------------------------ shape offer --- */

/**
 * A document that is not JSON:API but did parse — held here between "the text
 * was classified" and "the person picked a reading", since both buttons below
 * need the exact text and label the classification was made from rather than
 * re-reading the textarea, which may have changed by the time a button is
 * clicked.
 */
let pendingOffer: { text: string; label: string } | null = null;

function hideShapeOffer(): void {
  pendingOffer = null;
  shapeOfferEl.hidden = true;
}

/**
 * Name the shape found and offer both readings — "a document that is JSON:API
 * still goes straight through with no extra click" is what makes this the
 * branch taken only for everything else.
 */
function showShapeOffer(text: string, label: string, index: JsonIndex): void {
  pendingOffer = { text, label };
  const shape = t().shape;
  shapeOfferHeadlineEl.textContent = shape.offerHeadline(shape.name(index.shape));
  shapeOfferHintEl.textContent = shape.evidence(index.shapeEvidence);
  shapeOfferEl.hidden = false;
  shapeOfferEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
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

  // Which sections a position can be anchored to changes with the filter.
  indexSections();
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
 * present — Back or Forward — the document is folded back to the shape it had
 * and the recorded position is re-established, so you land where you were
 * rather than at the top of whatever the fragment names. When it is absent —
 * following a link for the first time — the fragment is scrolled to.
 *
 * A restored shape is authoritative, which is why the fragment's own row is
 * only opened when there was no shape to apply. Otherwise returning to an entry
 * where you had *collapsed* the row you originally landed on would re-open it,
 * and every row below it would move.
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
  // Fold the page back before measuring anything against it. An empty array is
  // a shape too — "nothing was open" — so this tests for presence, not length.
  const shape = restore?.open;
  if (shape) applyOpenRows(shape);
  const position = restore && hasPosition(restore) ? restore : null;

  const raw = location.hash;

  if (!raw || raw === "#") {
    // No fragment, but there may still be a position to return to.
    if (position) restorePosition(position);
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
    if (position) restorePosition(position);
    return;
  }

  // A filtered-out group cannot be scrolled to, so a link into one clears the
  // filter rather than silently doing nothing.
  const group = target.closest<HTMLElement>(".group");
  if (group?.hasAttribute("data-filtered")) {
    setSolo(null);
    toast(t().toast.filterCleared(group.dataset["type"] ?? ""));
  }

  // Open before scrolling, so the scroll lands against final layout — but never
  // on top of a restored shape, which already says whether this row was open.
  if (target.classList.contains("res") && !shape) openSection(target);

  if (position) restorePosition(position);
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
 * A pixel offset is the wrong thing to remember, and the reason is
 * `content-visibility: auto`. A row that has never been on screen has no
 * measured height — the browser uses the `contain-intrinsic-size` estimate
 * instead — so the page is only as accurate as the parts of it you have
 * actually visited. Walk into a region for the first time and every row there
 * grows from its 35.6px estimate to its real height, permanently. If any of
 * that happened *above* where you were standing, the offset you left behind now
 * points at different content: measured here at 342–1,215px of drift, which is
 * most of a screen.
 *
 * So an entry remembers a *place*, not a number: which resource section the
 * viewport was resting against, and how far that section's top was from the top
 * of the viewport. Both survive the page growing underneath them, and both
 * survive a reload. `y` is still kept, as the fallback for when the section is
 * no longer in the document at all — a different payload, say.
 *
 * The set of open rows travels with it, because folding is the other thing that
 * moves content, and it is re-applied before anything scrolls.
 */
interface EntryState {
  /** Fallback offset, for when `at` no longer resolves. */
  y?: number;
  /** DOM id of the resource section the viewport was resting against. */
  at?: string;
  /** That section's distance from the top of the viewport, in CSS pixels. */
  offset?: number;
  /** DOM ids of the resource sections that were expanded. */
  open?: string[];
  /** Set when there were too many open rows to record; see OPEN_ROWS_LIMIT. */
  openTruncated?: boolean;
}

/** Whether an entry remembers a position at all. */
function hasPosition(state: EntryState): boolean {
  return typeof state.at === "string" || typeof state.y === "number";
}

/**
 * Above this, the open set is not recorded. `history.state` is capped by the
 * browser (Firefox rejects past ~640 kB), and "Expand all" on a big group could
 * otherwise push tens of thousands of ids into every entry. Past the limit the
 * scroll offset is still stored; only the fold state is given up.
 */
const OPEN_ROWS_LIMIT = 2000;

let saveStateTimer: number | undefined;

/**
 * Every resource section in document order, filtered-out groups excluded.
 *
 * Rebuilt with the filter rather than queried per scroll: finding the section
 * the viewport rests against is a binary search over this array, and at 56,821
 * rows a `querySelectorAll` on every `scrollend` would not be free.
 */
let sectionsInOrder: HTMLElement[] = [];

function indexSections(): void {
  const found: HTMLElement[] = [];
  for (const group of docEl.querySelectorAll<HTMLElement>(".group")) {
    if (group.hasAttribute("data-filtered")) continue;
    for (const section of group.querySelectorAll<HTMLElement>(".res")) found.push(section);
  }
  sectionsInOrder = found;
}

/**
 * The section the viewport is resting against: the first one not entirely
 * scrolled past, plus where its top sits relative to the viewport.
 *
 * Sections are laid out top to bottom in document order, so "is this section
 * still on screen" is monotonic along the array and a binary search finds the
 * boundary in ~17 probes instead of 56,821. Hidden groups are excluded from the
 * array precisely so that monotonicity holds — a `display: none` group reports
 * a zero rect wherever it sits, which would break the ordering.
 */
function viewportReference(): { at: string; offset: number } | null {
  let low = 0;
  let high = sectionsInOrder.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (sectionsInOrder[mid]!.getBoundingClientRect().bottom > 0) {
      found = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  // Scrolled past the last section: still anchor, to the last one there is.
  const section = sectionsInOrder[found === -1 ? sectionsInOrder.length - 1 : found];
  if (!section?.id) return null;
  // Sub-pixel, deliberately. Rows have fractional heights once text wraps, and
  // rounding here is enough to ratchet: the convergence pass settles within a
  // pixel rather than on it, so a rounded target plus that slop walked the
  // position a whole pixel per traversal, always the same way.
  const top = section.getBoundingClientRect().top;
  return { at: section.id, offset: Math.round(top * 100) / 100 };
}

/* --------------------------------------------------- returning to a place --- */

/**
 * Frames spent converging on a restored position.
 *
 * One scroll is not enough, and this is the crux of the whole mechanism. Moving
 * the viewport is what causes the rows around it to be rendered and measured for
 * the first time, which changes their heights, which moves the very section
 * being aimed at. So each pass re-reads where the section actually is and closes
 * the remaining gap, which is what makes it converge: correctness comes from
 * re-measuring, not from assuming heights only ever grow. They usually do, since
 * a measured row keeps its size, but restoring a fold shape can shrink the page
 * on the way back. In practice it settles in two or three passes.
 */
const SETTLE_PASSES = 8;

/**
 * How close counts as arrived, in CSS pixels.
 *
 * Not zero: scroll offsets are quantised, so insisting on an exact landing would
 * spend every pass without ever satisfying the test. Sub-pixel because the error
 * this tolerates is visible once — a quarter of a pixel is not.
 */
const SETTLE_EPSILON = 0.25;

/** Keys that scroll. `⌘ + ←` is Back, not a scroll, hence the modifier check. */
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

let userGesture = false;
const noteGesture = (): void => {
  userGesture = true;
};

for (const type of ["wheel", "touchstart", "pointerdown"] as const) {
  window.addEventListener(type, noteGesture, { passive: true });
}
window.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (SCROLL_KEYS.has(event.key)) noteGesture();
});

/**
 * Until when the scrolls happening are this module's own.
 *
 * The convergence pass below scrolls several times, and none of those
 * intermediate positions are the user's. Recording one would overwrite the
 * entry with a half-finished position. A deadline rather than a flag because it
 * cannot get stuck: if the tab is hidden mid-restore the frame callbacks never
 * run, and a flag would suppress every future capture for the life of the page.
 */
let restoringUntil = 0;

function restoring(): boolean {
  return performance.now() < restoringUntil;
}

/**
 * How long after a restore its own trailing `scrollend` may still turn up.
 *
 * The convergence pass scrolls, so the browser fires `scrollend` once it stops —
 * and that event is this module's own doing, not the user's. Recording it would
 * replace the entry's target with the approximation the loop settled for, and
 * going back and forth over one entry would then walk away from the original
 * position a pixel at a time.
 */
const RESTORE_TAIL_MS = 250;

/** Put `section` back at `offset` from the top of the viewport, and hold it there. */
function holdSectionAt(section: HTMLElement, offset: number): void {
  let passes = 0;
  userGesture = false;

  const done = (yieldedToUser: boolean): void => {
    // Where the user ends up is theirs to record, so a restore they interrupted
    // stops guarding immediately. One that finished on its own keeps the guard
    // for a moment longer, to swallow the `scrollend` it is about to cause.
    restoringUntil = yieldedToUser ? 0 : performance.now() + RESTORE_TAIL_MS;
  };

  const step = (): void => {
    // The user reaching for the page outranks finishing the restore.
    if (userGesture) {
      done(true);
      return;
    }

    const delta = section.getBoundingClientRect().top - offset;
    if (Math.abs(delta) < SETTLE_EPSILON || passes >= SETTLE_PASSES) {
      done(false);
      return;
    }

    const before = window.scrollY;
    window.scrollTo(0, before + delta);
    passes += 1;
    restoringUntil = performance.now() + 400;

    // Clamped against the top or bottom of the document and unable to close the
    // gap. Spinning would not help; this is as close as the page can get.
    if (window.scrollY === before) {
      done(false);
      return;
    }

    requestAnimationFrame(step);
  };

  restoringUntil = performance.now() + 400;
  requestAnimationFrame(step);
}

/**
 * Return to what an entry remembered.
 *
 * The named section is preferred over the raw offset every time it still
 * resolves, because it is the only one of the two that survives the page being
 * measured differently. The offset is what is left when the document has changed
 * out from under the entry.
 */
function restorePosition(state: EntryState): void {
  const section = state.at ? document.getElementById(state.at) : null;

  if (section && typeof state.offset === "number") {
    // A filtered-out or otherwise unrendered section has no position to hold.
    if (section.getClientRects().length > 0) {
      holdSectionAt(section, state.offset);
      return;
    }
  }

  if (typeof state.y === "number") window.scrollTo(0, state.y);
}

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

  refreshGroupToggles();
}

/** Label a group's toggle for what it will do next. */
function setGroupToggle(button: HTMLButtonElement, rowsAreOpen: boolean): void {
  button.dataset["state"] = rowsAreOpen ? "open" : "closed";
  button.textContent = rowsAreOpen ? t().group.collapseAll : t().group.expandAll;
}

/**
 * Re-label every group's toggle from the rows as they now are.
 *
 * Restoring a fold shape opens and closes rows without going through the button,
 * so without this a Back can leave "Collapse all" sitting above a group that is
 * already collapsed. `:not([open])` stops at the first closed row rather than
 * counting them all, which keeps this cheap enough to run on every traversal.
 */
function refreshGroupToggles(): void {
  for (const group of docEl.querySelectorAll<HTMLElement>(".group")) {
    const button = group.querySelector<HTMLButtonElement>(".group__toggle");
    if (button) setGroupToggle(button, group.querySelector(".res__d:not([open])") === null);
  }
}

function rememberState(): void {
  // A restore in progress is scrolling on this module's behalf, and those
  // intermediate positions are not the user's to record.
  if (restoring()) return;

  try {
    const state = (history.state ?? {}) as Record<string, unknown>;
    const open = openRowIds();
    const next: EntryState = { ...state, y: Math.round(window.scrollY) };

    const reference = viewportReference();
    if (reference) {
      next.at = reference.at;
      next.offset = reference.offset;
    } else {
      delete next.at;
      delete next.offset;
    }

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
    if (anchor) {
      rememberState();
      dropPendingRestore();
    }
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
 *
 * What a traversal is has to be *recorded*, not inferred from `history.state`.
 * Reading the state back looked like a tidy way to survive a second settle pass,
 * and it broke arriving at a resource: the entry a fragment navigation pushes
 * starts out stateless, but anything that fires a scroll before the timer runs —
 * closing the jump dialog does — writes a position into it first. That state then
 * reads as a restored fold shape, and a restored shape deliberately leaves rows
 * as they were, so the row just navigated to stayed shut.
 *
 * So: set on `popstate`, cleared by the next forward navigation, and *not*
 * cleared once used, which is what keeps a second pass harmless. The fragment is
 * kept alongside it because a restore only belongs to the URL it was captured
 * for — editing the fragment in the address bar makes a new entry, and the
 * pending restore must not be applied to it.
 */
let pendingRestore: { state: EntryState | null; hash: string } | null = null;
let settleTimer: number | undefined;

/** Forget any traversal still waiting: a new navigation supersedes it. */
function dropPendingRestore(): void {
  pendingRestore = null;
}

function scheduleSettle(): void {
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    const pending =
      pendingRestore && pendingRestore.hash === location.hash ? pendingRestore.state : null;
    resolveHash(pending);
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

/**
 * The resource a DOM node belongs to, via its section's encoded id.
 *
 * `null` for a plain-JSON document by construction, not by accident: that
 * mode never renders a `.res` section, so `parseDomId` — which only ever
 * recognises the `resource` scope — correctly finds nothing to parse.
 */
function resourceOf(node: Element): Resource | null {
  if (!current || current.lens.kind !== "jsonapi") return null;
  const section = node.closest<HTMLElement>(".res");
  const identity = section ? parseDomId(section.id) : null;
  if (!identity) return null;
  return current.lens.index.byKey.get(resourceKey(identity.type, identity.id)) ?? null;
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

interface LoadedView<T> {
  index: T;
  label: string;
  bytes: number;
  text: string;
}

/**
 * The JSON:API document view — unchanged from before `Lens` existed, aside
 * from taking `{index: DocumentIndex, …}` explicitly rather than through the
 * old `Loaded`. "Same resources, same anchors, same overview, same rail" is
 * this function, byte for byte.
 */
function renderDocumentView(loaded: LoadedView<DocumentIndex>, parseMs: number): void {
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
    docEl.replaceChildren(renderRail(railEntriesForGroups(index)), main);
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

/**
 * The plain-JSON document view. Mirrors `renderDocumentView`'s shape —
 * overview, dangling panel, the groups a rail can jump between, then
 * whatever else the document carries — built from `render-document.ts`'s
 * and `render-json.ts`'s pieces rather than a render path of its own.
 */
function renderJsonView(loaded: LoadedView<JsonIndex>, parseMs: number): void {
  const { index } = loaded;
  const started = performance.now();

  const main = el("div", { class: "main" });

  const overview = renderJsonOverview(index, { bytes: loaded.bytes, parseMs });
  overview.append(documentActions());
  main.append(overview);

  const dangling = renderJsonDangling(index);
  if (dangling) main.append(dangling);

  const annotations = buildAnnotations(index);
  main.append(renderJsonGroups(index, annotations));

  const leftover = renderJsonLeftover(index, annotations);
  if (leftover) main.append(leftover);

  const railEntries = railEntriesForCollections(index);
  if (railEntries.length > 0) {
    docEl.classList.remove("doc--no-rail");
    docEl.replaceChildren(renderRail(railEntries), main);
  } else {
    docEl.classList.add("doc--no-rail");
    docEl.replaceChildren(main);
  }

  const renderMs = performance.now() - started;

  showView("doc");
  soloType = null;
  applyFilter();

  topbarLabelEl.textContent = loaded.label;
  topbarStatsEl.textContent = t().shape.stats(index.counts.total, railEntries.length, formatBytes(loaded.bytes));

  console.info("[jsonapi-lens] timings", {
    shape: index.shape,
    items: index.counts.total,
    collections: railEntries.length,
    bytes: loaded.bytes,
    parseAndIndex: formatDuration(parseMs),
    render: formatDuration(renderMs),
  });

  applyPageMeta(documentMeta(loaded.label));
}

/** Dispatches on which half of `Lens` was read, so every other call site just calls this. */
function renderLoadedView(loaded: Loaded, parseMs: number): void {
  const view = { label: loaded.label, bytes: loaded.bytes, text: loaded.text };
  if (loaded.lens.kind === "jsonapi") renderDocumentView({ index: loaded.lens.index, ...view }, parseMs);
  else renderJsonView({ index: loaded.lens.index, ...view }, parseMs);
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
    if (current && current.lens.kind === "jsonapi") fillBody(details, current.lens.index);
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

  const value = resolvePointer(current.lens.index.root, pointer);
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
    // Decided from the rows, not from what this button last did. Folding happens
    // by other routes too — a row opened by hand, a row opened on arrival, a Back
    // restoring a whole shape — and a button that trusts its own memory ends up
    // doing the opposite of its label, or apparently nothing at all.
    const opening = group.querySelector(".res__d:not([open])") !== null;
    for (const row of group.querySelectorAll<HTMLDetailsElement>(".res__d")) row.open = opening;
    setGroupToggle(expand, opening);
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
    value: current.lens.index.root,
    filename: safeFilename(current.label),
  });
}

function shareDocument(): void {
  if (!current) return;
  openShareModal(current.text, current.label);
}

/**
 * The three summary fields a `LibraryEntry` row shows, computed from
 * whichever `Lens` is open. `store.ts` only ever serialises these — it does
 * not interpret them — so widening what feeds them is a `main.ts` change,
 * not a schema one; see `docs/STATUS.md` §1a for why that split matters this
 * wave.
 */
function librarySummary(lens: Lens): Pick<LibraryEntry, "resources" | "types" | "shape"> {
  if (lens.kind === "jsonapi") {
    const index = lens.index;
    return {
      resources: index.counts.total,
      types: index.groups.length,
      shape: index.primaryIsNull
        ? "data: null"
        : index.errors.length
          ? `errors[${index.errors.length}]`
          : index.primary.length === 1
            ? "data{1}"
            : `data[${index.primary.length}]`,
    };
  }

  const index = lens.index;
  const collections = index.collections.filter((c) => c.topLevel).length;
  return {
    resources: index.counts.total,
    types: collections,
    shape: collections > 0 ? `${index.shape}[${collections}]` : index.shape,
  };
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
      ...librarySummary(loaded.lens),
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
  /**
   * Read strictly as JSON:API — `readDocument`, unchanged — rather than
   * through `readAny`. This is "Read as JSON:API anyway": the escape hatch
   * for a near-miss document that `detectShape` would not read as `jsonapi`
   * on its own, so it can still throw `assertJsonApi`'s own rejection.
   */
  forceJsonApi?: boolean;
  /**
   * A `Lens` already computed for this exact `text` — the shape-offer flow's
   * two buttons pass the one `submitPastedText` already built, so accepting
   * the offer never means classifying the document a second time.
   */
  lens?: Lens;
}

async function load(text: string, label: string, options: LoadOptions): Promise<boolean> {
  hideError();
  hideShapeOffer();

  const bytes = new TextEncoder().encode(text).byteLength;
  const started = performance.now();

  let lens: Lens;
  try {
    lens = options.lens ?? (options.forceJsonApi ? { kind: "jsonapi", index: readDocument(text) } : readAny(text));
  } catch (error) {
    showView("paste");
    showError(error);
    return false;
  }

  const parseMs = performance.now() - started;
  current = { lens, label, bytes, text };

  if (options.persist) {
    // A fresh document invalidates any fragment from the previous one, and the
    // document view lives at /view.
    if (options.push) navigate(VIEW_PATH);
    else navigate(VIEW_PATH, { replace: true });
  }

  // A different document invalidates any traversal still waiting to be applied:
  // its remembered rows and its anchor belong to the document being replaced.
  dropPendingRestore();

  renderLoadedView(current, parseMs);

  if (options.persist) {
    window.scrollTo(0, 0);
    const saved = await saveDocument({ text, savedAt: Date.now(), label });
    if (!saved) toast(t().toast.notStored);
  }

  return true;
}

/**
 * The one place text arrives as a fresh submission — the textarea, a dropped
 * or opened file — rather than a document already known to be resolved
 * (a saved entry, the last session's document, a share link). Classifies
 * once and either reads straight through (`jsonapi`, or nothing to ask about)
 * or hands the classification to the shape-offer banner, so the two buttons
 * there act on the exact `Lens` this found rather than reclassifying.
 */
function submitPastedText(text: string, label: string): void {
  hideError();
  hideShapeOffer();

  let lens: Lens;
  try {
    lens = readAny(text);
  } catch (error) {
    showView("paste");
    showError(error);
    return;
  }

  if (lens.kind === "jsonapi") {
    void load(text, label, { persist: true, push: true, lens });
    return;
  }

  showShapeOffer(text, label, lens.index);
}

function loadFromInput(): void {
  const text = inputEl.value;
  if (!text.trim()) {
    showError(
      new DocumentError(t().parseErrors.nothingYet.headline, t().parseErrors.nothingYet.hint),
    );
    return;
  }
  submitPastedText(text, t().labels.pastedDocument);
}

/* ----------------------------------------------------------- paste view --- */

function updateDropMeta(): void {
  const length = inputEl.value.length;
  dropMetaEl.textContent = length ? t().paste.characters(length) : "";
}

inputEl.addEventListener("input", () => {
  updateDropMeta();
  hideError();
  hideShapeOffer();
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

shapeOfferPlainEl.addEventListener("click", () => {
  if (!pendingOffer) return;
  const { text, label } = pendingOffer;
  void load(text, label, { persist: true, push: true });
});

shapeOfferJsonApiEl.addEventListener("click", () => {
  if (!pendingOffer) return;
  const { text, label } = pendingOffer;
  void load(text, label, { persist: true, push: true, forceJsonApi: true });
});

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
    submitPastedText(text, file.name);
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
      // The resource finder is a `{type, id}` search — jump.ts is out of
      // T1's scope to extend, and a plain-JSON document has no `type` to
      // search by, so the shortcut is quietly a no-op there rather than
      // opening a dialog that could never match anything.
      if (current && current.lens.kind === "jsonapi") {
        event.preventDefault();
        openJumpModal(current.lens.index);
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
    // Opening IndexedDB is slow enough to lose a race with a person: a document
    // pasted while that await was pending is already rendered and already owns
    // the view, and continuing here would put the paste view back over it.
    if (current) {
      showView("doc");
      return;
    }
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
  pendingRestore = { state: (event.state as EntryState | null) ?? null, hash: location.hash };
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

  // Reading IndexedDB takes long enough that a document can be pasted before it
  // finishes — most easily on a cold profile, where opening the database is
  // slowest. That document is rendered and showing by now, so boot has nothing
  // left to do: falling through would replace it with the paste view and look
  // exactly like the paste having been ignored.
  if (current) return;

  showView("paste");

  if (!stored) {
    resumeEl.hidden = true;
    return;
  }

  inputEl.value = stored.text;
  updateDropMeta();

  // Parse *and render* it so "Back to document" is instant, but stay on the
  // paste view. Pre-existing bug, reproduced on the unmodified base commit
  // and fixed here because this is the function that already needed
  // rewriting for `readAny`: this branch used to set `current` and call
  // `offerResume()` without ever rendering into `docEl`, so a document
  // stored from an earlier session, reloaded fresh on `/`, showed a
  // completely blank document view the moment "Back to document" was
  // clicked — `showView("doc")` reveals `docEl`, and nothing had ever put
  // anything there. Rendering now and folding back to the paste view with a
  // second `showView`/`applyRouteMeta` call keeps the visible screen and the
  // page's own metadata matching what is actually on it, while leaving
  // `docEl` already populated for whenever "Back to document" is clicked.
  //
  // `readAny` rather than `readDocument`: a stored document is one that was
  // already read successfully once — including a plain-JSON one — and this
  // is a restore, not a fresh submission, so there is no shape offer to show
  // here even if the shape is not `jsonapi`.
  try {
    const started = performance.now();
    const lens = readAny(stored.text);
    const parseMs = performance.now() - started;
    current = {
      lens,
      label: stored.label ?? t().labels.storedDocument,
      bytes: new TextEncoder().encode(stored.text).byteLength,
      text: stored.text,
    };
    renderLoadedView(current, parseMs);
    showView("paste");
    applyRouteMeta({ kind: "paste" });
    offerResume();
  } catch {
    // A stored document that no longer parses is not worth blocking the paste
    // view over; it stays in the textarea so it can be fixed by hand.
    resumeEl.hidden = true;
  }
}

void refreshLibraryCount();
void boot();
