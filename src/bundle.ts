/**
 * Sharing several saved documents at once, and importing them back.
 *
 * T5 built the version-3 envelope (`BundlePayload`/`BundleEntry` in
 * `crypto.ts`) but deliberately shipped no UI for it — this module and the
 * selection mode added to `openLibraryModal` in `panels.ts` are that UI. It
 * is a separate module rather than more of `panels.ts` because the bundle
 * import view is a full view (reached when a share link decrypts to a
 * bundle), not a modal, and because the logic here — which envelope version
 * a selection mints, which library entries a set of ids still resolves to,
 * which bundle entries are already saved — has nothing to do with rendering
 * a modal and is exactly the kind of thing that should be testable without
 * building one.
 *
 * ## Why minting stays out of `share.ts`'s hands until the last step
 *
 * `mintShareEnvelope` is the one place that decides version 2 vs version 3,
 * and it is intentionally the *only* place: given one document it calls
 * `seal` (version 2, byte for byte what sharing a single document has always
 * produced), and for anything else — two documents, or deliberately, zero —
 * it calls `sealBundle`, which already refuses an empty selection with a
 * readable error. `share.ts`'s modal calls this rather than deciding for
 * itself, so "one tick never becomes a bundle" is a property of one function
 * rather than something two call sites have to independently get right.
 *
 * ## Why duplicate detection reads `text`, never `label`
 *
 * A label is whatever the sharer typed, or a filename — it is not an
 * identity. Two documents with the same bytes under different names are the
 * same document; two documents with the same name and different bytes are
 * not. `alreadySavedFlags` compares only `text`.
 *
 * ## No network here
 *
 * This module calls `seal`/`sealBundle` (pure) and `store.ts`'s functions
 * (IndexedDB, not network). The one `fetch` a bundle needs — uploading the
 * sealed blob — stays in `share.ts`, per `docs/PROCESS.md` §5: only
 * `store.ts`, `share.ts` and `crypto.ts` may open a network connection.
 */

import { el } from "./dom.js";
import { formatBytes } from "./format.js";
import { t } from "./i18n/index.js";
import type { BundleEntry, BundlePayload } from "./crypto.js";
import { seal, sealBundle } from "./crypto.js";
import { getFromLibrary, listLibrary, saveToLibrary } from "./store.js";
import type { LibraryEntry } from "./store.js";

/* ---------------------------------------------------------------- mint --- */

/**
 * Seal one document as today's version-2 share, or several as a version-3
 * bundle. The count alone decides the version — see the module header.
 */
export async function mintShareEnvelope(
  documents: BundleEntry[],
  secret: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (documents.length === 1) {
    const [only] = documents;
    // `exchange` rides into the sealed blob and up to /api/shares unredacted
    // (PR #5 review, S5). Harmless today — nothing in this codebase writes an
    // `exchange` onto a `LibraryEntry` yet, so it is always absent here — but
    // this is the line that goes live the moment T2 starts populating it.
    // Redaction has to run *before* this call once that happens; it does not
    // exist anywhere in this codebase yet, which is exactly why it cannot
    // happen here. See docs/DECISIONS.md D3.
    return seal(
      { text: only!.text, label: only!.label, savedAt: Date.now(), exchange: only!.exchange },
      secret,
    );
  }
  // Same warning as above, for every entry in a bundle: each carries its own
  // `exchange` (BundleEntry, unredacted) into `sealBundle` untouched.
  return sealBundle({ kind: "bundle", savedAt: Date.now(), documents }, secret);
}

/**
 * Structural check that a decrypted payload actually has the bundle shape
 * this module needs — independent of, and stricter than, `crypto.ts`'s
 * `isBundlePayload`, which by its own design tests only `.kind === "bundle"`
 * to tell `open`'s two return shapes apart (see that function's doc
 * comment). That is not the same question as "is this safe to treat as a
 * bundle": a version-2 blob can be crafted with an extra `kind: "bundle"`
 * field alongside a valid `text` string, which satisfies version-2
 * validation *and* `isBundlePayload`'s duck-typing at once — PR #5 review,
 * B1, reproduced a real blank-page crash this way, since `payload.documents`
 * is then `undefined` and every function below that assumes an array throws.
 * `main.ts` calls this immediately after `isBundlePayload` returns true and
 * before touching `payload.documents` anywhere.
 */
export function isWellFormedBundlePayload(payload: BundlePayload): boolean {
  return (
    Array.isArray(payload.documents) &&
    payload.documents.every(
      (doc) =>
        typeof doc === "object" &&
        doc !== null &&
        typeof doc.label === "string" &&
        typeof doc.text === "string",
    )
  );
}

/* ---------------------------------------------------------- selection --- */

export interface ResolvedSelection {
  /** Fresh library rows for every ticked id that still exists. */
  found: LibraryEntry[];
  /** Labels of ticked ids that no longer resolve — read from the cache, since the row itself is gone. */
  missingLabels: string[];
}

