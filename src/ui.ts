import { el } from "./dom.js";
import { t } from "./i18n/index.js";

/* ---------------------------------------------------------------- toast --- */

let toastTimer: number | undefined;

export function toast(message: string, tone: "info" | "error" = "info"): void {
  const node = document.getElementById("toast");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("toast--error", tone === "error");
  node.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove("is-visible"), 3400);
}

/* ---------------------------------------------------------------- modal --- */

export interface ModalHandle {
  close: () => void;
  root: HTMLElement;
}

/**
 * Open modals, innermost last. A stack rather than a single handle because a
 * dialog that *asks something about* what another dialog is showing — rename
 * or delete a row of the saved-documents list — must not dismiss the list to
 * ask. Only the top of the stack takes Escape and the Tab trap; everything
 * below stays mounted and reappears intact when the top closes.
 */
const modalStack: ModalHandle[] = [];

/** Is a modal currently open? Keyboard handlers need to know. */
export function modalIsOpen(): boolean {
  return modalStack.length > 0;
}

/** Closes the innermost modal only. */
export function closeModal(): void {
  modalStack[modalStack.length - 1]?.close();
}

/**
 * Closes every open modal, innermost first.
 *
 * Shift+Escape means "leave the document from anywhere, including out of a
 * dialog" — with a stack, closing just the top would leave the list behind it
 * mounted over a view the person has already left.
 */
export function closeAllModals(): void {
  while (modalStack.length > 0) {
    const top = modalStack[modalStack.length - 1]!;
    top.close();
    // A `close` that refuses to pop would spin here; drop it rather than hang.
    if (modalStack[modalStack.length - 1] === top) modalStack.pop();
  }
}

interface ModalOptions {
  title: string;
  subtitle?: string;
  /** Content. A function receives the handle, for bodies that need to close. */
  body: Node | ((handle: ModalHandle) => Node);
  footer?: Node | ((handle: ModalHandle) => Node);
  /** Extra class on the panel, e.g. for a wide raw-JSON view. */
  variant?: "wide" | "tall";
  /**
   * Called once when the modal closes, by whatever route — the ✕, Escape, a
   * click on the backdrop, `closeModal()`, or another modal replacing this
   * one. A dialog that answers a question needs this: every one of those
   * routes means "no answer", and without a single hook each would have to be
   * intercepted separately. Never called twice.
   */
  onClose?: () => void;
  /**
   * Open *over* whatever is already open instead of replacing it.
   *
   * Off by default, because replacing is what every modal in this app did
   * before and what its flows are built around — opening the share modal from
   * the saved-documents list is meant to leave the list behind. Only a dialog
   * that asks a question *about* the modal underneath it needs the other
   * behaviour, and for that one the list must survive being asked.
   */
  stack?: boolean;
}

