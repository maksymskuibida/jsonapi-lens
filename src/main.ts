import "@fontsource-variable/martian-mono";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

import { formatBytes, formatDuration } from "./format.js";
import { parseDomId, resourceKey } from "./ident.js";
import { DocumentError, readDocument } from "./parse.js";
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
import { clearDocument, loadDocument, saveDocument } from "./store.js";
import type { DocumentIndex } from "./types.js";

import sampleRail from "./samples/rail.json?raw";
import sampleDangling from "./samples/dangling.json?raw";
import sampleErrors from "./samples/errors.json?raw";
import sampleEdge from "./samples/edge.json?raw";

const SAMPLES: Record<string, { text: string; label: string }> = {
  rail: { text: sampleRail, label: "rail-booking.json" },
  dangling: { text: sampleDangling, label: "missing-include.json" },
  errors: { text: sampleErrors, label: "error-response.json" },
  edge: { text: sampleEdge, label: "awkward-ids.json" },
};

/* ------------------------------------------------------------- elements --- */

const need = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
};

const bootEl = need("boot");
const pasteEl = need("paste");
const docEl = need("doc");
const inputEl = need<HTMLTextAreaElement>("input");
const dropEl = need("drop");
const dropMetaEl = need("drop-meta");
const fileEl = need<HTMLInputElement>("file");
const toastEl = need("toast");
const errorEl = need("error");
const errorHeadlineEl = need("error-headline");
const errorHintEl = need("error-hint");
const errorWhereEl = need("error-where");
const newDocEl = need<HTMLButtonElement>("new-doc");
const topbarDocEl = need("topbar-doc");
const topbarLabelEl = need("topbar-label");
const topbarStatsEl = need("topbar-stats");
const themeEl = need<HTMLButtonElement>("theme-toggle");

/* ---------------------------------------------------------------- state --- */

interface Loaded {
  index: DocumentIndex;
  label: string;
  bytes: number;
}

let current: Loaded | null = null;
let soloType: string | null = null;

/* ---------------------------------------------------------------- theme --- */

type Theme = "auto" | "light" | "dark";
const THEME_KEY = "jsonapi-lens:theme";

function applyTheme(theme: Theme): void {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
  themeEl.textContent = `Theme: ${theme}`;
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

/* ---------------------------------------------------------------- toast --- */

let toastTimer: number | undefined;

function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("is-visible"), 3200);
}

/* ----------------------------------------------------------- view state --- */

function showView(which: "boot" | "paste" | "doc"): void {
  bootEl.hidden = which !== "boot";
  pasteEl.hidden = which !== "paste";
  docEl.hidden = which !== "doc";
  newDocEl.hidden = which !== "doc";
  topbarDocEl.hidden = which !== "doc";
}

