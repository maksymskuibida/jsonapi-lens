/**
 * Persistence for the pasted document.
 *
 * IndexedDB rather than localStorage because these payloads are megabytes and
 * localStorage caps out around 5 MB of UTF-16 with synchronous writes that
 * would jank the paste. The raw text is stored, not the parsed index: reparsing
 * is fast, and storing text keeps the record honest about what was pasted.
 *
 * This is the only storage in the app, it is local to the browser, and nothing
 * here talks to a network.
 */

const DB_NAME = "jsonapi-lens";
const DB_VERSION = 1;
const STORE = "documents";
const CURRENT = "current";

export interface StoredDocument {
  /** The pasted text, verbatim. */
  text: string;
  /** Epoch ms of the paste. */
  savedAt: number;
  /** Optional label — a filename, when the document arrived by drag-and-drop. */
  label?: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = run(transaction.objectStore(STORE));
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
    await tx("readwrite", (store) => store.put(doc, CURRENT));
    return true;
  } catch {
    return false;
  }
}

export async function loadDocument(): Promise<StoredDocument | null> {
  try {
    const value = await tx<StoredDocument | undefined>("readonly", (store) => store.get(CURRENT));
    if (!value || typeof value.text !== "string") return null;
    return value;
  } catch {
    return null;
  }
}

export async function clearDocument(): Promise<void> {
  try {
    await tx("readwrite", (store) => store.delete(CURRENT));
  } catch {
    /* nothing to do — the in-memory state is already cleared by the caller */
  }
}
