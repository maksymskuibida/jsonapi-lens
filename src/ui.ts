import { el } from "./dom.js";

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

let openModalHandle: ModalHandle | null = null;

/** Is a modal currently open? Keyboard handlers need to know. */
export function modalIsOpen(): boolean {
  return openModalHandle !== null;
}

export function closeModal(): void {
  openModalHandle?.close();
}

interface ModalOptions {
  title: string;
  subtitle?: string;
  /** Content. A function receives the handle, for bodies that need to close. */
  body: Node | ((handle: ModalHandle) => Node);
  footer?: Node | ((handle: ModalHandle) => Node);
  /** Extra class on the panel, e.g. for a wide raw-JSON view. */
  variant?: "wide" | "tall";
}

export function openModal(options: ModalOptions): ModalHandle {
  // Only one at a time; opening a second replaces the first.
  openModalHandle?.close();

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
      if (openModalHandle !== handle) return;
      openModalHandle = null;
      document.removeEventListener("keydown", onKeydown, true);
      root.remove();
      document.body.classList.remove("has-modal");
      previouslyFocused?.focus?.();
    },
  };

  function onKeydown(event: KeyboardEvent): void {
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
    "aria-label": "Close",
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
  openModalHandle = handle;

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
