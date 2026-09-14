/**
 * jsdom does not implement IndexedDB — see `test/store.test.ts`'s own header
 * for why `fake-indexeddb/auto` is imported for its side effect, before
 * `store.ts` (reached here through `panels.ts`) is loaded.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { en } from "../src/i18n/en.js";
import { openLibraryModal } from "../src/panels.js";
import { saveToLibrary } from "../src/store.js";

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("jsonapi-lens");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });

  // `ui.ts#openModal` throws without this host; nothing else in this suite
  // needs it, so no other test file sets it up.
  document.body.innerHTML = '<div id="modal-root"></div>';

  // jsdom's own `window.confirm` is unimplemented and answers falsy, which
  // would make every delete below a no-op before it ever reached the bug
  // this file exists to guard.
  window.confirm = () => true;
});

const subtitleText = (): string | null =>
  document.querySelector(".modal__subtitle")?.textContent ?? null;

const deleteButtons = (): HTMLButtonElement[] => [
  ...document.querySelectorAll<HTMLButtonElement>(".act--danger"),
];

/*
 * D4 (docs/qa-reports/prod-baseline-2026-09-02.md): the modal's subtitle used
 * to be computed once, from the list `openLibraryModal` was called with, and
 * never again — so deleting an entry updated the list body correctly but left
 * the subtitle ("N in this browser") at its stale, pre-delete count for as
 * long as the modal stayed open. `src/panels.ts#openLibraryModal`'s `render`
 * now derives the subtitle from `list` on every call, the same list it just
 * used to rebuild the body, rather than only on the call that opened the
 * modal.
 */
describe("the saved-documents modal subtitle", () => {
  it("updates when the last entry is deleted with the modal still open", async () => {
    await saveToLibrary({ label: "only.json", text: "{}", savedAt: 1, bytes: 2 });
    await openLibraryModal(() => {});

    expect(subtitleText()).toBe(en.library.countInBrowser(1));
    expect(deleteButtons()).toHaveLength(1);

    deleteButtons()[0]!.click();

    await vi.waitFor(() => {
      expect(subtitleText()).toBe(en.library.storedLocally);
    });
    // The list body is correct too — this bug never touched it, but a fix
    // that broke it to fix the subtitle would be worse, not better.
    expect(document.querySelector(".library__empty-title")?.textContent).toBe(
      en.library.emptyTitle,
    );
  });

  it("decrements correctly when one of several is deleted, not only in the last-item case", async () => {
    await saveToLibrary({ label: "a.json", text: "{}", savedAt: 1, bytes: 2 });
    await saveToLibrary({ label: "b.json", text: "{}", savedAt: 2, bytes: 2 });
    await saveToLibrary({ label: "c.json", text: "{}", savedAt: 3, bytes: 2 });
    await openLibraryModal(() => {});

    expect(subtitleText()).toBe(en.library.countInBrowser(3));

    deleteButtons()[0]!.click();

    await vi.waitFor(() => {
      expect(subtitleText()).toBe(en.library.countInBrowser(2));
    });
    expect(deleteButtons()).toHaveLength(2);
  });

  it("does not update on a rename, which does not change the count", async () => {
    await saveToLibrary({ label: "a.json", text: "{}", savedAt: 1, bytes: 2 });
    await openLibraryModal(() => {});
    expect(subtitleText()).toBe(en.library.countInBrowser(1));

    window.prompt = () => "renamed.json";
    document.querySelector<HTMLButtonElement>(".act:not(.act--danger)")!.click();

    await vi.waitFor(() => {
      expect(document.querySelector(".library__name")?.textContent).toBe("renamed.json");
    });
    expect(subtitleText()).toBe(en.library.countInBrowser(1));
  });
});
