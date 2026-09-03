// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  assertReadSecret,
  assertShareableDocuments,
  assertShareSecret,
  assertSingleDocumentWithinCap,
  assertValidLifetime,
  assertValidOrigin,
  DEFAULT_ORIGIN,
  GENERATE_SECRET_COMMAND,
  LIFETIME_KEYS,
} from "../../mcp/validate.js";
import { generateSecret, MAX_BUNDLE_BYTES, MAX_SECRET_CHARS, MIN_SECRET_CHARS } from "../../src/crypto.js";
import fixture from "../fixtures/share-v2-compat.json" with { type: "json" };

const VALID_SECRET = "a".repeat(64);

describe("assertShareSecret — what share is willing to mint", () => {
  it("accepts exactly 64 lowercase hex characters", () => {
    expect(() => assertShareSecret(VALID_SECRET)).not.toThrow();
    expect(() => assertShareSecret("0123456789abcdef".repeat(4))).not.toThrow();
  });

  it("refuses 63 characters, naming the openssl command", () => {
    expect(() => assertShareSecret("a".repeat(63))).toThrowError(
      new RegExp(GENERATE_SECRET_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  it("refuses 65 characters", () => {
    expect(() => assertShareSecret("a".repeat(65))).toThrow(new RegExp(GENERATE_SECRET_COMMAND));
  });

  it("refuses non-hex characters at the right length", () => {
    expect(() => assertShareSecret("g".repeat(64))).toThrow(new RegExp(GENERATE_SECRET_COMMAND));
  });

  it("refuses an empty string", () => {
    expect(() => assertShareSecret("")).toThrow(new RegExp(GENERATE_SECRET_COMMAND));
  });

  it("refuses uppercase hex — refused, not silently normalised", () => {
    expect(() => assertShareSecret(VALID_SECRET.toUpperCase())).toThrow(new RegExp(GENERATE_SECRET_COMMAND));
  });

  it("refuses mixed-case hex", () => {
    const mixed = "A" + VALID_SECRET.slice(1);
    expect(() => assertShareSecret(mixed)).toThrow();
  });

  it("refuses a real browser-generated secret — share only mints its own shape", () => {
    // The whole reason assertReadSecret exists separately: share's policy is
    // legitimately narrower than what the wire format accepts.
    expect(() => assertShareSecret(generateSecret())).toThrow(new RegExp(GENERATE_SECRET_COMMAND));
  });

  it("every refusal names the exact expectation (64, lowercase, hex)", () => {
    try {
      assertShareSecret("bad");
      expect.unreachable("expected assertShareSecret to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("64");
      expect(message.toLowerCase()).toContain("lowercase");
      expect(message.toLowerCase()).toContain("hex");
      expect(message).toContain(GENERATE_SECRET_COMMAND);
    }
  });

  it("never echoes the invalid secret's own characters back in the message", () => {
    const distinctive = "z".repeat(60) + "1234"; // 'z' is never valid hex
    try {
      assertShareSecret(distinctive);
      expect.unreachable("expected assertShareSecret to throw");
    } catch (error) {
      expect((error as Error).message).not.toContain(distinctive);
      expect((error as Error).message).not.toContain("zzzz");
    }
  });
});

describe("assertReadSecret — what read is willing to open", () => {
  it("accepts a share-minted 64-hex secret — read opens anything share can produce", () => {
    expect(() => assertReadSecret(VALID_SECRET)).not.toThrow();
  });

  it("accepts a real generateSecret() output — 10 mixed-case base64url characters", () => {
    for (let i = 0; i < 20; i++) {
      const secret = generateSecret();
      expect(() => assertReadSecret(secret)).not.toThrow();
    }
  });

  it("accepts the committed T5 fixture's own secret", () => {
    expect(() => assertReadSecret(fixture.secret)).not.toThrow();
  });

  it("accepts the format's exact boundary lengths, 8 and 64", () => {
    expect(() => assertReadSecret("a".repeat(MIN_SECRET_CHARS))).not.toThrow();
    expect(() => assertReadSecret("a".repeat(MAX_SECRET_CHARS))).not.toThrow();
  });

  it("refuses one character under the minimum and one over the maximum", () => {
    expect(() => assertReadSecret("a".repeat(MIN_SECRET_CHARS - 1))).toThrow();
    expect(() => assertReadSecret("a".repeat(MAX_SECRET_CHARS + 1))).toThrow();
  });

  it("refuses a character outside the format's alphabet", () => {
    expect(() => assertReadSecret("!".repeat(10))).toThrow();
    expect(() => assertReadSecret("has a space")).toThrow();
  });

  it("is case-sensitive — never folds case the way a normaliser would", () => {
    const secret = generateSecret();
    // generateSecret()'s alphabet is mixed-case by design; flipping the case
    // of a real secret must not itself be treated as invalid (it is still a
    // syntactically valid secret, just the wrong key) — assertReadSecret's
    // job is format, not correctness.
    expect(() => assertReadSecret(secret.toUpperCase())).not.toThrow();
    expect(() => assertReadSecret(secret.toLowerCase())).not.toThrow();
  });

  it("never tells the reader to generate a new secret — there is nothing to generate on a read path", () => {
    try {
      assertReadSecret("bad");
      expect.unreachable("expected assertReadSecret to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(GENERATE_SECRET_COMMAND);
      expect(message.toLowerCase()).not.toContain("generate");
    }
  });

  it("says the secret looks malformed or truncated, naming the bound", () => {
    try {
      assertReadSecret("bad");
      expect.unreachable("expected assertReadSecret to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message.toLowerCase()).toMatch(/malformed|truncated/);
      expect(message).toContain(String(MIN_SECRET_CHARS));
      expect(message).toContain(String(MAX_SECRET_CHARS));
    }
  });

  it("never echoes the invalid secret's own characters back in the message", () => {
    const distinctive = "has a space and is therefore invalid";
    try {
      assertReadSecret(distinctive);
      expect.unreachable("expected assertReadSecret to throw");
    } catch (error) {
      expect((error as Error).message).not.toContain(distinctive);
    }
  });
});

describe("assertValidLifetime", () => {
  it("accepts every key in the table", () => {
    for (const key of LIFETIME_KEYS) {
      expect(() => assertValidLifetime(key)).not.toThrow();
    }
  });

  it("refuses a key outside the table and lists every accepted one", () => {
    try {
      assertValidLifetime("2d");
      expect.unreachable("expected assertValidLifetime to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("2d");
      for (const key of LIFETIME_KEYS) expect(message).toContain(key);
    }
  });

  it("is case-sensitive — the table's keys are exact strings, not a loose match", () => {
    expect(() => assertValidLifetime("1D")).toThrow();
  });
});

describe("assertValidOrigin", () => {
  it("accepts the default origin and returns it unchanged", () => {
    expect(assertValidOrigin(DEFAULT_ORIGIN)).toBe(DEFAULT_ORIGIN);
  });

  it("accepts a bare origin with a trailing slash, normalising it", () => {
    expect(assertValidOrigin(`${DEFAULT_ORIGIN}/`)).toBe(DEFAULT_ORIGIN);
  });

  it("accepts an http origin for a self-hosted fork", () => {
    expect(assertValidOrigin("http://localhost:8787")).toBe("http://localhost:8787");
  });

  it("refuses an origin carrying a path", () => {
    expect(() => assertValidOrigin(`${DEFAULT_ORIGIN}/api/shares`)).toThrow();
  });

  it("refuses an origin carrying a query string", () => {
    expect(() => assertValidOrigin(`${DEFAULT_ORIGIN}?x=1`)).toThrow();
  });

  it("refuses an origin carrying a fragment", () => {
    expect(() => assertValidOrigin(`${DEFAULT_ORIGIN}#top`)).toThrow();
  });

  it("refuses a string that is not a URL at all", () => {
    expect(() => assertValidOrigin("not a url")).toThrow();
  });

  it("refuses a non-http(s) scheme", () => {
    expect(() => assertValidOrigin("ftp://example.com")).toThrow();
    expect(() => assertValidOrigin("file:///etc/passwd")).toThrow();
  });

  it("refuses userinfo (user@host) rather than silently uploading to the host after the @", () => {
    // .origin on this string is "https://evil.example.com" — the part before the
    // "@" is not the host, even though it reads like one.
    expect(() => assertValidOrigin("https://jsonapi.mstool.dev@evil.example.com")).toThrow();
  });

  it("refuses userinfo with a password too (user:pass@host)", () => {
    expect(() => assertValidOrigin("https://user:pass@evil.example.com")).toThrow();
  });

  it("names the host the upload would actually reach, in the userinfo refusal", () => {
    try {
      assertValidOrigin("https://jsonapi.mstool.dev@evil.example.com");
      expect.unreachable("expected assertValidOrigin to throw");
    } catch (error) {
      expect((error as Error).message).toContain("evil.example.com");
    }
  });
});

describe("assertShareableDocuments", () => {
  it("accepts one document", () => {
    expect(() => assertShareableDocuments([{ label: "a.json", text: "{}" }])).not.toThrow();
  });

  it("accepts several documents", () => {
    expect(() =>
      assertShareableDocuments([
        { label: "a.json", text: "{}" },
        { label: "b.json", text: "[]" },
      ]),
    ).not.toThrow();
  });

  it("refuses an empty array, naming the requirement rather than describing an empty bundle", () => {
    expect(() => assertShareableDocuments([])).toThrow(/at least one document/i);
  });

  it("refuses a document with empty text, naming its label", () => {
    expect(() => assertShareableDocuments([{ label: "empty.json", text: "" }])).toThrow(/empty\.json/);
  });

  it("refuses when any one of several documents has empty text", () => {
    expect(() =>
      assertShareableDocuments([
        { label: "ok.json", text: "{}" },
        { label: "bad.json", text: "" },
      ]),
    ).toThrow(/bad\.json/);
  });
});

describe("assertSingleDocumentWithinCap", () => {
  it("accepts a blob at or under the cap", () => {
    expect(() => assertSingleDocumentWithinCap(new Uint8Array(MAX_BUNDLE_BYTES), "a.json")).not.toThrow();
  });

  it("refuses a blob over the cap, naming the document and the overage", () => {
    const over = new Uint8Array(MAX_BUNDLE_BYTES + 10);
    try {
      assertSingleDocumentWithinCap(over, "huge.json");
      expect.unreachable("expected assertSingleDocumentWithinCap to throw");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("huge.json");
      expect(message).toMatch(/MB|kB|B/);
    }
  });
});
