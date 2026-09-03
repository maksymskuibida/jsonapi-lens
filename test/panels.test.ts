/**
 * `openLibraryModal`'s selection mode (T6): the `Share` button, the
 * checkbox/Cancel/Create-link flow, and the Escape semantics that undo
 * selection mode before they close the dialog. jsdom, because this is a real
 * modal built with `document.createElement`.
 *
 * The mint/upload path itself is not re-tested here: `mintShareEnvelope`'s
 * version-byte behaviour is `test/bundle.test.ts`'s job (pure, no DOM), and
 * the assertion below on `.modal__subtitle` is what confirms this module
 * hands the right *shape* of selection to `share.ts` — one document to
 * `openShareModal`, several to `openBundleShareModal` — without needing to
 * run a key derivation to see it.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { openLibraryModal } from "../src/panels.js";
import { saveToLibrary } from "../src/store.js";
import { t } from "../src/i18n/index.js";
import { formatBytes } from "../src/format.js";

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("jsonapi-lens");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  document.body.innerHTML = '<div id="modal-root"></div><div id="toast"></div>';
});

function shareButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>("[data-role='library-share']");
  if (!button) throw new Error("no Share button in the footer");
  return button;
}

function findButton(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent === text);
  if (!button) throw new Error(`no button with text ${JSON.stringify(text)}`);
  return button as HTMLButtonElement;
}

function checkboxes(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>(".library__checkbox")];
}

function pressEscape(): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
}

describe("library selection mode", () => {
  it("shows no Share button at all when the library is empty", async () => {
    await openLibraryModal(() => {});
    expect(document.querySelector("[data-role='library-share']")).toBeNull();
  });

  it("Share reveals a checkbox per row and hides Rename/Delete; the footer becomes Cancel/Create link", async () => {
    await saveToLibrary({ label: "a.json", text: "{}", savedAt: 1, bytes: 2 });
    await saveToLibrary({ label: "b.json", text: "[]", savedAt: 2, bytes: 2 });
    await openLibraryModal(() => {});

    shareButton().click();

    expect(checkboxes().length).toBe(2);
    expect(document.querySelector(".library__row-actions")).toBeNull();
    expect(findButton(t().bundleUi.cancel)).toBeTruthy();
    expect(findButton(t().share.create)).toBeTruthy();
  });

  it("Create link is disabled with nothing ticked, and enabled for one or several", async () => {
    await saveToLibrary({ label: "a.json", text: "{}", savedAt: 1, bytes: 2 });
    await saveToLibrary({ label: "b.json", text: "[]", savedAt: 2, bytes: 2 });
    await openLibraryModal(() => {});
    shareButton().click();

    const createLink = () => findButton(t().share.create);
    expect(createLink().disabled).toBe(true);

    const boxes = checkboxes();
    boxes[0]!.click();
    expect(createLink().disabled).toBe(false);

    boxes[1]!.click();
    expect(createLink().disabled).toBe(false);

    boxes[0]!.click();
    boxes[1]!.click();
    expect(createLink().disabled).toBe(true);
  });

  it("one tick hands a single document to the existing share modal (version-2 shape, by subtitle)", async () => {
    const text = '{"data":null}';
    await saveToLibrary({ label: "solo.json", text, savedAt: 1, bytes: text.length });
    await openLibraryModal(() => {});
    shareButton().click();
    checkboxes()[0]!.click();
    findButton(t().share.create).click();

    // Give the (real, fake-indexeddb-backed) selection resolution a turn.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const subtitle = document.querySelector(".modal__subtitle");
    expect(subtitle?.textContent).toBe(`solo.json · ${formatBytes(text.length)}`);
  });

  it("several ticks hand the whole selection to the bundle share modal", async () => {
    await saveToLibrary({ label: "a.json", text: "{}", savedAt: 1, bytes: 2 });
    await saveToLibrary({ label: "b.json", text: "[]", savedAt: 2, bytes: 2 });
    await openLibraryModal(() => {});
    shareButton().click();
    for (const box of checkboxes()) box.click();
    findButton(t().share.create).click();

    await new Promise((resolve) => setTimeout(resolve, 20));

    const subtitle = document.querySelector(".modal__subtitle");
    expect(subtitle?.textContent).toBe(t().bundleUi.shareSubtitle(2, formatBytes(4)));
  });

  it("Cancel restores list mode with the modal still open, and discards the selection", async () => {
    await saveToLibrary({ label: "a.json", text: "{}", savedAt: 1, bytes: 2 });
    await openLibraryModal(() => {});
    shareButton().click();
    checkboxes()[0]!.click();

    findButton(t().bundleUi.cancel).click();

    expect(document.querySelector(".modal")).not.toBeNull();
    expect(document.querySelector(".library__checkbox")).toBeNull();
    expect(shareButton()).toBeTruthy();

    // The discard is real: re-entering selection mode starts unticked.
    shareButton().click();
    expect(checkboxes()[0]!.checked).toBe(false);
  });

  it("the first Escape leaves selection mode without closing the modal; the second closes it", async () => {
    await saveToLibrary({ label: "a.json", text: "{}", savedAt: 1, bytes: 2 });
    await openLibraryModal(() => {});
    shareButton().click();
    expect(checkboxes().length).toBe(1);

    pressEscape();
    expect(document.querySelector(".modal")).not.toBeNull();
    expect(document.querySelector(".library__checkbox")).toBeNull();

    pressEscape();
    expect(document.querySelector(".modal")).toBeNull();
  });

  it("a hostile label renders as text in the selection row", async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    await saveToLibrary({ label: hostile, text: "{}", savedAt: 1, bytes: 2 });
    await openLibraryModal(() => {});
    shareButton().click();

    expect(document.querySelector(".library__name")!.textContent).toBe(hostile);
    expect(document.querySelector(".library__row img")).toBeNull();
  });

  it("a ticked document deleted from another tab is dropped and named, and the rest still links", async () => {
    const survivorText = '{"ok":true}';
    const survivorId = await saveToLibrary({
      label: "survivor.json",
      text: survivorText,
      savedAt: 1,
      bytes: survivorText.length,
    });
    const goneId = await saveToLibrary({ label: "about-to-vanish.json", text: "{}", savedAt: 2, bytes: 2 });
    expect(survivorId).not.toBeNull();
    expect(goneId).not.toBeNull();

    await openLibraryModal(() => {});
    shareButton().click();
    for (const box of checkboxes()) box.click();

    // "Deleted from another tab" — removed from storage after the modal
    // listed it, but still ticked in this tab's already-rendered rows.
    const { deleteFromLibrary } = await import("../src/store.js");
    await deleteFromLibrary(goneId!);

    findButton(t().share.create).click();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Reported by label, not silently dropped.
    expect(document.getElementById("toast")!.textContent).toContain("about-to-vanish.json");

    // The survivor alone is exactly one document, so the fallback is the
    // single-document modal — proof the rest of the selection still linked.
    const subtitle = document.querySelector(".modal__subtitle");
    expect(subtitle?.textContent).toBe(`survivor.json · ${formatBytes(survivorText.length)}`);
  });
});
