import { copyText } from "./clipboard.js";
import { el } from "./dom.js";
import { formatBytes } from "./format.js";
import { generateSecret, open as openSealed, seal, ShareError, shareSupported } from "./crypto.js";
import type { SharePayload } from "./crypto.js";
import { shareUrl } from "./router.js";
import { openModal, toast } from "./ui.js";

/** Lifetimes offered, matching the Worker's table. */
export const LIFETIMES = [
  { key: "15m", label: "15 minutes" },
  { key: "6h", label: "6 hours" },
  { key: "1d", label: "1 day" },
  { key: "1w", label: "1 week" },
  { key: "1m", label: "1 month" },
  { key: "forever", label: "No expiry" },
] as const;

export type LifetimeKey = (typeof LIFETIMES)[number]["key"];

const LIFETIME_KEY = "jsonapi-lens:share-lifetime";
const DEFAULT_LIFETIME: LifetimeKey = "1d";

function readLifetime(): LifetimeKey {
  try {
    const stored = localStorage.getItem(LIFETIME_KEY);
    if (stored && LIFETIMES.some((l) => l.key === stored)) return stored as LifetimeKey;
  } catch {
    /* storage may be blocked */
  }
  return DEFAULT_LIFETIME;
}

function writeLifetime(key: LifetimeKey): void {
  try {
    localStorage.setItem(LIFETIME_KEY, key);
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------ transport --- */

interface CreatedShare {
  id: number;
  expiresAt: number | null;
}

async function upload(blob: Uint8Array, lifetime: LifetimeKey): Promise<CreatedShare> {
  const response = await fetch(`/api/shares?lifetime=${encodeURIComponent(lifetime)}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: blob as BodyInit,
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => null);
    throw new ShareError(
      "The share could not be created.",
      detail ?? `The server returned ${response.status}.`,
    );
  }

  return (await response.json()) as CreatedShare;
}

/** Fetch and decrypt a shared document. */
export async function fetchShare(id: number, secret: string): Promise<SharePayload> {
  let response: Response;
  try {
    response = await fetch(`/api/shares/${id}`);
  } catch {
    throw new ShareError(
      "That shared document could not be fetched.",
      "The network request failed. Check your connection and try again.",
    );
  }

  if (response.status === 404) {
    throw new ShareError(
      "That shared document no longer exists.",
      "It was either never created, or it has already been deleted.",
    );
  }
  if (response.status === 410) {
    throw new ShareError(
      "That share link has expired.",
      "Share links are deleted when their lifetime runs out. Ask for a fresh link.",
    );
  }
  if (!response.ok) {
    throw new ShareError(
      "That shared document could not be fetched.",
      `The server returned ${response.status}.`,
    );
  }

  const blob = new Uint8Array(await response.arrayBuffer()) as Uint8Array<ArrayBuffer>;
  return openSealed(blob, secret);
}

/* ---------------------------------------------------------------- modal --- */

function expiryNote(expiresAt: number | null): string {
  if (expiresAt === null) return "This link does not expire. It stays until you ask for it to go.";
  return `This link stops working on ${new Date(expiresAt).toLocaleString()}.`;
}

export function openShareModal(text: string, label: string): void {
  if (!shareSupported()) {
    toast("This browser cannot encrypt a share link (needs WebCrypto and CompressionStream).", "error");
    return;
  }

  let lifetime = readLifetime();

  const body = el("div", { class: "share" });

  const choices = el("div", { class: "share__choices", role: "radiogroup", "aria-label": "Link lifetime" });
  const buttons: HTMLButtonElement[] = [];
  for (const option of LIFETIMES) {
    const button = el("button", {
      class: "share__choice",
      type: "button",
      role: "radio",
      "aria-checked": String(option.key === lifetime),
      "data-lifetime": option.key,
      text: option.label,
    });
    button.addEventListener("click", () => {
      lifetime = option.key;
      writeLifetime(lifetime);
      for (const other of buttons) {
        other.setAttribute("aria-checked", String(other.dataset["lifetime"] === lifetime));
      }
    });
    buttons.push(button);
    choices.append(button);
  }

  const status = el("p", { class: "share__status", role: "status" });
  const result = el("div", { class: "share__result", hidden: true });

  body.append(
    el(
      "p",
      { class: "share__lede" },
      "The document is gzipped and encrypted in this tab. The key is generated here and lives only in the link — the server stores an opaque blob it cannot read. Creating and opening a link each take a moment, because the short key is deliberately expensive to derive.",
    ),
    el("h3", { class: "share__label", text: "Link lifetime" }),
    choices,
    el(
      "p",
      { class: "share__note" },
      "Anyone with the link can read the document, so treat it like the payload itself. The key sits in the URL path, so it reaches browser history and anything else that handles the link — send it the way you would send the payload.",
    ),
    status,
    result,
  );

  const create = el("button", { class: "btn btn--primary", type: "button", text: "Create link" });
  create.dataset["autofocus"] = "true";

  const footer = el("div", { class: "share__actions" }, create);

  openModal({
    title: "Share this document",
    subtitle: `${label} · ${formatBytes(new TextEncoder().encode(text).byteLength)}`,
    body,
    footer,
  });

  create.addEventListener("click", async () => {
    create.disabled = true;
    for (const button of buttons) button.disabled = true;
    // Deriving the key is deliberately slow, so say so rather than looking hung.
    status.textContent = "Deriving the key and encrypting…";

    try {
      const secret = generateSecret();
      const payload: SharePayload = { text, label, savedAt: Date.now() };
      const blob = await seal(payload, secret);

      status.textContent = `Uploading ${formatBytes(blob.byteLength)}…`;
      const created = await upload(blob, lifetime);

      const url = shareUrl(created.id, secret);
      status.textContent = "";

      const field = el("input", {
        class: "share__url",
        type: "text",
        readonly: true,
        value: url,
        "aria-label": "Share link",
      });
      const copy = el("button", { class: "btn btn--primary", type: "button", text: "Copy link" });
      copy.addEventListener("click", () => void copyText(url, "share link"));

      result.replaceChildren(
        el("h3", { class: "share__label", text: "Link" }),
        el("div", { class: "share__url-row" }, field, copy),
        el(
          "p",
          { class: "share__meta" },
          `${expiryNote(created.expiresAt)} Encrypted size ${formatBytes(blob.byteLength)}, from ${formatBytes(new TextEncoder().encode(text).byteLength)} of JSON.`,
        ),
      );
      result.hidden = false;
      field.select();
      copy.focus();

      create.remove();
      // Copying is now the only thing left to do, so retire the create button.
      void copyText(url, "share link");
    } catch (error) {
      status.textContent = "";
      const shareError =
        error instanceof ShareError
          ? error
          : new ShareError("The share could not be created.", String(error));
      result.replaceChildren(
        el(
          "div",
          { class: "share__error" },
          el("p", { class: "share__error-headline", text: shareError.headline }),
          el("p", { class: "share__error-hint", text: shareError.hint }),
        ),
      );
      result.hidden = false;
      create.disabled = false;
      for (const button of buttons) button.disabled = false;
    }
  });
}