function showError(error: unknown): void {
  const documentError =
    error instanceof DocumentError
      ? error
      : new DocumentError(
          "Something went wrong reading that document.",
          error instanceof Error ? error.message : String(error),
        );

  errorHeadlineEl.textContent = documentError.headline;
  errorHintEl.textContent = documentError.hint;
  if (documentError.line !== undefined) {
    errorWhereEl.textContent = `around line ${documentError.line}`;
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
 * The target is always scrolled into position here, even when the browser has
 * just done it. Opening a row grows the page below it, which stales the scroll
 * offsets the browser saved for later history entries — so a Back or Forward
 * into one of those would land a row or two off. Re-scrolling to the fragment
 * makes every landing deterministic: an entry with a hash always lands on that
 * hash, whatever the layout did in between.
 *
 * The highlight needs no help from here. `:target` is resolved against the
 * document's current fragment, and it starts matching as soon as an element
 * with that id exists — including one inserted long after the initial
 * navigation. Only the scroll has to be redone, because the browser's own
 * scroll-to-fragment ran while the document was still empty.
 */
function resolveHash(): void {
  const raw = location.hash;
  if (!raw || raw === "#") return;

  let fragment = raw.slice(1);
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    /* keep the raw fragment if it is not valid percent-encoding */
  }

  const target = document.getElementById(fragment);
  if (!target) {
    const identity = parseDomId(fragment);
    if (identity) {
      toast(`No ${identity.type} with id ${identity.id} in this document.`);
    }
    return;
  }

  // A filtered-out group cannot be scrolled to, so a link into one clears the
  // filter rather than silently doing nothing.
  const group = target.closest<HTMLElement>(".group");
  if (group?.hasAttribute("data-filtered")) {
    setSolo(null);
    toast(`Showing all types so ${group.dataset["type"]} could be reached.`);
  }

  // Open before scrolling, so the scroll lands against final layout.
  if (target.classList.contains("res")) openSection(target);
  target.scrollIntoView({ block: "start" });
}

window.addEventListener("hashchange", resolveHash);

/* --------------------------------------------------------------- render --- */

function fillBody(details: HTMLDetailsElement, index: DocumentIndex): void {
  const body = details.querySelector<HTMLElement>(".res__body");
  if (!body || !body.hasAttribute("data-pending")) return;

  const section = details.closest<HTMLElement>(".res");
  const identity = section ? parseDomId(section.id) : null;
  if (!identity) return;

  const resource = index.byKey.get(resourceKey(identity.type, identity.id));
  if (!resource) return;

  body.removeAttribute("data-pending");
  body.append(buildResourceBody(resource, index));
}

function renderDocumentView(loaded: Loaded, parseMs: number): void {
  const { index } = loaded;
  const started = performance.now();

  const main = document.createElement("div");
  main.className = "main";

  main.append(renderOverview(index, { bytes: loaded.bytes, parseMs }));

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
  const groups = document.createElement("div");
  groups.className = "groups";
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
  topbarStatsEl.textContent = `${index.counts.total.toLocaleString()} resources · ${index.groups.length} types · ${formatBytes(loaded.bytes)}`;

  // Numbers worth having in front of you when a payload feels slow.
  console.info("[jsonapi-lens] timings", {
    resources: index.counts.total,
    types: index.groups.length,
    bytes: loaded.bytes,
    parseAndIndex: formatDuration(parseMs),
    render: formatDuration(renderMs),
    bodies: eager ? "eager" : "lazy (on expand)",
  });

  document.title = `${loaded.label} — jsonapi-lens`;
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

docEl.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

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
    expand.textContent = opening ? "Collapse all" : "Expand all";
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

/* ------------------------------------------------------------- loading --- */

async function load(text: string, label: string, options: { persist: boolean }): Promise<void> {
  hideError();

  const bytes = new TextEncoder().encode(text).byteLength;
  const started = performance.now();

  let index: DocumentIndex;
  try {
    index = readDocument(text);
  } catch (error) {
    showView("paste");
    showError(error);
    return;
  }

  const parseMs = performance.now() - started;
  current = { index, label, bytes };

  renderDocumentView(current, parseMs);

  if (options.persist) {
    // The paste view may have been scrolled — the sample buttons are below the
    // fold — and swapping views keeps the document's scroll offset. A freshly
    // read document should start at the top. The boot path passes
    // `persist: false` and resolves the hash itself, so it is left alone.
    window.scrollTo(0, 0);

    // A fresh document invalidates any fragment from the previous one.
    history.replaceState(null, "", location.pathname + location.search);
    const saved = await saveDocument({ text, savedAt: Date.now(), label });
    if (!saved) {
      toast("This document could not be stored, so a reload will lose it.");
    }
  }
}

function loadFromInput(): void {
  const text = inputEl.value;
  if (!text.trim()) {
    showError(
      new DocumentError("Nothing to read yet.", "Paste a JSON:API document, or drop a file."),
    );
    return;
  }
  void load(text, "pasted document", { persist: true });
}

/* ----------------------------------------------------------- paste view --- */

function updateDropMeta(): void {
  const length = inputEl.value.length;
  dropMetaEl.textContent = length ? `${length.toLocaleString()} characters` : "";
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
    await load(text, file.name, { persist: true });
  } catch {
    showError(
      new DocumentError("That file could not be read.", "Try opening it and pasting the contents."),
    );
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-sample]")) {
  button.addEventListener("click", () => {
    const sample = SAMPLES[button.dataset["sample"] ?? ""];
    if (!sample) return;
    inputEl.value = sample.text;
    updateDropMeta();
    void load(sample.text, sample.label, { persist: true });
  });
}

/* Drag and drop. `dragover` must be cancelled or the browser navigates away. */
let dragDepth = 0;

dropEl.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth++;
  dropEl.classList.add("is-dragging");
});

dropEl.addEventListener("dragover", (event) => {
  event.preventDefault();
});

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

newDocEl.addEventListener("click", () => {
  void clearDocument();
  current = null;
  soloType = null;
  docEl.replaceChildren();
  inputEl.value = "";
  updateDropMeta();
  history.replaceState(null, "", location.pathname + location.search);
  document.title = "jsonapi-lens — follow the pointer";
  showView("paste");
  inputEl.focus();
});

/* ------------------------------------------------------------------ boot -- */

async function boot(): Promise<void> {
  const stored = await loadDocument();

  if (!stored) {
    showView("paste");
    // A deep link with no document behind it should say so rather than sit blank.
    if (location.hash && location.hash !== "#") {
      const identity = parseDomId(location.hash.slice(1));
      toast(
        identity
          ? `That link points at ${identity.type} ${identity.id}, but no document is loaded yet.`
          : "No document is loaded yet.",
      );
    }
    return;
  }

  inputEl.value = stored.text;
  updateDropMeta();
  await load(stored.text, stored.label ?? "stored document", { persist: false });

  // The browser tried to scroll to the fragment before any of this existed, so
  // that attempt hit nothing. Now that the sections are in the DOM, resolve it.
  if (current) resolveHash();
}

void boot();
