import { copyBlob, downloadText } from "./clipboard.js";
import { el } from "./dom.js";
import { formatBytes } from "./format.js";
import { t } from "./i18n/index.js";
import { resolveSelection } from "./bundle.js";
import { browserNavKeys, IS_APPLE, MOD_KEY } from "./platform.js";
import type { KeyHint } from "./platform.js";
import { openBundleShareModal, openShareModal } from "./share.js";
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

  const copy = el("button", { class: "btn btn--primary", type: "button", text: t().raw.copyJson });
  copy.dataset["autofocus"] = "true";
  copy.addEventListener("click", () => void copyBlob(text, t().copyKinds.json));

  const download = el("button", { class: "btn", type: "button", text: t().raw.download });
  download.addEventListener("click", () => {
    downloadText(text, options.filename);
    toast(t().toast.downloading(options.filename));
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
  if (seconds < 60) return t().library.justNow;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t().library.minutesAgo(minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t().library.hoursAgo(hours);
  const days = Math.round(hours / 24);
  if (days < 30) return t().library.daysAgo(days);
  return t().library.savedOn(epochMs);
}

/** The name/shape/size/age block shared by a list row and a selection row. */
function rowMeta(entry: LibraryEntry): HTMLElement {
  return el(
    "span",
    { class: "library__meta" },
    // All three of shape/resources/types are absent for a document whose
    // lens has no resource/type concept — a plain-JSON reading, or a v2
    // entry from before that lens existed. Each is omitted rather than
    // shown empty or as zero: `el`'s `text` silently skips `undefined`,
    // which for `shape` alone would still emit an empty `<code>` — a stray
    // flex child, not "nothing to report" the way omitting the element
    // entirely is.
    entry.shape !== undefined ? el("code", { class: "library__shape", text: entry.shape }) : null,
    entry.resources !== undefined ? el("span", { text: t().library.resources(entry.resources) }) : null,
    entry.types !== undefined ? el("span", { text: t().library.types(entry.types) }) : null,
    el("span", { text: formatBytes(entry.bytes) }),
    el("span", { class: "library__when", text: relativeTime(entry.savedAt) }),
  );
}

export async function openLibraryModal(
  onOpen: (entry: LibraryEntry) => void,
  onChange: () => void = () => {},
): Promise<void> {
  const entries = await listLibrary();

  const body = el("div", { class: "library" });
  const footer = el("div", { class: "modal__actions" });

  // Selection mode, entered from the `Share` button in the footer below.
  // `docs/task-specs/T6.md` §"Selection mode": every row gains a checkbox
  // and its own Open/Rename/Delete controls disappear, because in this mode
  // a click on the row means "select" — two meanings for one click is how a
  // document gets lost.
  let mode: "list" | "select" = "list";
  const selected = new Set<number>();
  let latestList: LibraryEntry[] = entries;

  const enterSelect = (): void => {
    mode = "select";
    selected.clear();
    render(latestList);
  };

  const leaveSelect = (): void => {
    mode = "list";
    selected.clear();
    render(latestList);
    // The control just under focus is gone the moment list mode redraws the
    // footer; the button that re-enters selection mode is the sensible place
    // to land, and `render` just rebuilt it into `footer` above.
    footer.querySelector<HTMLButtonElement>("[data-role='library-share']")?.focus();
  };

  async function createLinkFromSelection(): Promise<void> {
    const cachedById = new Map<number, LibraryEntry>();
    for (const entry of latestList) {
      if (entry.id !== undefined) cachedById.set(entry.id, entry);
    }
    const { found, missingLabels } = await resolveSelection([...selected], cachedById);

    if (missingLabels.length > 0) {
      toast(t().bundleUi.selectionMissing(missingLabels.join(", ")), "error");
    }
    if (found.length === 0) return;

    if (found.length === 1) openShareModal(found[0]!.text, found[0]!.label, found[0]!.exchange);
    else openBundleShareModal(found);
  }

  const render = (list: LibraryEntry[]): void => {
    latestList = list;

    if (!list.length) {
      body.replaceChildren(
        el(
          "div",
          { class: "library__empty" },
          el("p", { class: "library__empty-title", text: t().library.emptyTitle }),
          el("p", { class: "library__empty-hint" }, t().library.emptyHint),
        ),
      );
      // Nothing to select, and nothing to share — see the task spec's edge
      // case table: an empty library shows no `Share` button at all.
      footer.replaceChildren();
      return;
    }

    const rows = el("ul", { class: "library__list" });

    if (mode === "list") {
      for (const entry of list) {
        const row = el("li", { class: "library__row" });

        const openButton = el(
          "button",
          { class: "library__open", type: "button", title: t().library.open(entry.label) },
          el("span", { class: "library__name", text: entry.label }),
          rowMeta(entry),
        );
        openButton.addEventListener("click", () => onOpen(entry));

        const rename = el("button", {
          class: "act",
          type: "button",
          title: t().library.renameTitle,
          "aria-label": t().library.renameLabel(entry.label),
          text: t().library.rename,
        });
        rename.addEventListener("click", async () => {
          const next = window.prompt(t().library.renamePrompt, entry.label);
          if (next === null) return;
          const trimmed = next.trim();
          if (!trimmed) return;
          if (entry.id !== undefined && (await renameInLibrary(entry.id, trimmed))) {
            entry.label = trimmed;
            render(list);
            onChange();
            toast(t().library.renamed(trimmed));
          } else {
            toast(t().library.renameFailed, "error");
          }
        });

        const remove = el("button", {
          class: "act act--danger",
          type: "button",
          title: t().library.deleteTitle,
          "aria-label": t().library.deleteLabel(entry.label),
          text: t().library.delete,
        });
        remove.addEventListener("click", async () => {
          if (!window.confirm(t().library.deleteConfirm(entry.label))) return;
          if (entry.id !== undefined && (await deleteFromLibrary(entry.id))) {
            const remaining = list.filter((e) => e.id !== entry.id);
            render(remaining);
            onChange();
            toast(t().library.deleted(entry.label));
          } else {
            toast(t().library.deleteFailed, "error");
          }
        });

        row.append(openButton, el("div", { class: "library__row-actions" }, rename, remove));
        rows.append(row);
      }

      const shareButton = el("button", {
        class: "btn",
        type: "button",
        "data-role": "library-share",
        text: t().bundleUi.shareButton,
      });
      shareButton.addEventListener("click", enterSelect);
      footer.replaceChildren(shareButton);
    } else {
      const hint = el("p", { class: "bundle-hint" });
      const createButton = el("button", {
        class: "btn btn--primary",
        type: "button",
        text: t().share.create,
      });

      const updateCreateState = (): void => {
        const n = selected.size;
        createButton.disabled = n === 0;
        hint.hidden = n !== 0;
        hint.textContent = n === 0 ? t().bundleUi.tickToShare : "";
      };

      for (const entry of list) {
        if (entry.id === undefined) continue; // never true for a row `listLibrary()` returned
        const row = el("li", { class: "library__row" });

        const checkbox = el("input", {
          type: "checkbox",
          class: "library__checkbox",
          "aria-label": t().bundleUi.selectRow(entry.label),
        }) as HTMLInputElement;
        checkbox.checked = selected.has(entry.id);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(entry.id!);
          else selected.delete(entry.id!);
          updateCreateState();
        });

        row.append(
          el(
            "label",
            { class: "library__select" },
            checkbox,
            el(
              "span",
              { class: "library__select-text" },
              el("span", { class: "library__name", text: entry.label }),
              rowMeta(entry),
            ),
          ),
        );
        rows.append(row);
      }

      updateCreateState();

      const cancelButton = el("button", { class: "btn", type: "button", text: t().bundleUi.cancel });
      cancelButton.addEventListener("click", leaveSelect);
      createButton.addEventListener("click", () => void createLinkFromSelection());

      footer.replaceChildren(hint, el("div", { class: "modal__actions" }, cancelButton, createButton));
    }

    body.replaceChildren(rows);
  };

  render(entries);

  // Escape has two jobs here, and only one of them belongs to `ui.ts`'s own
  // modal handler: the first Escape leaves selection mode without closing
  // the modal (the smaller step undoes first), and only a second Escape
  // closes it. `ui.ts` registers its own Escape handler, also on `document`
  // in the capture phase, inside `openModal` below — registering this one
  // first and calling `stopImmediatePropagation` is what lets this run
  // ahead of it and suppress it for exactly the one case that needs to.
  const onKeydownCapture = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.shiftKey) return;
    if (mode !== "select") return; // second Escape: let ui.ts close the modal
    event.preventDefault();
    event.stopImmediatePropagation();
    leaveSelect();
  };
  document.addEventListener("keydown", onKeydownCapture, true);

  const handle = openModal({
    title: t().library.title,
    subtitle: entries.length
      ? t().library.countInBrowser(entries.length)
      : t().library.storedLocally,
    body,
    footer,
    variant: "tall",
  });

  const closeModal = handle.close;
  handle.close = () => {
    document.removeEventListener("keydown", onKeydownCapture, true);
    closeModal();
  };
}

