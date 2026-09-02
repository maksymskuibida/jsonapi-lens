/**
 * jsdom (this suite's default environment) does not implement IndexedDB at
 * all — `"indexedDB" in window` is `false` — so these tests run against
 * `fake-indexeddb`, a spec-compliant in-memory implementation, rather than
 * against jsdom's own (nonexistent) support. Imported for its side effect:
 * installing `indexedDB`/`IDBKeyRange` on `globalThis` before `store.ts` is
 * loaded, which is what lets `indexedDB.open(...)` inside it resolve to
 * something at all.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDocument,
  countLibrary,
  deleteFromLibrary,
  getFromLibrary,
  listLibrary,
  loadDocument,
  renameInLibrary,
  saveDocument,
  saveToLibrary,
} from "../src/store.js";
import type { LibraryEntry, StoredDocument } from "../src/store.js";

/**
 * Each `it` gets a clean database. Vitest isolates globals per *file*, not per
 * test, so without this every test after the first would see every earlier
 * test's records.
 */
beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("jsonapi-lens");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

describe("current document", () => {
  it("round-trips a document with an exchange", async () => {
    const doc: StoredDocument = {
      text: '{"data":null}',
      savedAt: 1,
      label: "a.json",
      exchange: { method: "GET", url: "https://api.example.com/widgets" },
    };
    expect(await saveDocument(doc)).toBe(true);
    expect(await loadDocument()).toEqual(doc);
  });

  it("round-trips a document with no exchange at all, same as before this change", async () => {
    const doc: StoredDocument = { text: "{}", savedAt: 1, label: "plain.json" };
    expect(await saveDocument(doc)).toBe(true);
    const loaded = await loadDocument();
    expect(loaded).toEqual(doc);
    expect(loaded && "exchange" in loaded).toBe(false);
  });

  it("reads a v2-shaped record — written with no knowledge that `exchange` exists — cleanly", async () => {
    // A literal object with no `exchange` key, exactly what the pre-T5 build's
    // `saveDocument` would have persisted. Nothing here casts it into shape;
    // it is a plain `StoredDocument` already, which is the point.
    const v2Record: StoredDocument = { text: '{"data":[]}', savedAt: 5, label: "old.json" };
    expect(await saveDocument(v2Record)).toBe(true);

    const loaded = await loadDocument();
    expect(loaded).toEqual(v2Record);
    expect(loaded?.exchange).toBeUndefined();
  });

  it("clears the current document", async () => {
    await saveDocument({ text: "{}", savedAt: 1 });
    await clearDocument();
    expect(await loadDocument()).toBeNull();
  });

  it("resolves to null when nothing has been saved yet", async () => {
    expect(await loadDocument()).toBeNull();
  });

  it("resolves to a safe value rather than rejecting when storage is unavailable", async () => {
    const real = indexedDB.open;
    // Some browsers throw synchronously from `indexedDB.open` itself when
    // storage is blocked entirely (private browsing, disabled site data) —
    // this is a legitimate failure store.ts must already tolerate, not one
    // T5 introduces.
    indexedDB.open = () => {
      throw new Error("storage blocked");
    };
    try {
      expect(await saveDocument({ text: "{}", savedAt: 1 })).toBe(false);
      expect(await loadDocument()).toBeNull();
    } finally {
      indexedDB.open = real;
    }
  });
});

describe("library", () => {
  it("round-trips a v3 entry with an exchange and a non-JSON:API summary", async () => {
    // A plain-JSON reading (T1) has no resource/type concept, so it omits
    // `resources`/`types`/`shape` entirely rather than reporting a fake count.
    const entry: LibraryEntry = {
      label: "array.json",
      text: "[1,2,3]",
      savedAt: 10,
      bytes: 9,
      exchange: { status: 200 },
    };
    const id = await saveToLibrary(entry);
    expect(id).not.toBeNull();
    expect(await getFromLibrary(id!)).toEqual({ ...entry, id });
  });

  it("lists, opens, renames and deletes a v2-shaped entry lacking `exchange`", async () => {
    // Exactly what the pre-T5 build's `saveToLibrary` would have persisted:
    // a full JSON:API summary, and no `exchange` key at all.
    const v2Entry: LibraryEntry = {
      label: "legacy.json",
      text: '{"data":{"type":"widgets","id":"1"}}',
      savedAt: 20,
      bytes: 37,
      resources: 1,
      types: 1,
      shape: "data{1}",
    };
    const id = await saveToLibrary(v2Entry);
    expect(id).not.toBeNull();

    const listed = await listLibrary();
    expect(listed).toEqual([{ ...v2Entry, id }]);

    const opened = await getFromLibrary(id!);
    expect(opened).toEqual({ ...v2Entry, id });
    expect(opened?.exchange).toBeUndefined();

    expect(await renameInLibrary(id!, "renamed.json")).toBe(true);
    expect((await getFromLibrary(id!))?.label).toBe("renamed.json");

    expect(await deleteFromLibrary(id!)).toBe(true);
    expect(await getFromLibrary(id!)).toBeNull();
  });

  it("lists newest first", async () => {
    const older = await saveToLibrary({ label: "a", text: "{}", savedAt: 1, bytes: 2 });
    const newer = await saveToLibrary({ label: "b", text: "{}", savedAt: 2, bytes: 2 });
    const listed = await listLibrary();
    expect(listed.map((e) => e.id)).toEqual([newer, older]);
  });

  it("counts without reading contents", async () => {
    expect(await countLibrary()).toBe(0);
    await saveToLibrary({ label: "a", text: "{}", savedAt: 1, bytes: 2 });
    await saveToLibrary({ label: "b", text: "{}", savedAt: 2, bytes: 2 });
    expect(await countLibrary()).toBe(2);
  });

  it("returns false/null for an id that does not exist, rather than throwing", async () => {
    expect(await getFromLibrary(999)).toBeNull();
    expect(await renameInLibrary(999, "x")).toBe(false);
    // `deleteFromLibrary` on IndexedDB succeeds even for an absent key — there
    // is nothing to distinguish "deleted" from "was never there" without a
    // prior read, and this module does not add one for a call that already
    // has a safe, idempotent outcome.
    expect(await deleteFromLibrary(999)).toBe(true);
  });
});

