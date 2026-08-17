// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  fromBase64Url,
  generateSecret,
  open as openSealed,
  seal,
  SECRET_CHARS,
  ShareError,
  toBase64Url,
} from "../src/crypto.js";

type Bytes = Uint8Array<ArrayBuffer>;
const payload = { text: '{"data":[{"type":"articles","id":"1"}]}', label: "a.json", savedAt: 1 };

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
});
