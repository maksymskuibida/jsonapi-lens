// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import {
  fromBase64Url,
  generateSecret,
  isBundlePayload,
  MAX_BUNDLE_BYTES,
  MAX_SECRET_CHARS,
  MIN_SECRET_CHARS,
  open as openSealed,
  seal,
  sealBundle,
  SECRET_CHARS,
  ShareError,
  toBase64Url,
} from "../src/crypto.js";
import type { BundleEntry, BundlePayload, SharePayload } from "../src/crypto.js";
import { t } from "../src/i18n/index.js";
import fixture from "./fixtures/share-v2-compat.json";

type Bytes = Uint8Array<ArrayBuffer>;
const payload = { text: '{"data":[{"type":"articles","id":"1"}]}', label: "a.json", savedAt: 1 };

/**
 * `test/hygiene.test.ts` scans real files for a real `fetch(` call; this
 * module-scoped stub is a second, load-bearing check specific to this file —
 * "Tests that must exist" requires that opening and sealing links never touch
 * the network, and `crypto.ts` importing `fetch` by accident is exactly the
 * module-boundary violation `docs/PROCESS.md` §5 calls out. A throwing stub
 * turns "nothing here calls fetch" from an assumption into something that
 * fails loudly if it ever stops being true.
 */
let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
beforeAll(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("crypto.ts must never call fetch — see docs/PROCESS.md §5");
  });
});
afterAll(() => {
  fetchSpy?.mockRestore();
});

/** Deterministic, non-repeating filler with no characters JSON would escape —
 * so its length survives `JSON.stringify` unchanged, which keeps the size-cap
 * test's arithmetic simple. High entropy (92 roughly-equiprobable symbols) is
 * what keeps gzip from shrinking it enough to slip back under the cap. */
function pseudoRandomText(byteLength: number): string {
  // Printable ASCII 0x21-0x7e, minus `"` (0x22) and `\` (0x5c) — the two
  // characters JSON.stringify would otherwise escape.
  const printable: number[] = [];
  for (let code = 0x21; code <= 0x7e; code++) {
    if (code !== 0x22 && code !== 0x5c) printable.push(code);
  }
  const bytes = new Uint8Array(byteLength);
  let seed = 0x2545f491 ^ byteLength;
  for (let i = 0; i < byteLength; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    bytes[i] = printable[seed % printable.length]!;
  }
  let text = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return text;
}