describe("the v2 → v3 upgrade, on a real existing database", () => {
  /**
   * Seeds a database shaped exactly like the pre-T5 build would have left
   * one on disk: opened at version 2, using that build's own
   * `onupgradeneeded` (out-of-line-keyed `documents`, `library` keyed on
   * `id` with a `savedAt` index) — not this branch's `store.ts`, which can
   * only ever open at version 3 now. `saveDocument`/`saveToLibrary` are
   * deliberately not reused here for the same reason: this has to be data a
   * v2 client actually could have written, not data this branch's code
   * happens to produce.
   */
  function seedV2Database(
    document: StoredDocument,
    entry: Omit<LibraryEntry, "id">,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("jsonapi-lens", 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore("documents");
        const store = db.createObjectStore("library", { keyPath: "id", autoIncrement: true });
        store.createIndex("savedAt", "savedAt");
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(["documents", "library"], "readwrite");
        tx.objectStore("documents").put(document, "current");
        const addReq = tx.objectStore("library").add(entry);
        let libraryId: number;
        addReq.onsuccess = () => {
          libraryId = addReq.result as number;
        };
        tx.oncomplete = () => {
          db.close();
          resolve(libraryId);
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  it("upgrades a real v2 database in place: the current document and the library entry both survive, and every library operation still works", async () => {
    const v2Document: StoredDocument = {
      text: '{"data":{"type":"widgets","id":"1"}}',
      savedAt: 100,
      label: "v2-current.json",
    };
    const v2Entry: Omit<LibraryEntry, "id"> = {
      label: "v2-library.json",
      text: '{"data":[{"type":"widgets","id":"1"},{"type":"widgets","id":"2"}]}',
      savedAt: 200,
      bytes: 58,
      resources: 2,
      types: 1,
      shape: "data[2]",
    };
    const seededId = await seedV2Database(v2Document, v2Entry);

    // Every call below goes through this branch's real `store.ts`, whose
    // `open()` requests version 3 — against a database still on disk at
    // version 2, this is what actually fires a real `onupgradeneeded` with
    // `oldVersion: 2`, not a simulated one.
    const loadedDoc = await loadDocument();
    expect(loadedDoc).toEqual(v2Document);
    expect(loadedDoc?.exchange).toBeUndefined();

    const loadedEntry = await getFromLibrary(seededId);
    expect(loadedEntry).toEqual({ ...v2Entry, id: seededId });

    const listed = await listLibrary();
    expect(listed).toEqual([{ ...v2Entry, id: seededId }]);
    expect(await countLibrary()).toBe(1);

    // A v3-shaped entry can be added alongside the migrated v2 one.
    const v3Id = await saveToLibrary({
      label: "new.json",
      text: "{}",
      savedAt: 300,
      bytes: 2,
      exchange: { method: "GET" },
    });
    expect(await countLibrary()).toBe(2);

    // Every library operation still works on the pre-existing v2 record,
    // including renaming, which reads the entry back and rewrites it —
    // confirming the untouched fields (resources/types/shape) survive a
    // round trip through this branch's code, not just the initial read.
    expect(await renameInLibrary(seededId, "renamed-v2.json")).toBe(true);
    const renamed = await getFromLibrary(seededId);
    expect(renamed).toEqual({ ...v2Entry, id: seededId, label: "renamed-v2.json" });

    expect(await deleteFromLibrary(seededId)).toBe(true);
    expect(await getFromLibrary(seededId)).toBeNull();
    expect(await getFromLibrary(v3Id!)).not.toBeNull();
  });
});