/**
 * Re-read every ticked id from the library at the moment `Create link` is
 * pressed, rather than trusting the rows already on screen. A document
 * deleted from another tab since the modal opened must be dropped and named,
 * not silently included or allowed to abort the rest of the selection.
 */
export async function resolveSelection(
  ids: number[],
  cachedById: ReadonlyMap<number, LibraryEntry>,
): Promise<ResolvedSelection> {
  const reads = await Promise.all(ids.map(async (id) => ({ id, fresh: await getFromLibrary(id) })));

  const found: LibraryEntry[] = [];
  const missingLabels: string[] = [];
  for (const { id, fresh } of reads) {
    if (fresh) found.push(fresh);
    else missingLabels.push(cachedById.get(id)?.label ?? String(id));
  }
  return { found, missingLabels };
}

/* --------------------------------------------------------- duplicates --- */

/**
 * Which bundle entries are byte-for-byte identical to something already in
 * the library — compared on `text` alone. See the module header for why.
 */
export function alreadySavedFlags(documents: BundleEntry[], library: LibraryEntry[]): boolean[] {
  const texts = new Set(library.map((entry) => entry.text));
  return documents.map((doc) => texts.has(doc.text));
}

/* -------------------------------------------------------------- import --- */

export interface ImportOutcome {
  /** Entries that were actually written, each with the id storage assigned it. */
  saved: LibraryEntry[];
  /** How many ticked entries `saveToLibrary` refused. */
  failedCount: number;
}

/**
 * `resources`/`types`/`shape`/`exchange` are only ever set when the sender
 * had one to report — see `LibraryEntry`'s own header comment in `store.ts`.
 * Building the draft this way, rather than always assigning the key, keeps a
 * bundle entry with none of them indistinguishable from a document saved
 * directly by this build, instead of round-tripping as `{ resources:
 * undefined }`.
 */
/**
 * A bundle entry's `resources`/`types`/`shape`/`exchange` are a sender's
 * self-reported summary, decrypted from a blob this app never generated —
 * `crypto.ts`'s `isBundleShape` validates only `label`/`text` on each entry
 * (that is what it means for the envelope to be "a carrier, not a
 * validator", per T5's own design), so nothing upstream of this function
 * guarantees these fields are even the right *type*, let alone reasonable
 * (PR #5 review, S4). No render path was found unsafe — every one of them
 * goes through `el(..., { text })` — but writing a stranger's arbitrary JSON
 * into these fields of the victim's own library is a bad default regardless
 * of whether today's renderer happens to survive it, so each is checked
 * before `draftFrom` lets it near `saveToLibrary`. A value that fails its
 * check is dropped, exactly as if the sender had never sent it — the same
 * "simply omit" contract `store.ts`'s own header comment already documents
 * for a lens with nothing to report.
 */
const MAX_SHAPE_CHARS = 200; // generous: real shapes look like "data[2]" or "errors[3]"

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function draftFrom(doc: BundleEntry): Omit<LibraryEntry, "id"> {
  const draft: Omit<LibraryEntry, "id"> = {
    label: doc.label,
    text: doc.text,
    savedAt: Date.now(),
    bytes: new TextEncoder().encode(doc.text).byteLength,
  };
  if (typeof doc.resources === "number" && Number.isFinite(doc.resources)) {
    draft.resources = doc.resources;
  }
  if (typeof doc.types === "number" && Number.isFinite(doc.types)) {
    draft.types = doc.types;
  }
  if (typeof doc.shape === "string" && doc.shape.length <= MAX_SHAPE_CHARS) {
    draft.shape = doc.shape;
  }
  if (isPlainRecord(doc.exchange)) {
    draft.exchange = doc.exchange;
  }
  return draft;
}

/**
 * Write exactly the given entries to the library, one at a time so a single
 * rejected write (storage blocked mid-way through) does not lose the rest —
 * each is independent, unlike sealing, where the whole selection is one
 * blob.
 */
export async function importDocuments(documents: BundleEntry[]): Promise<ImportOutcome> {
  const saved: LibraryEntry[] = [];
  let failedCount = 0;

  for (const doc of documents) {
    const draft = draftFrom(doc);
    const id = await saveToLibrary(draft);
    if (id === null) failedCount += 1;
    else saved.push({ ...draft, id });
  }

  return { saved, failedCount };
}

/* --------------------------------------------------------- import view --- */

export interface BundleImportHandlers {
  /** Open a document just written to the library. */
  onOpen: (entry: LibraryEntry) => void;
  /** Discard the bundle and return to the paste view. */
  onCancel: () => void;
  /** A save happened; refresh anything that counts the library (the topbar badge). */
  onChange: () => void;
}

interface Row {
  entry: BundleEntry;
  alreadySaved: boolean;
  ticked: boolean;
}

/**
 * Render the bundle import view into `container`.
 *
 * Not a modal — `docs/task-specs/T6.md` is explicit that it replaces the
 * document view for the load that reached it, because it is where the URL
 * landed. `main.ts` owns showing and hiding `container`; this function only
 * ever writes into it.
 */
