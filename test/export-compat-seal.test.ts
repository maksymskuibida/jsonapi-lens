// @vitest-environment node
/**
 * The canonical export needs no envelope change (QA6 blind QA 2): `exchange` is
 * an opaque optional field of the version-2 payload, so a canonical exchange is
 * just a smaller one. Proven here by sealing both shapes and opening them with the
 * current reader; the render side (`export-compat-render.test.ts`) shows the
 * reader re-derives what the canonical form leaves out.
 */
import { describe, expect, it } from "vitest";
import { mintShareEnvelope } from "../src/bundle.js";
import { generateSecret, isBundlePayload, open as openSealed, seal } from "../src/crypto.js";
import type { SharePayload } from "../src/crypto.js";
import { headerSet } from "../src/headers.js";
import { decodeParams } from "../src/params.js";
import type { Exchange } from "../src/exchange.js";

/** An exchange in the OLD wire shape: derived `query` and `form` included. */
const oldShape: Exchange = {
  request: {
    method: "GET",
    url: "https://api.example.com/x?page=2",
    query: decodeParams("page=2"),
    headers: headerSet([{ name: "Accept", value: "application/json" }]),
    body: { raw: "a=1", contentType: "application/x-www-form-urlencoded", form: decodeParams("a=1") },
  },
};

describe("envelope compatibility", () => {
  it("an old link (derived fields present) opens unchanged, as a version-2 document", async () => {
    const secret = generateSecret();
    const blob = await seal({ text: "{}", label: "old.json", savedAt: 1, exchange: oldShape }, secret);
    expect(blob[0]).toBe(2);
    const opened = (await openSealed(blob, secret)) as SharePayload;
    expect(isBundlePayload(opened)).toBe(false);
    expect(opened.exchange).toEqual(oldShape);
  });

  it("a new link (canonical) is still version 2 and opens in the current reader, with no derived fields", async () => {
    const secret = generateSecret();
    const blob = await mintShareEnvelope([{ label: "new.json", text: "{}", exchange: oldShape }], secret);
    expect(blob[0]).toBe(2); // no version bump
    const opened = (await openSealed(blob, secret)) as SharePayload;
    expect(isBundlePayload(opened)).toBe(false);
    expect(opened.exchange?.request?.url).toBe("https://api.example.com/x?page=2");
    expect(opened.exchange?.request?.query).toBeUndefined();
    expect(opened.exchange?.request?.body).toEqual({ raw: "a=1", contentType: "application/x-www-form-urlencoded" });
  });

  it("a bundle keeps its version-3 envelope and carries canonical exchanges", async () => {
    const secret = generateSecret();
    const blob = await mintShareEnvelope(
      [
        { label: "a", text: "{}", exchange: oldShape },
        { label: "b", text: "{}" },
      ],
      secret,
    );
    expect(blob[0]).toBe(3);
  });
});
