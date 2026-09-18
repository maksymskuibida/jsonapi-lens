// @vitest-environment node
//
// `crypto.ts#seal`/`open` need the real `CompressionStream`/`Blob.stream()`
// Node provides — jsdom's `Blob` has no `.stream()` at all, which is why
// `test/crypto.test.ts` pins itself to this same override. These tests need
// no DOM (they exercise `redactExchange` plus the seal/open round trip, never
// rendering), so the trade costs nothing here either.
import { describe, expect, it } from "vitest";
import { redactExchange } from "../src/secrets.js";
import { generateSecret, open as openSealed, seal } from "../src/crypto.js";
import type { SharePayload } from "../src/crypto.js";
import { headerSet } from "../src/headers.js";
import type { Exchange } from "../src/exchange.js";

/**
 * The "must exist" test from `docs/task-specs/T2.md`: "an exchange carrying
 * Authorization produces no occurrence of the secret in ... the sealed share
 * blob — asserted against the actual bytes." A sealed blob is AES-GCM
 * ciphertext, which never contains a recognisable plaintext substring
 * *regardless* of redaction — that guarantee comes from the cipher, not from
 * this feature, so the meaningful assertion is against what the round trip
 * decrypts back to, which is what `main.ts`'s Copy/Download/Share all
 * ultimately write or upload from `redactExchange`'s own output. See
 * `docs/task-specs/T2.md` and `secrets.ts#redactExchange`'s header for the
 * exact, evolving coverage this module asserts against — deliberately not
 * restated verbatim here, so this test does not silently drift out of step
 * with it.
 */
describe("redaction survives a seal/open round trip", () => {
  it("an exchange carrying Authorization and a cookie produces no occurrence of the secret once redacted, sealed and reopened", async () => {
    const secretToken = "s3cr3t-token-that-must-not-survive";
    const exchange: Exchange = {
      request: {
        headers: headerSet([
          { name: "Authorization", value: `Bearer ${secretToken}` },
          { name: "Accept", value: "application/json" },
        ]),
        cookies: { entries: [{ name: "session", value: secretToken }] },
      },
      response: { status: 200 },
    };

    const { exchange: redacted, count } = redactExchange(exchange);
    expect(count).toBeGreaterThan(0);
    expect(JSON.stringify(redacted)).not.toContain(secretToken);

    const payload: SharePayload = { text: "{}", label: "test", savedAt: Date.now(), exchange: redacted };
    const secret = generateSecret();
    const blob = await seal(payload, secret);

    const opened = (await openSealed(blob, secret)) as SharePayload;
    expect(JSON.stringify(opened)).not.toContain(secretToken);
    expect(JSON.stringify(opened.exchange)).toContain("[REDACTED]");
  });

  it("proves the test above can fail: the same round trip without redaction does leak the secret", async () => {
    const secretToken = "s3cr3t-token-that-must-not-survive";
    const payload: SharePayload = {
      text: "{}",
      label: "test",
      savedAt: Date.now(),
      exchange: { request: { headers: headerSet([{ name: "Authorization", value: `Bearer ${secretToken}` }]) } },
    };
    const secret = generateSecret();
    const blob = await seal(payload, secret);
    const opened = (await openSealed(blob, secret)) as SharePayload;
    expect(JSON.stringify(opened)).toContain(secretToken);
  });

  it("redactExchange does not mutate the exchange it is given", async () => {
    const exchange: Exchange = {
      request: { headers: headerSet([{ name: "Authorization", value: "Bearer xyz" }]) },
    };
    const before = JSON.stringify(exchange);
    redactExchange(exchange);
    expect(JSON.stringify(exchange)).toBe(before);
  });
});