export async function renderBundleImportView(
  container: HTMLElement,
  payload: BundlePayload,
  handlers: BundleImportHandlers,
): Promise<void> {
  const library = await listLibrary();
  const dupes = alreadySavedFlags(payload.documents, library);
  const rows: Row[] = payload.documents.map((entry, i) => ({
    entry,
    alreadySaved: dupes[i]!,
    ticked: !dupes[i],
  }));

  const list = el("ul", { class: "library__list bundle-import__list" });
  const hint = el("p", { class: "bundle-hint" });
  const importButton = el("button", {
    class: "btn btn--primary",
    type: "button",
    "data-role": "bundle-import-selected",
    text: t().bundleUi.importSelected,
  });
  const cancelButton = el("button", {
    class: "btn",
    type: "button",
    "data-role": "bundle-cancel",
    text: t().bundleUi.cancel,
  });

  function tickedCount(): number {
    return rows.filter((row) => row.ticked).length;
  }

  function updateFooterState(): void {
    const n = tickedCount();
    importButton.disabled = n === 0;
    hint.hidden = n !== 0;
    hint.textContent = n === 0 ? t().bundleUi.tickToImport : "";
  }

  function renderRows(): void {
    list.replaceChildren();
    for (const row of rows) {
      const checkbox = el("input", {
        type: "checkbox",
        class: "library__checkbox",
        "aria-label": t().bundleUi.selectRow(row.entry.label),
      }) as HTMLInputElement;
      checkbox.checked = row.ticked;
      checkbox.addEventListener("change", () => {
        row.ticked = checkbox.checked;
        updateFooterState();
      });

      const size = formatBytes(new TextEncoder().encode(row.entry.text).byteLength);

      list.append(
        el(
          "li",
          { class: "library__row" },
          el(
            "label",
            { class: "library__select" },
            checkbox,
            el(
              "span",
              { class: "library__select-text" },
              el("span", { class: "library__name", text: row.entry.label }),
              el(
                "span",
                { class: "library__meta" },
                row.entry.shape !== undefined
                  ? el("code", { class: "library__shape", text: row.entry.shape })
                  : null,
                row.entry.resources !== undefined
                  ? el("span", { text: t().library.resources(row.entry.resources) })
                  : null,
                row.entry.types !== undefined
                  ? el("span", { text: t().library.types(row.entry.types) })
                  : null,
                el("span", { text: size }),
                row.alreadySaved ? el("span", { class: "tag", text: t().bundleUi.alreadySaved }) : null,
              ),
            ),
          ),
        ),
      );
    }
    updateFooterState();
  }

  function renderDone(outcome: ImportOutcome, attempted: number): void {
    const summary =
      outcome.saved.length === 0
        ? t().bundleUi.importFailed
        : t().bundleUi.imported(outcome.saved.length, attempted);

    const openRows = outcome.saved.map((entry) =>
      el(
        "li",
        { class: "library__row" },
        el("span", { class: "library__name", text: entry.label }),
        (() => {
          const open = el("button", {
            class: "act",
            type: "button",
            title: t().library.open(entry.label),
            "aria-label": t().library.open(entry.label),
            text: t().bundleUi.open,
          });
          open.addEventListener("click", () => handlers.onOpen(entry));
          return open;
        })(),
      ),
    );

    const done = el("button", {
      class: "btn btn--primary",
      type: "button",
      "data-role": "bundle-done",
      text: t().bundleUi.done,
    });
    done.addEventListener("click", () => handlers.onCancel());

    container.replaceChildren(
      el(
        "div",
        { class: "bundle-import" },
        el(
          "div",
          { class: "bundle-import__head" },
          el("h1", { class: "bundle-import__title", text: t().bundleUi.importTitle }),
          el("p", { class: "bundle-import__subtitle", text: summary }),
        ),
        openRows.length > 0
          ? el(
              "ul",
              { class: "library__list bundle-import__list", "aria-label": t().bundleUi.importTitle },
              ...openRows,
            )
          : null,
        el("div", { class: "bundle-import__foot modal__actions" }, done),
      ),
    );
    done.focus();
  }

  importButton.addEventListener("click", () => {
    const ticked = rows.filter((row) => row.ticked).map((row) => row.entry);
    const attempted = ticked.length;
    importButton.disabled = true;
    cancelButton.disabled = true;
    void importDocuments(ticked).then((outcome) => {
      if (outcome.saved.length > 0) handlers.onChange();
      renderDone(outcome, attempted);
    });
  });

  cancelButton.addEventListener("click", () => handlers.onCancel());

  renderRows();

  container.replaceChildren(
    el(
      "div",
      { class: "bundle-import" },
      el(
        "div",
        { class: "bundle-import__head" },
        el("h1", { class: "bundle-import__title", text: t().bundleUi.importTitle }),
        el("p", { class: "bundle-import__subtitle", text: t().bundleUi.importCount(rows.length) }),
      ),
      list,
      el(
        "div",
        { class: "bundle-import__foot" },
        hint,
        el("div", { class: "modal__actions" }, cancelButton, importButton),
      ),
    ),
  );
}
