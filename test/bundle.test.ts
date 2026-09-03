// @vitest-environment node
/**
 * Node, not jsdom, for the same reason as `crypto.test.ts`: the functions
 * under test here are `mintShareEnvelope` (which calls straight into
 * `seal`/`sealBundle`) and the IndexedDB-backed selection/import helpers,
 * none of which need a DOM. `renderBundleImportView` — the one export of
 * `bundle.ts` that does — is covered separately in `test/bundle-view.test.ts`,
 * which needs jsdom and therefore cannot share this file.
 */
import "fake-indexeddb/auto";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import {
  alreadySavedFlags,
  importDocuments,
  mintShareEnvelope,
  resolveSelection,
} from "../src/bundle.js";
import { generateSecret, isBundlePayload, open as openSealed, ShareError } from "../src/crypto.js";
import type { BundleEntry } from "../src/crypto.js";
import { listLibrary, renameInLibrary, saveToLibrary } from "../src/store.js";
import type { LibraryEntry } from "../src/store.js";

/**
 * `docs/PROCESS.md` §5: only `store.ts`, `share.ts` and `crypto.ts` may open a
 * network connection. `bundle.ts`'s own header comment claims it stays out of
 * that business entirely — this is what makes the claim more than a comment.
 */
let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
beforeAll(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("bundle.ts must never call fetch — see docs/PROCESS.md §5");
  });
});
afterAll(() => {
  fetchSpy?.mockRestore();
});

/** Same technique as `test/store.test.ts`: a clean database per test. */
beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("jsonapi-lens");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
});

/** Same generator as `test/crypto.test.ts`'s, for the one oversize test that needs it. */
function pseudoRandomText(byteLength: number): string {
  const printable: number[] = [];
  for (let code = 0x21; code <= 0x7e; code++) {
    if (code !== 0x22 && code !== 0x5c) printable.push(code);
  }
  const bytes = new Uint8Array(byteLength);
  let seed = 0x2545f491 ^ byteLength;
  for (let i = 0; i < byteLength; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    bytes[i] = printable[seed % printable.length]!;
  }
  let text = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return text;
}

describe("mintShareEnvelope", () => {
  it("mints version 2 for one document, version 3 for two — asserted on the sealed bytes' version byte", async () => {
    const secret = generateSecret();

    const one = await mintShareEnvelope([{ label: "a.json", text: "{}" }], secret);
    expect(one[0]).toBe(2);

    const two = await mintShareEnvelope(
      [
        { label: "a.json", text: "{}" },
        { label: "b.json", text: "[]" },
      ],
      secret,
    );
    expect(two[0]).toBe(3);
  });

  it("carries an exchange through the single-document path, unwrapped from a bundle", async () => {
    const secret = generateSecret();
    const blob = await mintShareEnvelope(
      [{ label: "a.json", text: "{}", exchange: { method: "GET" } }],
      secret,
    );
    expect(blob[0]).toBe(2);
    const opened = await openSealed(blob, secret);
    expect(isBundlePayload(opened)).toBe(false);
    if (!isBundlePayload(opened)) expect(opened.exchange).toEqual({ method: "GET" });
  });

  it("round-trips several documents as a bundle, each entry intact", async () => {
    const secret = generateSecret();
    const documents: BundleEntry[] = [
      { label: "a.json", text: '{"a":1}', resources: 1, types: 1, shape: "data{1}" },
      { label: "b.json", text: "[]", resources: 0, types: 0, shape: "data[0]" },
    ];
    const blob = await mintShareEnvelope(documents, secret);
    const opened = await openSealed(blob, secret);
    expect(isBundlePayload(opened)).toBe(true);
    if (isBundlePayload(opened)) expect(opened.documents).toEqual(documents);
  });

  it("refuses a selection whose sealed size exceeds the cap, naming the largest documents", async () => {
    // Mirrors crypto.test.ts's own cap test: high-entropy text resists gzip,
    // so ~18 MB raw reliably seals to more than the 12 MB cap even after
    // compression — this is the same trick, exercised through this module's
    // own entry point rather than `sealBundle` directly.
    const big: BundleEntry = { label: "huge.json", text: pseudoRandomText(18 * 1024 * 1024) };
    const small: BundleEntry = { label: "tiny.json", text: '{"data":null}' };

    let caught: ShareError | undefined;
    try {
      await mintShareEnvelope([small, big], generateSecret());
    } catch (error) {
      caught = error as ShareError;
    }

    expect(caught).toBeInstanceOf(ShareError);
    expect(caught!.hint).toMatch(/MB/);
    expect(caught!.hint).toContain("huge.json");
    expect(caught!.hint).toContain("tiny.json");
  }, 20_000);
});