describe("share secrets", () => {
  it("is short enough to look like a link", () => {
    const secret = generateSecret();
    expect(secret).toHaveLength(SECRET_CHARS);
    expect(SECRET_CHARS).toBeLessThanOrEqual(12);
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("uses the whole 64-character alphabet, so every character carries 6 bits", () => {
    // A modulo-biased generator would under-use the tail of the alphabet.
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) for (const ch of generateSecret()) seen.add(ch);
    expect(seen.size).toBeGreaterThan(58);
  });

  it("does not repeat", () => {
    const secrets = new Set(Array.from({ length: 200 }, () => generateSecret()));
    expect(secrets.size).toBe(200);
  });
});

describe("base64url", () => {
  it("round-trips bytes without padding or unsafe characters", () => {
    for (const length of [1, 2, 3, 16, 32, 100]) {
      const bytes = new Uint8Array(length).map((_, i) => (i * 37) % 256) as Bytes;
      const encoded = toBase64Url(bytes);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(encoded).not.toContain("=");
      expect([...fromBase64Url(encoded)]).toEqual([...bytes]);
    }
  });
});

describe("seal and open", () => {
  it("round-trips a document", async () => {
    const secret = generateSecret();
    const blob = await seal(payload, secret);
    await expect(openSealed(blob, secret)).resolves.toEqual(payload);
  });

  it("compresses, so the blob is smaller than the JSON for repetitive payloads", async () => {
    const big = { ...payload, text: JSON.stringify({ data: Array.from({ length: 400 }, (_, i) => ({ type: "articles", id: String(i) })) }) };
    const blob = await seal(big, generateSecret());
    expect(blob.byteLength).toBeLessThan(new TextEncoder().encode(big.text).byteLength / 3);
  });

  it("produces a different blob every time, even for identical input", async () => {
    const secret = generateSecret();
    const a = await seal(payload, secret);
    const b = await seal(payload, secret);
    // Random salt and IV, so no two blobs match and no table can be precomputed.
    expect(toBase64Url(a)).not.toBe(toBase64Url(b));
  });

  it("refuses the wrong secret", async () => {
    const blob = await seal(payload, generateSecret());
    await expect(openSealed(blob, generateSecret())).rejects.toThrow(ShareError);
  });

  it("refuses a tampered ciphertext", async () => {
    const secret = generateSecret();
    const blob = await seal(payload, secret);
    blob[blob.length - 1] = (blob[blob.length - 1]! ^ 0xff) & 0xff;
    await expect(openSealed(blob, secret)).rejects.toThrow(/could not be decrypted/);
  });

  it("refuses a tampered salt, because the derived key changes", async () => {
    const secret = generateSecret();
    const blob = await seal(payload, secret);
    blob[3] = (blob[3]! ^ 0xff) & 0xff;
    await expect(openSealed(blob, secret)).rejects.toThrow(ShareError);
  });

  it("names a version mismatch instead of failing obscurely", async () => {
    const blob = await seal(payload, generateSecret());
    blob[0] = 99;
    await expect(openSealed(blob, "whatever12")).rejects.toThrow(/different version/);
  });

  it("rejects a blob too short to be a document", async () => {
    await expect(openSealed(new Uint8Array(4) as Bytes, "whatever12")).rejects.toThrow(/corrupt/);
  });

  it("round-trips a document carrying an exchange", async () => {
    const secret = generateSecret();
    const withExchange: SharePayload = {
      ...payload,
      exchange: {
        request: { method: "POST", url: "https://api.example.com/widgets" },
        response: { status: 201 },
      },
    };
    const blob = await seal(withExchange, secret);
    await expect(openSealed(blob, secret)).resolves.toEqual(withExchange);
  });

  it("stays version 2 whether or not an exchange is attached — a single-document share never becomes a bundle", async () => {
    const secret = generateSecret();
    const bare = await seal(payload, secret);
    const withExchange = await seal({ ...payload, exchange: { request: { method: "GET" } } }, secret);
    expect(bare[0]).toBe(2);
    expect(withExchange[0]).toBe(2);
  });
});

/** Standard base64 (the fixture's `blobBase64`), as opposed to the base64url
 * `toBase64Url`/`fromBase64Url` in `crypto.ts` use for the URL-embedded
 * secret — the fixture is not a secret and was easier to write with `btoa`. */
function fromStandardBase64(value: string): Bytes {
  const binary = atob(value);
  const out = new Uint8Array(binary.length) as Bytes;
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

describe("the version-2 compatibility fixture", () => {
  // This is the one test in this file that a code change cannot regenerate:
  // `share-v2-compat.json` was sealed by the crypto.ts that shipped in commit
  // 12d01fc4d790c4f10252cc1034d722113cdf891b, before bundles or `exchange`
  // existed, using `npx tsx` against that exact checked-out file. Every other
  // test here seals with *this* build and opens with *this* build, which only
  // proves the new code agrees with itself; this is the one that proves a
  // link already in someone's chat history still opens.
  it("opens a real link minted before this change, byte for byte", async () => {
    const blob = fromStandardBase64(fixture.blobBase64);
    expect(blob[0]).toBe(2);
    await expect(openSealed(blob, fixture.secret)).resolves.toEqual(fixture.payload);
  });

  it("still refuses the fixture's own secret typo'd by one character", async () => {
    // Confidence that the fixture is actually secret-gated, not merely
    // shaped like a valid blob — a fixture that opens with any secret would
    // pass the test above for the wrong reason.
    const blob = fromStandardBase64(fixture.blobBase64);
    const wrong = fixture.secret.slice(0, -1) + (fixture.secret.endsWith("x") ? "y" : "x");
    await expect(openSealed(blob, wrong)).rejects.toThrow(ShareError);
  });
});

describe("bundles", () => {
  it("mirrors the Worker's own cap exactly — see MAX_BYTES in src/worker.ts", () => {
    // Duplicated rather than imported, because worker.ts is typechecked
    // separately and runs on workerd — this is the one assertion that
    // catches the two drifting apart.
    expect(MAX_BUNDLE_BYTES).toBe(12 * 1024 * 1024);
  });

  const threeDocs: BundleEntry[] = [
    { label: "one.json", text: '{"data":{"type":"a","id":"1"}}' },
    { label: "two.json", text: '{"data":{"type":"b","id":"2"}}', exchange: { request: { method: "GET" } } },
    { label: "three.json", text: '{"data":[]}', resources: 0, types: 0, shape: "data[0]" },
  ];

  it("round-trips a bundle of three, each entry intact", async () => {
    const secret = generateSecret();
    const sent: BundlePayload = { kind: "bundle", savedAt: 42, documents: threeDocs };
    const blob = await sealBundle(sent, secret);
    expect(blob[0]).toBe(3);

    const opened = await openSealed(blob, secret);
    expect(isBundlePayload(opened)).toBe(true);
    expect(opened).toEqual(sent);
  });

  it("mints version 3 for a bundle, never 2 — versioning is asserted on the byte, not a variable", async () => {
    const blob = await sealBundle(
      { kind: "bundle", savedAt: 1, documents: [threeDocs[0]!] },
      generateSecret(),
    );
    expect(blob[0]).toBe(3);
  });

  it("a hand-made bundle of exactly one entry still opens — sealBundle does not special-case count 1", async () => {
    const secret = generateSecret();
    const blob = await sealBundle({ kind: "bundle", savedAt: 1, documents: [threeDocs[0]!] }, secret);
    const opened = await openSealed(blob, secret);
    expect(isBundlePayload(opened)).toBe(true);
    if (isBundlePayload(opened)) expect(opened.documents).toEqual([threeDocs[0]]);
  });

  it("refuses an empty bundle at seal time, before any upload could happen", async () => {
    await expect(
      sealBundle({ kind: "bundle", savedAt: 1, documents: [] }, generateSecret()),
    ).rejects.toThrow(ShareError);
  });

  it("refuses a bundle entry with empty text at seal time", async () => {
    await expect(
      sealBundle(
        { kind: "bundle", savedAt: 1, documents: [{ label: "empty.json", text: "" }] },
        generateSecret(),
      ),
    ).rejects.toThrow(ShareError);
  });

  it("keeps two entries sharing a label — labels are not identities", async () => {
    const secret = generateSecret();
    const documents: BundleEntry[] = [
      { label: "dup.json", text: '{"a":1}' },
      { label: "dup.json", text: '{"a":2}' },
    ];
    const blob = await sealBundle({ kind: "bundle", savedAt: 1, documents }, secret);
    const opened = await openSealed(blob, secret);
    if (isBundlePayload(opened)) expect(opened.documents).toEqual(documents);
  });

  it("carries a bundle entry whose text is not valid JSON, verbatim — the bundle is a carrier, not a validator", async () => {
    const secret = generateSecret();
    const documents: BundleEntry[] = [{ label: "broken.json", text: "{not valid json" }];
    const blob = await sealBundle({ kind: "bundle", savedAt: 1, documents }, secret);
    const opened = await openSealed(blob, secret);
    if (isBundlePayload(opened)) expect(opened.documents[0]!.text).toBe("{not valid json");
  });

  it("survives lone surrogates, a BOM, CRLF line endings and a 5 MB single line byte-identically", async () => {
    const stress =
      "﻿" + // BOM
      "line one\r\nline two\r\n" + // CRLF
      "\uD800" + // an unpaired leading surrogate, deliberately not followed by its partner
      "orphan-surrogate-follows\n" +
      pseudoRandomText(5 * 1024 * 1024); // a single 5 MB line, no newlines within it

    const secret = generateSecret();
    const documents: BundleEntry[] = [{ label: "stress.json", text: stress }];
    const blob = await sealBundle({ kind: "bundle", savedAt: 1, documents }, secret);
    const opened = await openSealed(blob, secret);
    expect(isBundlePayload(opened)).toBe(true);
    if (isBundlePayload(opened)) {
      expect(opened.documents[0]!.text).toBe(stress);
      expect(opened.documents[0]!.text.length).toBe(stress.length);
    }
  }, 20_000);

  it("refuses a bundle whose sealed size exceeds the cap, naming the largest documents and the overage", async () => {
    // Comfortably over MAX_BUNDLE_BYTES even after gzip: high-entropy text
    // resists compression (see pseudoRandomText's own comment), so ~18 MB
    // raw reliably seals to more than the 12 MB cap.
    const big: BundleEntry = { label: "huge.json", text: pseudoRandomText(18 * 1024 * 1024) };
    const small: BundleEntry = { label: "tiny.json", text: '{"data":null}' };

    let caught: ShareError | undefined;
    try {
      await sealBundle({ kind: "bundle", savedAt: 1, documents: [small, big] }, generateSecret());
    } catch (error) {
      caught = error as ShareError;
    }

    expect(caught).toBeInstanceOf(ShareError);
    // Names the overage, not just "too large".
    expect(caught!.hint).toMatch(/MB/);
    // Names the offending document specifically, not just the total — and
    // ranks it ahead of the document that barely contributed, so "which one
    // do I remove" has an obvious answer without doing the arithmetic.
    const hugeAt = caught!.hint.indexOf("huge.json");
    const tinyAt = caught!.hint.indexOf("tiny.json");
    expect(hugeAt).toBeGreaterThan(-1);
    expect(tinyAt).toBeGreaterThan(-1);
    expect(hugeAt).toBeLessThan(tinyAt);
  }, 20_000);
});

describe("versioning", () => {
  /**
   * Mirrors the version guard in the crypto.ts that shipped before this
   * change (commit 12d01fc4d790c4f10252cc1034d722113cdf891b) byte for byte:
   * `if (blob[0] !== VERSION)` with `VERSION = 2`, checked before any key
   * derivation. Built from the real, still-exported `t().shareErrors
   * .wrongVersion` messages — unchanged by this task — rather than
   * duplicated copy, so this test fails if that catalogue entry's wording
   * ever drifts from what it asserts.
   */
  function legacyVersionCheck(blob: Bytes): void {
    if (blob[0] !== 2) {
      throw new ShareError(
        t().shareErrors.wrongVersion.headline,
        t().shareErrors.wrongVersion.hint(blob[0] ?? 0, 2),
      );
    }
  }

  it("a bundle blob is rejected by a reader that only recognises version 2, naming both versions", async () => {
    const bundleBlob = await sealBundle(
      { kind: "bundle", savedAt: 1, documents: [{ label: "a", text: "{}" }] },
      generateSecret(),
    );
    expect(bundleBlob[0]).toBe(3);

    expect(() => legacyVersionCheck(bundleBlob)).toThrow(ShareError);
    expect(() => legacyVersionCheck(bundleBlob)).toThrow(/different version/);
    expect(() => legacyVersionCheck(bundleBlob)).toThrow(/format version 3/);
    expect(() => legacyVersionCheck(bundleBlob)).toThrow(/reads version 2/);
  });

  it("a version this build does not know either fails the same way, before key derivation", async () => {
    const blob = await seal(payload, generateSecret());
    blob[0] = 4; // neither the document version (2) nor the bundle version (3)
    await expect(openSealed(blob, generateSecret())).rejects.toThrow(/different version/);
  });

  it("a document blob relabelled as a bundle is refused as corrupt, not misread", async () => {
    const secret = generateSecret();
    // The version byte sits outside the AES-GCM associated data (see the
    // module header), so flipping it alone still decrypts and decompresses
    // fine — this reaches the *shape* check on genuinely valid plaintext
    // that is simply not shaped like the version it now claims to be.
    const documentBlob = await seal(payload, secret);
    documentBlob[0] = 3;

    let caught: ShareError | undefined;
    try {
      await openSealed(documentBlob, secret);
    } catch (error) {
      caught = error as ShareError;
    }
    expect(caught).toBeInstanceOf(ShareError);
    expect(caught!.hint).not.toMatch(/does not contain a document/);
  });

  it("a bundle blob relabelled as a document is refused as corrupt, not crashed on a missing field", async () => {
    // The reverse: a bundle has no `text`, so the *unwidened* single-document
    // guard (`typeof parsed?.text !== "string"`) must still catch it — this
    // is the exact failure mode the review flagged: a bundle must not fall
    // through that guard and report itself as a corrupt *document*.
    const secret = generateSecret();
    const bundleBlob = await sealBundle(
      { kind: "bundle", savedAt: 1, documents: [{ label: "a", text: "{}" }] },
      secret,
    );
    bundleBlob[0] = 2;
    await expect(openSealed(bundleBlob, secret)).rejects.toThrow(ShareError);
  });

  it("a valid envelope whose decompressed content is not JSON at all fails readably, not as an unhandled rejection", async () => {
    // Built with the same standard WebCrypto/CompressionStream primitives
    // `crypto.ts` uses, at the same KDF cost, so that `open` genuinely
    // decrypts and decompresses this — the one thing the public `seal`/
    // `sealBundle` API cannot produce, since both always JSON.stringify
    // their input first.
    async function sealNonJson(version: number, secret: string): Promise<Bytes> {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const material = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        "PBKDF2",
        false,
        ["deriveKey"],
      );
      const key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 1_000_000, hash: "SHA-256" },
        material,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt"],
      );
      const plaintext = new TextEncoder().encode("not json at all {");
      const compressed = new Uint8Array(
        await new Response(
          new Blob([plaintext]).stream().pipeThrough(new CompressionStream("gzip")),
        ).arrayBuffer(),
      );
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, compressed),
      );
      const out = new Uint8Array(1 + 16 + 12 + ciphertext.length);
      out[0] = version;
      out.set(salt, 1);
      out.set(iv, 17);
      out.set(ciphertext, 29);
      return out as Bytes;
    }

    const secret = "nonjsontest123";
    await expect(openSealed(await sealNonJson(2, secret), secret)).rejects.toThrow(ShareError);
    await expect(openSealed(await sealNonJson(3, secret), secret)).rejects.toThrow(ShareError);
  }, 10_000);
});

