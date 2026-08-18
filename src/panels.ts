import { copyBlob, downloadText } from "./clipboard.js";
import { el } from "./dom.js";
import { formatBytes } from "./format.js";
import { deleteFromLibrary, listLibrary, renameInLibrary } from "./store.js";
import type { LibraryEntry } from "./store.js";
import { openModal, toast } from "./ui.js";

/* ------------------------------------------------------------- raw view --- */

/**
 * Show a JSON value exactly as it appears in the document.
 *
 * The typed view is easier to read, but sometimes the question is "what did the
 * server literally send" — key order, a stringified number, a field the typed
 * view folded away. This is the escape hatch, with copy and download so the
 * fragment can go straight into a test fixture.
 */
export function openRawModal(options: {
  title: string;
  subtitle?: string;
  value: unknown;
  filename: string;
}): void {
  const text = JSON.stringify(options.value, null, 2);

  const pre = el("pre", { class: "raw", tabindex: "0" }, el("code", { text }));

  const copy = el("button", { class: "btn btn--primary", type: "button", text: "Copy JSON" });
  copy.dataset["autofocus"] = "true";
  copy.addEventListener("click", () => void copyBlob(text, "JSON"));

  const download = el("button", { class: "btn", type: "button", text: "Download" });
  download.addEventListener("click", () => {
    downloadText(text, options.filename);
    toast(`Downloading ${options.filename}`);
  });

  openModal({
    title: options.title,
    subtitle: options.subtitle
      ? `${options.subtitle} · ${formatBytes(new TextEncoder().encode(text).byteLength)}`
      : formatBytes(new TextEncoder().encode(text).byteLength),
    body: pre,
    footer: el("div", { class: "modal__actions" }, copy, download),
    variant: "wide",
  });
}

/* -------------------------------------------------------------- library --- */

function relativeTime(epochMs: number): string {
  const seconds = Math.round((Date.now() - epochMs) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(epochMs).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export async function openLibraryModal(
  onOpen: (entry: LibraryEntry) => void,
  onChange: () => void = () => {},
): Promise<void> {
  const entries = await listLibrary();

  const body = el("div", { class: "library" });

  const render = (list: LibraryEntry[]): void => {
    if (!list.length) {
      body.replaceChildren(
        el(
          "div",
          { class: "library__empty" },
          el("p", { class: "library__empty-title", text: "Nothing saved yet." }),
          el(
            "p",
            { class: "library__empty-hint" },
            "Open a document and choose Save to keep it here. Saved documents stay in this browser — they are never uploaded.",
          ),
        ),
      );
      return;
    }

    const rows = el("ul", { class: "library__list" });

    for (const entry of list) {
      const row = el("li", { class: "library__row" });

      const openButton = el(
        "button",
        { class: "library__open", type: "button", title: `Open ${entry.label}` },
        el("span", { class: "library__name", text: entry.label }),
        el(
          "span",
          { class: "library__meta" },
          el("code", { class: "library__shape", text: entry.shape }),
          el("span", { text: `${entry.resources.toLocaleString()} resources` }),
          el("span", { text: `${entry.types} types` }),
          el("span", { text: formatBytes(entry.bytes) }),
          el("span", { class: "library__when", text: relativeTime(entry.savedAt) }),
        ),
      );
      openButton.addEventListener("click", () => onOpen(entry));

      const rename = el("button", {
        class: "act",
        type: "button",
        title: "Rename",
        "aria-label": `Rename ${entry.label}`,
        text: "rename",
      });
      rename.addEventListener("click", async () => {
        const next = window.prompt("New name for this document", entry.label);
        if (next === null) return;
        const trimmed = next.trim();
        if (!trimmed) return;
        if (entry.id !== undefined && (await renameInLibrary(entry.id, trimmed))) {
          entry.label = trimmed;
          render(list);
          onChange();
          toast(`Renamed to ${trimmed}`);
        } else {
          toast("Could not rename that document.", "error");
        }
      });

      const remove = el("button", {
        class: "act act--danger",
        type: "button",
        title: "Delete",
        "aria-label": `Delete ${entry.label}`,
        text: "delete",
      });
      remove.addEventListener("click", async () => {
        if (!window.confirm(`Delete "${entry.label}" from your saved documents?`)) return;
        if (entry.id !== undefined && (await deleteFromLibrary(entry.id))) {
          const remaining = list.filter((e) => e.id !== entry.id);
          render(remaining);
          onChange();
          toast(`Deleted ${entry.label}`);
        } else {
          toast("Could not delete that document.", "error");
        }
      });

      row.append(openButton, el("div", { class: "library__row-actions" }, rename, remove));
      rows.append(row);
    }

    body.replaceChildren(rows);
  };

  render(entries);

  openModal({
    title: "Saved documents",
    subtitle: entries.length
      ? `${entries.length} in this browser`
      : "Stored locally in this browser",
    body,
    variant: "tall",
  });
}

/** Ask for a name before saving. */
export function openSaveModal(defaultLabel: string, onSave: (label: string) => void): void {
  const input = el("input", {
    class: "field",
    type: "text",
    value: defaultLabel,
    "aria-label": "Name",
    spellcheck: false,
  });
  input.dataset["autofocus"] = "true";

  const save = el("button", { class: "btn btn--primary", type: "button", text: "Save" });

  const submit = (handleClose: () => void) => () => {
    const label = input.value.trim() || defaultLabel;
    handleClose();
    onSave(label);
  };

  openModal({
    title: "Save this document",
    subtitle: "Kept in this browser only",
    body: el(
      "div",
      { class: "save" },
      el("label", { class: "save__label", text: "Name" }),
      input,
      el(
        "p",
        { class: "save__hint" },
        "Saved documents live in this browser's IndexedDB. Clearing site data removes them.",
      ),
    ),
    footer: (handle) => {
      save.addEventListener("click", submit(handle.close));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submit(handle.close)();
        }
      });
      return el("div", { class: "modal__actions" }, save);
    },
  });

  input.select();
}

/* ------------------------------------------------------------ shortcuts --- */

/**
 * Only what this app actually binds.
 *
 * Tab, Enter/Space on a focused row and the browser's own find were listed here
 * once. They all work, but they work because the markup is ordinary HTML — not
 * because anything here implements them. Listing them made the app look like it
 * had done something, and made the real bindings harder to find.
 */
const SHORTCUTS: [string[], string][] = [
  [["?"], "Show this list"],
  [["/", "g"], "Find a resource by type or id"],
  [["s"], "Save the document to this browser"],
  [["r"], "Show the whole document as raw JSON"],
  [["e"], "Export the document to a file"],
  [["l"], "Open saved documents"],
  [["Shift + Esc"], "Leave the document and go back to the paste view"],
  [["Esc"], "Close a dialog"],
  [["⌘/Ctrl + Enter"], "Read the pasted document"],
];

export function openShortcutsModal(): void {
  const list = el("dl", { class: "keys" });
  for (const [combos, description] of SHORTCUTS) {
    const dt = el("dt", { class: "keys__key" });
    combos.forEach((combo, comboIndex) => {
      if (comboIndex > 0) dt.append(el("span", { class: "keys__or", text: "or" }));
      combo.split(" + ").forEach((part, index) => {
        if (index > 0) dt.append(el("span", { class: "keys__plus", text: "+" }));
        dt.append(el("kbd", { text: part }));
      });
    });
    list.append(dt, el("dd", { class: "keys__desc", text: description }));
  }

  openModal({
    title: "Keyboard shortcuts",
    body: list,
  });
}
