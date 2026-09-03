import { copyText } from "./clipboard.js";
import { el } from "./dom.js";
import { formatBytes } from "./format.js";
import { t } from "./i18n/index.js";
import {
  generateSecret,
  isBundlePayload,
  open as openSealed,
  seal,
  ShareError,
  shareSupported,
} from "./crypto.js";
import type { SharePayload } from "./crypto.js";
import { shareUrl } from "./router.js";
import { openModal, toast } from "./ui.js";

/**
 * Lifetimes offered, matching the Worker's table.
 *
 * Only the keys live here; the labels come from the catalogue, keyed by the
 * same strings, so a translation cannot invent a lifetime the Worker does not
 * accept.
 */
export const LIFETIMES = ["15m", "6h", "1d", "1w", "1m", "forever"] as const;

export type LifetimeKey = (typeof LIFETIMES)[number];

const LIFETIME_KEY = "jsonapi-lens:share-lifetime";
const DEFAULT_LIFETIME: LifetimeKey = "1d";

function readLifetime(): LifetimeKey {
  try {
    const stored = localStorage.getItem(LIFETIME_KEY);
    if (stored && (LIFETIMES as readonly string[]).includes(stored)) return stored as LifetimeKey;
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
      t().shareErrors.createFailed.headline,
      detail ?? t().shareErrors.createFailed.serverStatus(response.status),
    );
  }

  return (await response.json()) as CreatedShare;
}

/**
 * Fetch and decrypt a single-document share.
 *
 * `open` (from `crypto.ts`) can return either a `SharePayload` or a
 * `BundlePayload` — that is the whole point of a version-3 link declaring its
 * own kind — but this task adds no view for a bundle: T6 owns the import
 * screen a bundle needs, and until it lands the only caller of this function
 * (`main.ts`'s share route) has nowhere to put several documents. So this
 * keeps its existing, narrower contract and refuses cleanly rather than
 * handing back a payload with no `text` for that caller to render blank.
 * T6 reaches for `open`/`isBundlePayload` directly once it has a view to
 * offer either shape to.
 */
export async function fetchShare(id: number, secret: string): Promise<SharePayload> {
  let response: Response;
  try {
    response = await fetch(`/api/shares/${id}`);
  } catch {
    throw new ShareError(
      t().shareErrors.fetchFailed.headline,
      t().shareErrors.fetchFailed.network,
    );
  }

  if (response.status === 404) {
    throw new ShareError(t().shareErrors.gone.headline, t().shareErrors.gone.hint);
  }
  if (response.status === 410) {
    throw new ShareError(t().shareErrors.expired.headline, t().shareErrors.expired.hint);
  }
  if (!response.ok) {
    throw new ShareError(
      t().shareErrors.fetchFailed.headline,
      t().shareErrors.createFailed.serverStatus(response.status),
    );
  }

  const blob = new Uint8Array(await response.arrayBuffer()) as Uint8Array<ArrayBuffer>;
  const payload = await openSealed(blob, secret);
  if (isBundlePayload(payload)) {
    throw new ShareError(t().bundle.errors.unavailable.headline, t().bundle.errors.unavailable.hint);
  }
  return payload;
}

/* ---------------------------------------------------------------- modal --- */

function expiryNote(expiresAt: number | null): string {
  if (expiresAt === null) return t().share.neverExpires;
  return t().share.expiresOn(expiresAt);
}

export function openShareModal(text: string, label: string): void {
  if (!shareSupported()) {
    toast(t().share.unsupported, "error");
    return;
  }

  let lifetime = readLifetime();

  const body = el("div", { class: "share" });

  const choices = el("div", {
    class: "share__choices",
    role: "radiogroup",
    "aria-label": t().share.lifetimeLabel,
  });
  const buttons: HTMLButtonElement[] = [];
  for (const key of LIFETIMES) {
    const button = el("button", {
      class: "share__choice",
      type: "button",
      role: "radio",
      "aria-checked": String(key === lifetime),
      "data-lifetime": key,
      text: t().share.lifetimes[key],
    });
    button.addEventListener("click", () => {
      lifetime = key;
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
    el("p", { class: "share__lede" }, t().share.lede),
    el("h3", { class: "share__label", text: t().share.lifetimeLabel }),
    choices,
    el("p", { class: "share__note" }, t().share.note),
    status,
    result,
  );

  const create = el("button", { class: "btn btn--primary", type: "button", text: t().share.create });
  create.dataset["autofocus"] = "true";

  const footer = el("div", { class: "share__actions" }, create);

  openModal({
    title: t().share.title,
    subtitle: `${label} · ${formatBytes(new TextEncoder().encode(text).byteLength)}`,
    body,
    footer,
  });

  create.addEventListener("click", async () => {
    create.disabled = true;
    for (const button of buttons) button.disabled = true;
    // Deriving the key is deliberately slow, so say so rather than looking hung.
    status.textContent = t().share.deriving;

    try {
      const secret = generateSecret();
      const payload: SharePayload = { text, label, savedAt: Date.now() };
      const blob = await seal(payload, secret);

      status.textContent = t().share.uploading(formatBytes(blob.byteLength));
      const created = await upload(blob, lifetime);

      const url = shareUrl(created.id, secret);
      status.textContent = "";

      const field = el("input", {
        class: "share__url",
        type: "text",
        readonly: true,
        value: url,
        "aria-label": t().share.linkFieldLabel,
      });
      const copy = el("button", { class: "btn btn--primary", type: "button", text: t().share.copyLink });
      copy.addEventListener("click", () => void copyText(url, t().copyKinds.shareLink));

      result.replaceChildren(
        el("h3", { class: "share__label", text: t().share.linkLabel }),
        el("div", { class: "share__url-row" }, field, copy),
        el(
          "p",
          { class: "share__meta" },
          `${expiryNote(created.expiresAt)} ${t().share.sizes(
            formatBytes(blob.byteLength),
            formatBytes(new TextEncoder().encode(text).byteLength),
          )}`,
        ),
      );
      result.hidden = false;
      field.select();
      copy.focus();

      create.remove();
      // Copying is now the only thing left to do, so retire the create button.
      void copyText(url, t().copyKinds.shareLink);
    } catch (error) {
      status.textContent = "";
      const shareError =
        error instanceof ShareError
          ? error
          : new ShareError(t().shareErrors.createFailed.headline, String(error));
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