describe("secret length", () => {
  it(`accepts the boundary values ${MIN_SECRET_CHARS} and ${MAX_SECRET_CHARS}`, async () => {
    const short = "a".repeat(MIN_SECRET_CHARS);
    const long = "a".repeat(MAX_SECRET_CHARS);
    await expect(openSealed(await seal(payload, short), short)).resolves.toEqual(payload);
    await expect(openSealed(await seal(payload, long), long)).resolves.toEqual(payload);
  });

  it("refuses one character under the minimum and one over the maximum, naming the bound", async () => {
    const tooShort = "a".repeat(MIN_SECRET_CHARS - 1);
    const tooLong = "a".repeat(MAX_SECRET_CHARS + 1);

    await expect(seal(payload, tooShort)).rejects.toThrow(ShareError);
    await expect(seal(payload, tooLong)).rejects.toThrow(ShareError);

    let short: ShareError | undefined;
    try {
      await seal(payload, tooShort);
    } catch (error) {
      short = error as ShareError;
    }
    expect(short!.hint).toContain(String(MIN_SECRET_CHARS));
    expect(short!.hint).toContain(String(MAX_SECRET_CHARS));

    let long: ShareError | undefined;
    try {
      await seal(payload, tooLong);
    } catch (error) {
      long = error as ShareError;
    }
    expect(long!.hint).toContain(String(MIN_SECRET_CHARS));
    expect(long!.hint).toContain(String(MAX_SECRET_CHARS));
  });

  it("rejects an out-of-range secret before paying for key derivation", async () => {
    // If this reached PBKDF2 at 1,000,000 iterations it would take upwards of
    // 100ms; failing fast is itself part of the contract.
    const start = performance.now();
    await expect(seal(payload, "short")).rejects.toThrow(ShareError);
    expect(performance.now() - start).toBeLessThan(50);
  });

  it("applies the same bound to opening as to sealing", async () => {
    const secret = generateSecret();
    const blob = await seal(payload, secret);
    await expect(openSealed(blob, "short")).rejects.toThrow(ShareError);
    await expect(openSealed(blob, "x".repeat(65))).rejects.toThrow(ShareError);
  });
});

