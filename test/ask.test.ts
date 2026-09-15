/**
 * `confirmModal` / `promptModal` — this app's replacements for
 * `window.confirm` and `window.prompt`, and the library rename/delete flows
 * built on them.
 *
 * The native pair were not merely unstyled and untranslated: they are
 * **blocked outright in some embedded and sandboxed contexts**, where
 * clicking `rename` threw `prompt() is not supported` and clicking `delete`
 * silently did nothing. That is the defect these tests exist to keep fixed,
 * so the first thing asserted is that neither native function is called at
 * all — a jsdom `window.prompt` that throws stands in for the blocked host.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmModal, promptModal, openModal, modalIsOpen, closeAllModals } from "../src/ui.js";
import { openLibraryModal } from "../src/panels.js";
import { saveToLibrary, listLibrary } from "../src/store.js";
import { t } from "../src/i18n/index.js";

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("jsonapi-lens");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  document.body.innerHTML = '<div id="modal-root"></div><div id="toast"></div>';
});

const panels = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(".modal__panel")];
const topPanel = (): HTMLElement => panels()[panels().length - 1]!;
const button = (text: string, within: HTMLElement = topPanel()): HTMLButtonElement =>
  [...within.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
const pressEscape = (): void => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
};

/**
 * Wait for a condition rather than for a fixed number of ticks. The rename and
 * delete handlers await an IndexedDB write before they re-render, and a single
 * `setTimeout(0)` is sometimes enough and sometimes not — which is a flake
 * that would land on whoever next touched this file, not on me.
 */
