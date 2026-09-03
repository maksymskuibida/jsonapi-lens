/**
 * `renderBundleImportView`'s DOM behaviour — jsdom, unlike `bundle.test.ts`,
 * because this is the one export of `bundle.ts` that touches `document` at
 * all. See that file's header comment for why the two cannot share a file.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderBundleImportView } from "../src/bundle.js";
import type { BundlePayload } from "../src/crypto.js";
import * as store from "../src/store.js";
import { listLibrary, saveToLibrary } from "../src/store.js";
import type { LibraryEntry } from "../src/store.js";
import { t } from "../src/i18n/index.js";

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("jsonapi-lens");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  document.body.innerHTML = "";
});

function bundle(documents: BundlePayload["documents"]): BundlePayload {
  return { kind: "bundle", savedAt: 1, documents };
}

/**
 * A fresh container, attached to `document.body`. jsdom only synthesises a
 * checkbox's `change` event for an element connected to the document — a
 * detached one still flips `.checked` on `.click()` but fires nothing, which
 * would make every ticked/unticked assertion below pass or fail for the
 * wrong reason.
 */
function attachedContainer(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

function checkboxes(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>(".library__checkbox")];
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!button) throw new Error(`no button with text ${JSON.stringify(text)}`);
  return button as HTMLButtonElement;
}

/**
 * The click handler's `saveToLibrary` chain is fire-and-forget; poll for its
 * result. Checking for the `Done` button rather than `.bundle-import__subtitle`
 * matters: that class is present from the very first render too, so waiting
 * on it alone would return before the import ever finished.
 */
async function waitForImportDone(container: HTMLElement, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!hasDoneButton(container)) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for the import to finish");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function hasDoneButton(container: HTMLElement): boolean {
  return [...container.querySelectorAll("button")].some((b) => b.textContent === t().bundleUi.done);
}