describe("no oracle: a wrong secret and a corrupt blob look the same", () => {
  it("a wrong secret and a tampered ciphertext produce the identical headline", async () => {
    const secret = generateSecret();
    const blob = await seal(payload, secret);

    let wrongSecretError: ShareError | undefined;
    try {
      await openSealed(blob, generateSecret());
    } catch (error) {
      wrongSecretError = error as ShareError;
    }

    const tampered = await seal(payload, secret);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! ^ 0xff) & 0xff;
    let corruptError: ShareError | undefined;
    try {
      await openSealed(tampered, secret);
    } catch (error) {
      corruptError = error as ShareError;
    }

    expect(wrongSecretError).toBeInstanceOf(ShareError);
    expect(corruptError).toBeInstanceOf(ShareError);
    expect(wrongSecretError!.headline).toBe(corruptError!.headline);
    expect(wrongSecretError!.hint).toBe(corruptError!.hint);
  });

  it("applies the same non-oracle to a bundle as to a single document", async () => {
    const secret = generateSecret();
    const blob = await sealBundle(
      { kind: "bundle", savedAt: 1, documents: [{ label: "a", text: "{}" }] },
      secret,
    );

    let wrongSecretError: ShareError | undefined;
    try {
      await openSealed(blob, generateSecret());
    } catch (error) {
      wrongSecretError = error as ShareError;
    }

    const tampered = await sealBundle(
      { kind: "bundle", savedAt: 1, documents: [{ label: "a", text: "{}" }] },
      secret,
    );
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! ^ 0xff) & 0xff;
    let corruptError: ShareError | undefined;
    try {
      await openSealed(tampered, secret);
    } catch (error) {
      corruptError = error as ShareError;
    }

    expect(wrongSecretError!.headline).toBe(corruptError!.headline);
    expect(wrongSecretError!.hint).toBe(corruptError!.hint);
  });
});
