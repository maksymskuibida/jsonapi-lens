/**
 * Local persistence: the document currently open, and a library of ones you
 * chose to keep.
 *
 * IndexedDB rather than localStorage because these payloads are megabytes and
 * localStorage caps out around 5 MB of UTF-16 with synchronous writes that
 * would jank the paste. The raw text is stored, not the parsed index:
 * reparsing is fast, and storing text keeps the record honest about what was
 * pasted.
 *
 * All of this is local to the browser. Nothing here talks to a network.
 *
 * ## `DB_VERSION` 2 → 3, and why nothing is migrated
 *
 * Version 3 adds exactly one thing to each record shape: an optional
 * `exchange`. `onupgradeneeded` already creates a store only if it is missing,
 * so this upgrade is a no-op there — there is no new store, no new index, and
 * therefore nothing to write. That is deliberate, not an oversight: IndexedDB
 * does not enforce a record shape beyond its keyPath, so a record written by
 * the previous build, with no `exchange` property at all, is already a valid
 * record under this one. **A v2 record is a v3 record with no exchange**, by
 * construction rather than by conversion, which is what lets every document
 * already saved, and every library entry already listed, keep opening after
 * this ships with nothing rewritten and nothing logged.
 *
 * The version number still moves, purely as a marker for whoever reads this
 * file's history next: it says a record's shape gained a field on this date,
 * even though IndexedDB itself never asked for the bump. Only this module
 * touches `DB_VERSION` — see `docs/STATUS.md` §1a for why that is a rule and
 * not just current practice.
 *
 * `resources`, `types` and `shape` on `LibraryEntry` are optional for a
 * related but separate reason: they are a **display summary for a library
 * row that no code branches on**, computed by whichever lens read the
 * document. A JSON:API reading can always produce all three; a plain-JSON
 * reading (T1) may have no resource or type concept at all, and a v2 entry
 * from before this change has them as plain numbers/strings already, which
 * satisfies "optional" trivially. Nothing here validates or reconstructs
 * them — a caller that has nothing to report simply omits them.
 */

import type { Exchange } from "./exchange.js";

const DB_NAME = "jsonapi-lens";
const DB_VERSION = 3;
const CURRENT_STORE = "documents";
const LIBRARY_STORE = "library";
const CURRENT_KEY = "current";

export interface StoredDocument {
  /** The pasted text, verbatim. */
  text: string;
  /** Epoch ms of the paste. */
  savedAt: number;
  /** A filename, when the document arrived by drag-and-drop, or a chosen name. */
  label?: string;
  /** Captured request/response context, when the document came with one. */
  exchange?: Exchange;
}

/** A document the user explicitly kept, plus enough summary to list it. */
export interface LibraryEntry {
  id?: number;
  label: string;
  text: string;
  savedAt: number;
  bytes: number;
  /** Resource count, when the lens that read this document has one. */
  resources?: number;
  /** Distinct type count, when the lens that read this document has one. */
  types?: number;
  /** Short description of the document shape, e.g. `data[2]` — whatever the reading of this document can report. */
  shape?: string;
  /** Captured request/response context, when the document came with one. */
  exchange?: Exchange;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CURRENT_STORE)) db.createObjectStore(CURRENT_STORE);
      if (!db.objectStoreNames.contains(LIBRARY_STORE)) {
        const store = db.createObjectStore(LIBRARY_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("savedAt", "savedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"));
  });
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = run(transaction.objectStore(storeName));
        transaction.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        transaction.onabort = transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error("IndexedDB transaction failed"));
        };
      }),
  );
}

/**
 * Storage is a convenience, never a precondition. Private browsing modes and
 * blocked-storage settings make every one of these calls a legitimate failure,
 * so they resolve to a safe value instead of rejecting — the app still works,
 * it just will not remember.
 */

export async function saveDocument(doc: StoredDocument): Promise<boolean> {
  try {
    await tx(CURRENT_STORE, "readwrite", (store) => store.put(doc, CURRENT_KEY));
    return true;
  } catch {
    return false;
  }
}

export async function loadDocument(): Promise<StoredDocument | null> {
  try {
    const value = await tx<StoredDocument | undefined>(CURRENT_STORE, "readonly", (store) =>
      store.get(CURRENT_KEY),
    );
    if (!value || typeof value.text !== "string") return null;
    return value;
  } catch {
    return null;
  }
}

export async function clearDocument(): Promise<void> {
  try {
    await tx(CURRENT_STORE, "readwrite", (store) => store.delete(CURRENT_KEY));
  } catch {
    /* nothing to do — the in-memory state is already cleared by the caller */
  }
}

/* -------------------------------------------------------------- library --- */

export async function saveToLibrary(entry: LibraryEntry): Promise<number | null> {
  try {
    const { id: _ignored, ...rest } = entry;
    const key = await tx<IDBValidKey>(LIBRARY_STORE, "readwrite", (store) => store.add(rest));
    return typeof key === "number" ? key : null;
  } catch {
    return null;
  }
}

/** Newest first. */
export async function listLibrary(): Promise<LibraryEntry[]> {
  try {
    const all = await tx<LibraryEntry[]>(LIBRARY_STORE, "readonly", (store) => store.getAll());
    return (all ?? []).sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** How many saved documents there are, without reading their contents. */
export async function countLibrary(): Promise<number> {
  try {
    return await tx<number>(LIBRARY_STORE, "readonly", (store) => store.count());
  } catch {
    return 0;
  }
}

export async function getFromLibrary(id: number): Promise<LibraryEntry | null> {
  try {
    const entry = await tx<LibraryEntry | undefined>(LIBRARY_STORE, "readonly", (store) =>
      store.get(id),
    );
    return entry ?? null;
  } catch {
    return null;
  }
}

export async function deleteFromLibrary(id: number): Promise<boolean> {
  try {
    await tx(LIBRARY_STORE, "readwrite", (store) => store.delete(id));
    return true;
  } catch {
    return false;
  }
}

export async function renameInLibrary(id: number, label: string): Promise<boolean> {
  try {
    const entry = await getFromLibrary(id);
    if (!entry) return false;
    entry.label = label;
    await tx(LIBRARY_STORE, "readwrite", (store) => store.put(entry));
    return true;
  } catch {
    return false;
  }
}
