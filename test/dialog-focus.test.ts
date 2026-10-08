/**
 * QA5 — where focus goes when a dialog closes.
 *
 * The rule (docs/task-specs/QA5.md): the control that opened it, if still in
 * the document; else the opener of the dialog this one replaced; else the
 * dialog still open underneath; else the main content — never `<body>`.
 *
 * jsdom has no layout, but focus is not layout: `document.activeElement`,
 * `isConnected` and `focus()` are all real here, so this can genuinely fail.
 * What it cannot see is scroll position (`preventScroll`) — that is a browser
 * scenario, and is asserted in the headless-Chrome run recorded in the evidence.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeAllModals, confirmModal, openModal, promptModal } from "../src/ui.js";

/** Static test markup, parsed as a document so no element is ever assigned HTML. */
const parse = (html: string): ChildNode[] => [...new DOMParser().parseFromString(html, "text/html").body.childNodes];

beforeEach(() => {
  document.body.replaceChildren(
    ...parse(
      '<header><button id="opener">Open</button><button id="other">Other</button></header>' +
        '<main id="view"><button id="inside-main">In main</button></main>' +
        '<div id="modal-root"></div><div id="toast"></div>',
    ),
  );
});
afterEach(() => closeAllModals());

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const escape = (): void => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
};
const body = (): HTMLElement => {
  const div = document.createElement("div");
  div.append(...parse('<button id="in-dialog">x</button>'));
  return div;
};

/** Click `target` the way a browser that does not focus buttons on click does (Safari): dispatch only. */
function clickWithoutFocus(target: HTMLElement): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("a top-level dialog", () => {
  it("returns focus to the control that opened it on Escape", () => {
    $("opener").focus();
    openModal({ title: "T", body: body() });
    expect(document.activeElement).not.toBe($("opener"));
    escape();
    expect(document.activeElement).toBe($("opener"));
  });

  it("does so when the opener was clicked but never focused, which is Safari and Firefox on macOS", () => {
    expect(document.activeElement).toBe(document.body);
    $("opener").addEventListener("click", () => openModal({ title: "T", body: body() }));
    clickWithoutFocus($("opener"));
    escape();
    expect(document.activeElement).toBe($("opener"));
  });

  it("does so on the close button and on a backdrop click as well", () => {
    $("opener").focus();
    const handle = openModal({ title: "T", body: body() });
    handle.root.querySelector<HTMLButtonElement>(".modal__close")!.click();
    expect(document.activeElement).toBe($("opener"));

    $("other").focus();
    const second = openModal({ title: "T", body: body() });
    second.root.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(document.activeElement).toBe($("other"));
  });

  it("falls back to the main content, never <body>, when it was opened from a shortcut with nothing focused", () => {
    expect(document.activeElement).toBe(document.body);
    openModal({ title: "T", body: body() });
    escape();
    expect(document.activeElement).toBe($("view"));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("falls back when the opener has since been removed from the page", () => {
    $("opener").focus();
    openModal({ title: "T", body: body() });
    $("opener").remove();
    escape();
    expect(document.activeElement).toBe($("view"));
  });

  it("moves on when the opener is in the document but cannot take focus (collapsed <details>, display: none)", () => {
    // jsdom has no layout, so a hidden element would still accept focus; stand in for the
    // browser's silent no-op, which is the behaviour that matters.
    $("opener").focus();
    openModal({ title: "T", body: body() });
    $("opener").focus = () => {};
    escape();
    expect(document.activeElement).toBe($("view"));
  });

  it("does not focus a disabled opener", () => {
    $("opener").focus();
    openModal({ title: "T", body: body() });
    ($("opener") as HTMLButtonElement).disabled = true;
    escape();
    expect(document.activeElement).toBe($("view"));
  });

  it("a keypress after a click makes the click stale: the keyboard's focus is the truth", () => {
    clickWithoutFocus($("other")); // an earlier click, on something that did not open a dialog
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true }));
    $("opener").focus();
    openModal({ title: "T", body: body() });
    escape();
    expect(document.activeElement).toBe($("opener"));
  });
});

describe("a dialog that replaces another", () => {
  it("returns to the first dialog's opener when its own opener went away with the first dialog", () => {
    $("opener").focus();
    const list = openModal({ title: "List", body: body() });
    const share = document.createElement("button");
    share.id = "share-in-list";
    list.root.append(share);
    share.focus();
    // The "Share" button lives inside the list, which opening the share dialog closes.
    openModal({ title: "Share", body: body() });
    expect(list.root.isConnected).toBe(false);
    escape();
    expect(document.activeElement).toBe($("opener"));
  });
});

describe("a nested dialog", () => {
  it("returns to the Rename button that opened it, not to the list's Close button", async () => {
    $("opener").focus();
    const list = openModal({ title: "List", body: body() });
    const rename = document.createElement("button");
    rename.id = "rename-row";
    list.root.querySelector(".modal__body")!.append(rename);
    rename.focus();

    void promptModal({ title: "Rename", label: "Name", value: "x", confirmLabel: "OK", cancelLabel: "No" });
    escape();
    expect(document.activeElement).toBe(rename);
    expect(document.activeElement?.classList.contains("modal__close")).toBe(false);
  });

  it("does so when the Rename button was clicked without taking focus, so `activeElement` was the Close button", () => {
    const list = openModal({ title: "List", body: body() });
    const close = list.root.querySelector<HTMLElement>(".modal__close")!;
    const del = document.createElement("button");
    list.root.querySelector(".modal__body")!.append(del);
    close.focus(); // what the library's own autofocus leaves behind
    del.addEventListener("click", () => void confirmModal({ title: "D", message: "m", confirmLabel: "Y", cancelLabel: "N" }));
    clickWithoutFocus(del);
    escape();
    expect(document.activeElement).toBe(del);
  });

  it("when its opener is gone, lands inside the dialog underneath rather than on <body>", () => {
    const list = openModal({ title: "List", body: body() });
    const row = document.createElement("button");
    list.root.querySelector(".modal__body")!.append(row);
    row.focus();
    void confirmModal({ title: "D", message: "m", confirmLabel: "Y", cancelLabel: "N" });
    row.remove();
    escape();
    expect(list.root.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });
});