export function openModal(options: ModalOptions): ModalHandle {
  // Default: one at a time, as before. `stack` opts out.
  if (!options.stack) closeAllModals();

  const host = document.getElementById("modal-root");
  if (!host) throw new Error("Missing #modal-root");

  const previouslyFocused = document.activeElement as HTMLElement | null;

  const panel = el("div", {
    class: `modal__panel${options.variant ? ` modal__panel--${options.variant}` : ""}`,
    role: "dialog",
    "aria-modal": "true",
    "aria-label": options.title,
  });

  const root = el("div", { class: "modal" }, panel);

  const handle: ModalHandle = {
    root,
    close: () => {
      const at = modalStack.indexOf(handle);
      if (at === -1) return;
      modalStack.splice(at, 1);
      document.removeEventListener("keydown", onKeydown, true);
      root.remove();
      // Only once nothing is left, or closing an inner dialog would unlock
      // scrolling while the list behind it is still open.
      if (modalStack.length === 0) document.body.classList.remove("has-modal");
      previouslyFocused?.focus?.();
      // Last, and after the guard above, so it runs exactly once and only for
      // a modal that was actually open.
      options.onClose?.();
    },
  };

  function onKeydown(event: KeyboardEvent): void {
    // Every open modal has a listener on `document`; only the innermost one
    // may act, or Escape would close the whole stack at once and the Tab trap
    // would fight itself between two panels.
    if (modalStack[modalStack.length - 1] !== handle) return;

    if (event.key === "Escape") {
      // Shift+Escape is "leave the document" and is handled globally; a plain
      // Escape closes the modal. Do not let the two fire together.
      if (event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      handle.close();
      return;
    }

    if (event.key !== "Tab") return;

    // Keep focus inside the dialog.
    const focusable = panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const close = el("button", {
    class: "modal__close",
    type: "button",
    "aria-label": t().modal.close,
    text: "✕",
  });
  close.addEventListener("click", () => handle.close());

  panel.append(
    el(
      "header",
      { class: "modal__head" },
      el(
        "div",
        { class: "modal__titles" },
        el("h2", { class: "modal__title", text: options.title }),
        options.subtitle && el("p", { class: "modal__subtitle", text: options.subtitle }),
      ),
      close,
    ),
    el(
      "div",
      { class: "modal__body" },
      typeof options.body === "function" ? options.body(handle) : options.body,
    ),
  );

  if (options.footer) {
    panel.append(
      el(
        "footer",
        { class: "modal__foot" },
        typeof options.footer === "function" ? options.footer(handle) : options.footer,
      ),
    );
  }

  root.addEventListener("mousedown", (event) => {
    if (event.target === root) handle.close();
  });

  host.append(root);
  document.body.classList.add("has-modal");
  document.addEventListener("keydown", onKeydown, true);
  modalStack.push(handle);

  // Focus the first control so the dialog is immediately keyboard-operable.
  const focusTarget =
    panel.querySelector<HTMLElement>("[data-autofocus]") ??
    panel.querySelector<HTMLElement>("button, a[href], input, textarea, select");
  focusTarget?.focus();

  return handle;
}

/* -------------------------------------------------------------- buttons --- */

/** A small icon-ish action button, as used on resource rows and value rows. */
export function actionButton(
  label: string,
  title: string,
  onClick: (event: MouseEvent) => void,
  extraClass = "",
): HTMLButtonElement {
  const button = el("button", {
    class: `act${extraClass ? ` ${extraClass}` : ""}`,
    type: "button",
    title,
    "aria-label": title,
    text: label,
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick(event);
  });
  return button;
}

/* ------------------------------------------------------- ask the person --- */

/**
 * `window.confirm` and `window.prompt`, as this app's own modal.
 *
 * The native pair were the only two places the interface handed the person
 * over to browser chrome: unstyled, untranslated (the browser picks the
 * button language, not `t()`), unfocusable by our own rules, and — the reason
 * this became urgent — **blocked outright in some embedded and sandboxed
 * contexts**, where the app simply appeared to do nothing when a row's
 * `rename` or `delete` was clicked.
 *
 * Both return a promise that settles exactly once, and **every route out of
 * the dialog is an answer**: Escape, the ✕, a click on the backdrop and
 * another modal replacing this one all mean "no" (`false` / `null`), the same
 * as the cancel button. That is what `onClose` above exists for.
 */
export function confirmModal(options: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** `danger` for a destructive action, so the confirm button reads as one. */
  tone?: "default" | "danger";
}): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (answer: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(answer);
    };

    const confirm = el("button", {
      class: `btn ${options.tone === "danger" ? "btn--danger" : "btn--primary"}`,
      type: "button",
      text: options.confirmLabel,
    });
    // The confirming button takes focus, not cancel: the person clicked an
    // action and is being asked to complete it, and Escape is always the way
    // out. A destructive confirm is still guarded by having to be read.
    confirm.dataset["autofocus"] = "true";

    const cancel = el("button", {
      class: "btn",
      type: "button",
      text: options.cancelLabel,
    });

    openModal({
      title: options.title,
      body: el("p", { class: "ask__message", text: options.message }),
      footer: (handle) => {
        cancel.addEventListener("click", () => handle.close());
        confirm.addEventListener("click", () => {
          settle(true);
          handle.close();
        });
        return el("div", { class: "modal__actions" }, cancel, confirm);
      },
      stack: true,
      onClose: () => settle(false),
    });
  });
}

/** Ask for one line of text. Resolves `null` if the person backs out. */
export function promptModal(options: {
  title: string;
  label: string;
  value: string;
  confirmLabel: string;
  cancelLabel: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (answer: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(answer);
    };

    const input = el("input", {
      class: "field",
      type: "text",
      value: options.value,
      "aria-label": options.label,
      spellcheck: false,
    });
    input.dataset["autofocus"] = "true";

    const confirm = el("button", {
      class: "btn btn--primary",
      type: "button",
      text: options.confirmLabel,
    });
    const cancel = el("button", { class: "btn", type: "button", text: options.cancelLabel });

    openModal({
      title: options.title,
      body: el(
        "div",
        { class: "ask" },
        el("label", { class: "ask__label", text: options.label }),
        input,
      ),
      footer: (handle) => {
        // An empty or whitespace-only name is not a rename; it is the person
        // having second thoughts with the field cleared. Treated as cancel
        // rather than silently keeping the old name, which would look like
        // the button did nothing.
        const submit = (): void => {
          const trimmed = input.value.trim();
          settle(trimmed === "" ? null : trimmed);
          handle.close();
        };
        confirm.addEventListener("click", submit);
        cancel.addEventListener("click", () => handle.close());
        input.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          submit();
        });
        return el("div", { class: "modal__actions" }, cancel, confirm);
      },
      stack: true,
      onClose: () => settle(null),
    });

    input.select();
  });
}