async function until(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for: ${what}`);
}

describe("confirmModal", () => {
  it("resolves true only when the confirming button is used", async () => {
    const answer = confirmModal({ title: "T", message: "M", confirmLabel: "Yes", cancelLabel: "No" });
    button("Yes").click();
    expect(await answer).toBe(true);
  });

  it("treats cancel, Escape and the backdrop as the same answer: no", async () => {
    const viaCancel = confirmModal({ title: "T", message: "M", confirmLabel: "Yes", cancelLabel: "No" });
    button("No").click();
    expect(await viaCancel).toBe(false);

    const viaEscape = confirmModal({ title: "T", message: "M", confirmLabel: "Yes", cancelLabel: "No" });
    pressEscape();
    expect(await viaEscape).toBe(false);

    const viaBackdrop = confirmModal({ title: "T", message: "M", confirmLabel: "Yes", cancelLabel: "No" });
    document
      .querySelector(".modal")!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(await viaBackdrop).toBe(false);
  });

  it("settles exactly once, even if the modal is closed after answering", async () => {
    let settlements = 0;
    const answer = confirmModal({ title: "T", message: "M", confirmLabel: "Yes", cancelLabel: "No" }).then(
      (value) => {
        settlements += 1;
        return value;
      },
    );
    button("Yes").click();
    closeAllModals();
    expect(await answer).toBe(true);
    expect(settlements).toBe(1);
  });

  it("marks a destructive confirm as destructive", () => {
    void confirmModal({ title: "T", message: "M", confirmLabel: "Delete", cancelLabel: "No", tone: "danger" });
    expect(button("Delete").className).toContain("btn--danger");
    void confirmModal({ title: "T", message: "M", confirmLabel: "Go", cancelLabel: "No" });
    expect(button("Go").className).toContain("btn--primary");
  });
});

describe("promptModal", () => {
  it("resolves the trimmed text", async () => {
    const answer = promptModal({ title: "T", label: "L", value: "old", confirmLabel: "OK", cancelLabel: "No" });
    topPanel().querySelector("input")!.value = "  new name  ";
    button("OK").click();
    expect(await answer).toBe("new name");
  });

  it("opens prefilled, and Enter submits", async () => {
    const answer = promptModal({ title: "T", label: "L", value: "prefilled", confirmLabel: "OK", cancelLabel: "No" });
    const input = topPanel().querySelector("input")!;
    expect(input.value).toBe("prefilled");
    input.value = "typed";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(await answer).toBe("typed");
  });

  it("treats an emptied field as backing out, not as renaming to nothing", async () => {
    const answer = promptModal({ title: "T", label: "L", value: "old", confirmLabel: "OK", cancelLabel: "No" });
    topPanel().querySelector("input")!.value = "   ";
    button("OK").click();
    expect(await answer).toBeNull();
  });

  it("resolves null on cancel and on Escape", async () => {
    const viaCancel = promptModal({ title: "T", label: "L", value: "x", confirmLabel: "OK", cancelLabel: "No" });
    button("No").click();
    expect(await viaCancel).toBeNull();

    const viaEscape = promptModal({ title: "T", label: "L", value: "x", confirmLabel: "OK", cancelLabel: "No" });
    pressEscape();
    expect(await viaEscape).toBeNull();
  });
});

describe("stacking", () => {
  it("opens over the modal underneath rather than replacing it, and Escape closes only the top", async () => {
    openModal({ title: "Underneath", body: document.createElement("div") });
    const answer = confirmModal({ title: "On top", message: "M", confirmLabel: "Yes", cancelLabel: "No" });
    expect(panels().length).toBe(2);

    pressEscape();
    expect(await answer).toBe(false);
    expect(panels().length).toBe(1);
    expect(document.querySelector(".modal__title")!.textContent).toBe("Underneath");
    expect(modalIsOpen()).toBe(true);
  });

  it("an ordinary modal still replaces, so existing flows are unchanged", () => {
    openModal({ title: "First", body: document.createElement("div") });
    openModal({ title: "Second", body: document.createElement("div") });
    expect(panels().length).toBe(1);
    expect(document.querySelector(".modal__title")!.textContent).toBe("Second");
  });

  it("closeAllModals leaves nothing open, and unlocks the body", () => {
    openModal({ title: "A", body: document.createElement("div") });
    void confirmModal({ title: "B", message: "M", confirmLabel: "Y", cancelLabel: "N" });
    expect(document.body.classList.contains("has-modal")).toBe(true);
    closeAllModals();
    expect(panels().length).toBe(0);
    expect(modalIsOpen()).toBe(false);
    expect(document.body.classList.contains("has-modal")).toBe(false);
  });

  it("keeps the body locked while an inner dialog closes over an outer one", async () => {
    openModal({ title: "A", body: document.createElement("div") });
    const answer = confirmModal({ title: "B", message: "M", confirmLabel: "Y", cancelLabel: "N" });
    button("N").click();
    await answer;
    expect(document.body.classList.contains("has-modal")).toBe(true);
  });
});

describe("the library uses them, and never the native dialogs", () => {
  it("renames through our own modal, with the list still open behind it", async () => {
    const native = vi.spyOn(window, "prompt").mockImplementation(() => {
      throw new Error("prompt() is not supported.");
    });
    await saveToLibrary({ label: "before.json", text: "{}", savedAt: 1, bytes: 2 });
    await openLibraryModal(() => {});

    button("rename", panels()[0]!).click();
    await Promise.resolve();
    expect(panels().length).toBe(2);

    topPanel().querySelector("input")!.value = "after.json";
    button(t().library.renameTitle).click();
    await until(async () => (await listLibrary())[0]?.label === "after.json", "the rename to be stored");

    expect((await listLibrary())[0]!.label).toBe("after.json");
    expect(panels().length).toBe(1);
    expect(native).not.toHaveBeenCalled();
    native.mockRestore();
  });

  it("deletes through our own modal, and cancelling deletes nothing", async () => {
    const native = vi.spyOn(window, "confirm").mockImplementation(() => {
      throw new Error("confirm() is not supported.");
    });
    await saveToLibrary({ label: "keep.json", text: "{}", savedAt: 1, bytes: 2 });
    await openLibraryModal(() => {});

    button("delete", panels()[0]!).click();
    await Promise.resolve();
    button(t().modal.cancel).click();
    await until(() => panels().length === 1, "the confirm dialog to close");
    expect(await listLibrary()).toHaveLength(1);

    button("delete", panels()[0]!).click();
    await Promise.resolve();
    button(t().library.deleteTitle).click();
    await until(async () => (await listLibrary()).length === 0, "the delete to be stored");
    expect(await listLibrary()).toHaveLength(0);

    expect(native).not.toHaveBeenCalled();
    native.mockRestore();
  });

  /*
   * `render` rebuilds the list wholesale, destroying whatever node had focus.
   * Without help, focus fell back to the dialog's ✕ — inside the panel, so the
   * Tab trap still worked, but a long way from the row just acted on. These
   * assert the row, not merely the panel: "somewhere in the dialog" passes
   * either way and would not have caught it.
   */
  it("returns focus to the renamed row, not to the dialog's close button", async () => {
    await saveToLibrary({ label: "before.json", text: "{}", savedAt: 1, bytes: 2 });
    await openLibraryModal(() => {});

    button("rename", panels()[0]!).click();
    await Promise.resolve();
    topPanel().querySelector("input")!.value = "after.json";
    button(t().library.renameTitle).click();
    await until(async () => (await listLibrary())[0]?.label === "after.json", "the rename to be stored");

    const focused = document.activeElement as HTMLElement | null;
    expect(focused?.classList.contains("library__rename")).toBe(true);
    expect(focused?.closest(".library__row")?.getAttribute("data-row-id")).toBeTruthy();
  });

  it("lands focus on the surviving list after a delete, not on the close button", async () => {
    await saveToLibrary({ label: "one.json", text: "{}", savedAt: 1, bytes: 2 });
    await saveToLibrary({ label: "two.json", text: "{}", savedAt: 2, bytes: 2 });
    await openLibraryModal(() => {});

    button("delete", panels()[0]!).click();
    await Promise.resolve();
    button(t().library.deleteTitle).click();
    await until(async () => (await listLibrary()).length === 1, "the delete to be stored");

    const focused = document.activeElement as HTMLElement | null;
    expect(focused?.closest(".library")).not.toBeNull();
    expect(focused?.classList.contains("modal__close")).toBe(false);
  });

  it("still keeps focus in the dialog when the last row is deleted and the list empties", async () => {
    await saveToLibrary({ label: "only.json", text: "{}", savedAt: 1, bytes: 2 });
    await openLibraryModal(() => {});

    button("delete", panels()[0]!).click();
    await Promise.resolve();
    button(t().library.deleteTitle).click();
    await until(async () => (await listLibrary()).length === 0, "the delete to be stored");

    // Nothing in the list to land on; the dialog must still hold focus.
    expect(panels()[0]!.contains(document.activeElement)).toBe(true);
  });

  it("settles false when a replacing modal opens over a pending ask", async () => {
    // The route the PR body calls out as the forgotten-route hazard, and the
    // one the first round left untested.
    const answer = confirmModal({ title: "T", message: "M", confirmLabel: "Y", cancelLabel: "N" });
    openModal({ title: "Replacing", body: document.createElement("div") });
    expect(await answer).toBe(false);
  });

  it("closeAllModals settles a pending ask rather than leaving it hanging", async () => {
    const answer = promptModal({ title: "T", label: "L", value: "x", confirmLabel: "OK", cancelLabel: "No" });
    closeAllModals();
    expect(await answer).toBeNull();
  });

  it("tells the caller which entry was renamed, so the open document can follow", async () => {
    // The modal knows which entry moved; the caller knows which is on screen.
    // Without this, renaming the document currently open left the topbar and
    // the page title reading the old name until something else re-rendered.
    await saveToLibrary({ label: "before.json", text: '{"a":1}', savedAt: 1, bytes: 7 });
    const changes: unknown[] = [];
    await openLibraryModal(
      () => {},
      (change) => changes.push(change),
    );

    button("rename", panels()[0]!).click();
    await Promise.resolve();
    topPanel().querySelector("input")!.value = "after.json";
    button(t().library.renameTitle).click();
    await until(async () => (await listLibrary())[0]?.label === "after.json", "the rename to be stored");

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: "renamed" });
    // The text is what identifies the document to the caller.
    expect((changes[0] as { entry: { text: string; label: string } }).entry).toMatchObject({
      text: '{"a":1}',
      label: "after.json",
    });
  });

  it("reports a delete as a delete, not as a rename", async () => {
    await saveToLibrary({ label: "gone.json", text: "{}", savedAt: 1, bytes: 2 });
    const changes: { kind: string }[] = [];
    await openLibraryModal(
      () => {},
      (change) => change && changes.push(change),
    );

    button("delete", panels()[0]!).click();
    await Promise.resolve();
    button(t().library.deleteTitle).click();
    await until(async () => (await listLibrary()).length === 0, "the delete to be stored");

    expect(changes.map((c) => c.kind)).toEqual(["deleted"]);
  });

  it("keeps the header count in step with the list it is describing", async () => {
    await saveToLibrary({ label: "one.json", text: "{}", savedAt: 1, bytes: 2 });
    await saveToLibrary({ label: "two.json", text: "{}", savedAt: 2, bytes: 2 });
    await openLibraryModal(() => {});
    const subtitle = (): string => document.querySelector(".modal__subtitle")!.textContent!;
    expect(subtitle()).toBe(t().library.countInBrowser(2));

    button("delete", panels()[0]!).click();
    await Promise.resolve();
    button(t().library.deleteTitle).click();
    await until(() => subtitle() === t().library.countInBrowser(1), "the count to read 1");
    expect(subtitle()).toBe(t().library.countInBrowser(1));

    button("delete", panels()[0]!).click();
    await Promise.resolve();
    button(t().library.deleteTitle).click();
    await until(() => subtitle() === t().library.storedLocally, "the count to fall back");
    // The one that used to read "1 in this browser" over "Nothing saved yet."
    expect(subtitle()).toBe(t().library.storedLocally);
  });
});
