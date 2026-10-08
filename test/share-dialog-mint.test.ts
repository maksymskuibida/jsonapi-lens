/**
 * QA6, item 1: the dialog hands the *exchange it was given* to
 * `mintShareEnvelope` — the only function that masks — and states the count
 * before the link exists. The document's own Share and Library → Share are the
 * same `openShareModal`, so this is the wiring both depend on.
 *
 * jsdom has no usable `CompressionStream`, so `mintShareEnvelope` is replaced by
 * a spy here; the real masking is `share-document-secrets.test.ts`, in Node,
 * against decrypted bytes. Splitting it this way is deliberate: this file
 * proves the call, that one proves what the call does.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const minted = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("../src/bundle.js", () => ({
  mintShareEnvelope: async (...args: unknown[]) => {
    minted.calls.push(args);
    return new Uint8Array([1, 2, 3]);
  },
}));

import { openShareModal } from "../src/share.js";
import { headerSet } from "../src/headers.js";
import { t } from "../src/i18n/index.js";
import type { Exchange } from "../src/exchange.js";

beforeEach(() => {
  const root = document.createElement("div");
  root.id = "modal-root";
  const toastEl = document.createElement("div");
  toastEl.id = "toast";
  document.body.replaceChildren(root, toastEl);
  minted.calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ id: 7, expiresAt: null }), { status: 200 })),
  );
});

const withSecret: Exchange = {
  request: { headers: headerSet([{ name: "Authorization", value: "Bearer qa-fake-not-real" }]) },
};

describe("the document's Share dialog", () => {
  it("seals the exchange it was given, not the document alone", async () => {
    openShareModal("{}", "a.json", withSecret);
    document.querySelector<HTMLButtonElement>(".share__actions .btn--primary")!.click();
    await vi.waitFor(() => expect(minted.calls).toHaveLength(1));
    const [documents] = minted.calls[0] as [Array<{ exchange?: Exchange }>];
    expect(documents).toHaveLength(1);
    expect(documents[0]!.exchange).toBe(withSecret);
  });

  it("states the count in the dialog before the Create button is pressed", () => {
    openShareModal("{}", "a.json", withSecret);
    expect(document.querySelector(".share__note--redacting")?.textContent).toBe(t().share.redacting(1));
    expect(minted.calls).toHaveLength(0);
  });

  it("without an exchange it says nothing and seals no exchange", async () => {
    openShareModal("{}", "a.json");
    expect(document.querySelector(".share__note--redacting")).toBeNull();
    expect(document.querySelector(".share__note--body")).toBeNull();
    document.querySelector<HTMLButtonElement>(".share__actions .btn--primary")!.click();
    await vi.waitFor(() => expect(minted.calls).toHaveLength(1));
    const [documents] = minted.calls[0] as [Array<{ exchange?: Exchange }>];
    expect(documents[0]!.exchange).toBeUndefined();
  });

  it("warns, before the link exists, about a body it does not redact", () => {
    openShareModal("{}", "a.json", {
      request: { body: { raw: '{"password":"hunter2"}', contentType: "application/json" } },
    });
    expect(document.querySelector(".share__note--body")?.textContent).toBe(t().share.bodyNotRedacted);
  });

  it("does not warn about a body when there is none to worry about", () => {
    openShareModal("{}", "a.json", { request: { body: { raw: '{"amount":100}', contentType: "application/json" } } });
    expect(document.querySelector(".share__note--body")).toBeNull();
  });

  it("a failed upload shows catalogue copy for its status, never the server's English text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Encrypted document is 13.0 MB, over the 12 MB share limit." }), { status: 413 })),
    );
    openShareModal("{}", "a.json");
    document.querySelector<HTMLButtonElement>(".share__actions .btn--primary")!.click();
    await vi.waitFor(() => expect(document.querySelector(".share__error-hint")).not.toBeNull());
    const hint = document.querySelector(".share__error-hint")!.textContent!;
    expect(hint).not.toContain("13.0 MB");
    expect(hint).not.toContain("Encrypted document is");
    expect(hint).toContain(t().shareErrors.createFailed.tooLarge("12.00 MB"));
  });

  it("a network failure shows catalogue copy, never the browser's own message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    openShareModal("{}", "a.json");
    document.querySelector<HTMLButtonElement>(".share__actions .btn--primary")!.click();
    await vi.waitFor(() => expect(document.querySelector(".share__error-hint")).not.toBeNull());
    expect(document.querySelector(".share__error-hint")!.textContent).toBe(t().shareErrors.createFailed.network);
  });

  it("the size shown counts the request that rides with the document (gap F)", () => {
    const sizeOf = (exchange?: Exchange) => {
      openShareModal("{}", "a.json", exchange);
      const text = document.querySelector(".modal__subtitle, .modal__sub")?.textContent ?? document.body.textContent ?? "";
      document.body.replaceChildren(...[]);
      const root = document.createElement("div");
      root.id = "modal-root";
      document.body.append(root);
      return text;
    };
    const plain = sizeOf();
    const big = sizeOf({ request: { url: "https://api.example.com/" + "x".repeat(3000) } });
    expect(big).not.toBe(plain);
  });
});