describe("resolveSelection", () => {
  it("drops a ticked id no longer in the library, reported by its cached label, and does not abort the rest", async () => {
    const keptId = await saveToLibrary({ label: "kept.json", text: "{}", savedAt: 1, bytes: 2 });
    expect(keptId).not.toBeNull();

    const cachedById = new Map<number, LibraryEntry>([
      [keptId!, { id: keptId!, label: "kept.json", text: "{}", savedAt: 1, bytes: 2 }],
      [999, { id: 999, label: "gone.json", text: "{}", savedAt: 2, bytes: 2 }],
    ]);

    const { found, missingLabels } = await resolveSelection([keptId!, 999], cachedById);

    expect(found.map((e) => e.label)).toEqual(["kept.json"]);
    expect(missingLabels).toEqual(["gone.json"]);
  });

  it("reports every missing id, when the whole selection vanished", async () => {
    const cachedById = new Map<number, LibraryEntry>([
      [1, { id: 1, label: "one.json", text: "{}", savedAt: 1, bytes: 2 }],
      [2, { id: 2, label: "two.json", text: "{}", savedAt: 2, bytes: 2 }],
    ]);
    const { found, missingLabels } = await resolveSelection([1, 2], cachedById);
    expect(found).toEqual([]);
    expect(missingLabels).toEqual(["one.json", "two.json"]);
  });

  it("re-reads the fresh row rather than trusting the cache — a rename since the modal opened is reflected", async () => {
    const id = await saveToLibrary({ label: "original.json", text: "{}", savedAt: 1, bytes: 2 });
    expect(id).not.toBeNull();
    // The cache is what the modal captured when it first listed the library —
    // stale the moment a rename happens elsewhere.
    const cachedById = new Map<number, LibraryEntry>([
      [id!, { id: id!, label: "original.json", text: "{}", savedAt: 1, bytes: 2 }],
    ]);
    expect(await renameInLibrary(id!, "renamed-elsewhere.json")).toBe(true);

    const { found } = await resolveSelection([id!], cachedById);
    expect(found.map((e) => e.label)).toEqual(["renamed-elsewhere.json"]);
  });
});

describe("alreadySavedFlags", () => {
  it("is a duplicate when the text matches, even under a different label", () => {
    const library: LibraryEntry[] = [
      { id: 1, label: "old-name.json", text: '{"x":1}', savedAt: 1, bytes: 9 },
    ];
    const documents: BundleEntry[] = [{ label: "new-name.json", text: '{"x":1}' }];
    expect(alreadySavedFlags(documents, library)).toEqual([true]);
  });

  it("is not a duplicate when the label matches but the text differs", () => {
    const library: LibraryEntry[] = [
      { id: 1, label: "same-name.json", text: '{"x":1}', savedAt: 1, bytes: 9 },
    ];
    const documents: BundleEntry[] = [{ label: "same-name.json", text: '{"x":2}' }];
    expect(alreadySavedFlags(documents, library)).toEqual([false]);
  });

  it("flags each document independently, in order", () => {
    const library: LibraryEntry[] = [{ id: 1, label: "a", text: "dup", savedAt: 1, bytes: 3 }];
    const documents: BundleEntry[] = [
      { label: "x", text: "dup" },
      { label: "y", text: "not-dup" },
    ];
    expect(alreadySavedFlags(documents, library)).toEqual([true, false]);
  });
});

describe("importDocuments", () => {
  it("writes exactly the given entries, carrying the optional summary fields through", async () => {
    const documents: BundleEntry[] = [
      { label: "a.json", text: '{"a":1}' },
      { label: "b.json", text: "[]", resources: 0, types: 0, shape: "data[0]", exchange: { status: 200 } },
    ];
    const outcome = await importDocuments(documents);

    expect(outcome.failedCount).toBe(0);
    expect(outcome.saved.map((e) => e.label)).toEqual(["a.json", "b.json"]);
    expect(outcome.saved[1]!.exchange).toEqual({ status: 200 });
    expect(outcome.saved[1]!.shape).toBe("data[0]");
    // Nothing extra landed in the library beyond these two.
    expect((await listLibrary()).length).toBe(2);
  });

  it("omits resources/types/shape/exchange entirely when the source document had none, rather than storing them as undefined", async () => {
    const outcome = await importDocuments([{ label: "plain.json", text: "{}" }]);
    expect(outcome.saved[0]).toEqual({
      id: outcome.saved[0]!.id,
      label: "plain.json",
      text: "{}",
      savedAt: outcome.saved[0]!.savedAt,
      bytes: 2,
    });
    expect("resources" in outcome.saved[0]!).toBe(false);
  });

  it("writes nothing when storage rejects every write, and reports the failure count honestly", async () => {
    const real = indexedDB.open;
    indexedDB.open = () => {
      throw new Error("storage blocked");
    };
    try {
      const outcome = await importDocuments([
        { label: "a.json", text: "{}" },
        { label: "b.json", text: "[]" },
      ]);
      expect(outcome.saved).toEqual([]);
      expect(outcome.failedCount).toBe(2);
    } finally {
      indexedDB.open = real;
    }
    expect(await listLibrary()).toEqual([]);
  });
});