/** Ask for a name before saving. */
export function openSaveModal(defaultLabel: string, onSave: (label: string) => void): void {
  const input = el("input", {
    class: "field",
    type: "text",
    value: defaultLabel,
    "aria-label": t().save.nameLabel,
    spellcheck: false,
  });
  input.dataset["autofocus"] = "true";

  const save = el("button", { class: "btn btn--primary", type: "button", text: t().save.save });

  const submit = (handleClose: () => void) => () => {
    const label = input.value.trim() || defaultLabel;
    handleClose();
    onSave(label);
  };

  openModal({
    title: t().save.title,
    subtitle: t().save.subtitle,
    body: el(
      "div",
      { class: "save" },
      el("label", { class: "save__label", text: t().save.nameLabel }),
      input,
      el("p", { class: "save__hint" }, t().save.hint),
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
 *
 * Back and Forward are the exception, and they are listed in their own section
 * below. They are also the browser's rather than this app's, but they are how
 * you walk back up a relationship chain — the single most useful key in the
 * app — and their spelling depends on the OS, so leaving them out taught nobody
 * anything.
 */
function appShortcuts(): KeyHint[] {
  const m = t().shortcuts;
  return [
    { combos: ["?"], description: m.showList },
    { combos: ["/", "g"], description: m.find },
    { combos: ["s"], description: m.saveDocument },
    { combos: ["r"], description: m.rawDocument },
    { combos: ["e"], description: m.exportDocument },
    { combos: ["l"], description: m.openLibrary },
    { combos: ["Shift + Esc"], description: m.leaveDocument },
    { combos: ["Esc"], description: m.closeDialog },
    { combos: [`${MOD_KEY} + Enter`], description: m.readPasted },
  ];
}

/** The browser's own keys: spelling from `platform.ts`, words from here. */
function browserShortcuts(): KeyHint[] {
  const m = t().shortcuts;
  const described: Record<string, string> = {
    back: m.browserBack,
    forward: m.browserForward,
    newTab: m.browserNewTab,
  };
  return browserNavKeys().map(({ id, combos }) => ({ combos, description: described[id] ?? id }));
}

/** One `dl` of key/description rows. */
function keyList(hints: KeyHint[]): HTMLElement {
  const list = el("dl", { class: "keys" });
  for (const { combos, description } of hints) {
    const dt = el("dt", { class: "keys__key" });
    combos.forEach((combo, comboIndex) => {
      if (comboIndex > 0) dt.append(el("span", { class: "keys__or", text: t().shortcuts.or }));
      combo.split(" + ").forEach((part, index) => {
        if (index > 0) dt.append(el("span", { class: "keys__plus", text: "+" }));
        dt.append(el("kbd", { text: part }));
      });
    });
    list.append(dt, el("dd", { class: "keys__desc", text: description }));
  }
  return list;
}

function group(title: string, body: Node, ...notes: string[]): HTMLElement {
  return el(
    "section",
    { class: "keys-group" },
    el("h3", { class: "keys-group__title", text: title }),
    body,
    ...notes.map((note) => el("p", { class: "keys-group__note", text: note })),
  );
}

export function openShortcutsModal(): void {
  openModal({
    title: t().shortcuts.title,
    body: el(
      "div",
      { class: "keys-groups" },
      group(t().shortcuts.inThisApp, keyList(appShortcuts())),
      group(
        t().shortcuts.fromBrowser(IS_APPLE),
        keyList(browserShortcuts()),
        t().shortcuts.historyNote,
        t().shortcuts.pointerNote(IS_APPLE),
        t().shortcuts.otherPlatformNote(IS_APPLE),
      ),
    ),
  });
}