describe("renderBundleImportView", () => {
  it("lists every document, each ticked by default", async () => {
    const container = attachedContainer();
    await renderBundleImportView(
      container,
      bundle([
        { label: "a.json", text: "{}" },
        { label: "b.json", text: "[]" },
      ]),
      { onOpen: () => {}, onCancel: () => {}, onChange: () => {} },
    );

    const boxes = checkboxes(container);
    expect(boxes.length).toBe(2);
    expect(boxes.every((box) => box.checked)).toBe(true);
    expect(container.querySelectorAll(".library__name").length).toBe(2);
  });

  it("marks a document already in the library as such, and starts it unticked — ticking it back on is still allowed", async () => {
    await saveToLibrary({ label: "existing-name.json", text: '{"same":true}', savedAt: 1, bytes: 14 });

    const container = attachedContainer();
    await renderBundleImportView(
      container,
      // Different label, identical text: still a duplicate — duplicate
      // detection is on text, not label.
      bundle([{ label: "sent-under-a-different-name.json", text: '{"same":true}' }]),
      { onOpen: () => {}, onCancel: () => {}, onChange: () => {} },
    );

    const box = checkboxes(container)[0]!;
    expect(box.checked).toBe(false);
    expect(container.textContent).toContain(t().bundleUi.alreadySaved);

    box.click();
    expect(box.checked).toBe(true);
  });

  it("renders a hostile label as text, in both the row and after import", async () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const container = attachedContainer();
    await renderBundleImportView(container, bundle([{ label: hostile, text: "{}" }]), {
      onOpen: () => {},
      onCancel: () => {},
      onChange: () => {},
    });

    expect(container.querySelector(".library__name")!.textContent).toBe(hostile);
    expect(container.querySelector("img")).toBeNull();

    findButton(container, t().bundleUi.importSelected).click();
    await waitForImportDone(container);

    expect(container.querySelector(".library__name")!.textContent).toBe(hostile);
    expect(container.querySelector("img")).toBeNull();
  });

  it("disables Import selected with nothing ticked, and names why", async () => {
    const container = attachedContainer();
    await renderBundleImportView(container, bundle([{ label: "a.json", text: "{}" }]), {
      onOpen: () => {},
      onCancel: () => {},
      onChange: () => {},
    });

    const importButton = findButton(container, t().bundleUi.importSelected);
    expect(importButton.disabled).toBe(false); // starts ticked

    checkboxes(container)[0]!.click(); // untick the only row
    expect(importButton.disabled).toBe(true);
    expect(container.textContent).toContain(t().bundleUi.tickToImport);
  });

  it("writes exactly the ticked entries, reports the count, and offers to open each without doing so unasked", async () => {
    const opened: LibraryEntry[] = [];
    let changed = 0;
    const container = attachedContainer();

    await renderBundleImportView(
      container,
      bundle([
        { label: "keep.json", text: "{}" },
        { label: "skip.json", text: "[]" },
      ]),
      { onOpen: (entry) => opened.push(entry), onCancel: () => {}, onChange: () => changed++ },
    );

    checkboxes(container)[1]!.click(); // untick "skip.json"
    findButton(container, t().bundleUi.importSelected).click();

    await waitForImportDone(container);

    const saved = await listLibrary();
    expect(saved.map((e) => e.label)).toEqual(["keep.json"]);
    expect(changed).toBe(1);
    // Importing did not itself open anything.
    expect(opened).toEqual([]);

    findButton(container, t().bundleUi.open).click();
    expect(opened.map((e) => e.label)).toEqual(["keep.json"]);
  });

  it("reports that nothing could be saved, rather than claiming success, when storage rejects", async () => {
    const real = indexedDB.open;
    indexedDB.open = () => {
      throw new Error("storage blocked");
    };
    let changed = 0;
    const container = attachedContainer();
    try {
      await renderBundleImportView(container, bundle([{ label: "a.json", text: "{}" }]), {
        onOpen: () => {},
        onCancel: () => {},
        onChange: () => changed++,
      });

      findButton(container, t().bundleUi.importSelected).click();
      await waitForImportDone(container);

      expect(container.querySelector(".bundle-import__subtitle")!.textContent).toBe(
        t().bundleUi.importFailed,
      );
      expect(changed).toBe(0);
    } finally {
      indexedDB.open = real;
    }
  });

  /**
   * PR #5 review round 2, N16: `importDocuments(ticked)` was a `void`-ed
   * fire-and-forget call with no `.catch`, the same defect shape B1 fixed for
   * `renderBundleImportView` itself. `saveToLibrary` never actually rejects
   * (the test above goes through it failing *without* a rejection, via the
   * `null`-outcome path store.ts's own header comment documents), so this
   * spies on the module boundary directly to force the rejection the fix
   * guards against, rather than one that can happen today. Without the
   * `.catch` this test times out: `importButton`/`cancelButton` stay
   * disabled, `renderDone` never runs, and `waitForImportDone` never sees a
   * `Done` button — this is what "add a test that fails without the
   * handling" means for this item, since the click handler still runs when
   * the guard is removed, it just never finishes.
   */
  it("catches a rejection from importDocuments and still reports failure, instead of leaving the view stuck", async () => {
    const spy = vi.spyOn(store, "saveToLibrary").mockRejectedValue(new Error("unexpected"));
    let changed = 0;
    const container = attachedContainer();
    try {
      await renderBundleImportView(container, bundle([{ label: "a.json", text: "{}" }]), {
        onOpen: () => {},
        onCancel: () => {},
        onChange: () => changed++,
      });

      const importButton = findButton(container, t().bundleUi.importSelected);
      const cancelButton = findButton(container, t().bundleUi.cancel);
      importButton.click();

      // Immediately after the click, both controls are disabled — asserted
      // here so a future change that skips this step entirely would still
      // be caught, not just the final outcome.
      expect(importButton.disabled).toBe(true);
      expect(cancelButton.disabled).toBe(true);

      await waitForImportDone(container);

      expect(container.querySelector(".bundle-import__subtitle")!.textContent).toBe(
        t().bundleUi.importFailed,
      );
      expect(changed).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("Cancel discards without writing anything", async () => {
    let cancelled = false;
    const container = attachedContainer();
    await renderBundleImportView(container, bundle([{ label: "a.json", text: "{}" }]), {
      onOpen: () => {},
      onCancel: () => {
        cancelled = true;
      },
      onChange: () => {},
    });

    findButton(container, t().bundleUi.cancel).click();
    expect(cancelled).toBe(true);
    expect(await listLibrary()).toEqual([]);
  });
});
