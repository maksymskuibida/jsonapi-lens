// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  assertShareableDocuments,
  assertSingleDocumentWithinCap,
  assertValidLifetime,
  assertValidOrigin,
  assertValidSecret,
  DEFAULT_ORIGIN,
  GENERATE_SECRET_COMMAND,
  LIFETIME_KEYS,
} from "../../mcp/validate.js";
import { MAX_BUNDLE_BYTES } from "../../src/crypto.js";

const VALID_SECRET = "a".repeat(64);

describe("assertValidSecret", () => {
  it("accepts exactly 64 lowercase hex characters", () => {
    expect(() => assertValidSecret(VALID_SECRET)).not.toThrow();
    expect(() => assertValidSecret("0123456789abcdef".repeat(4))).not.toThrow();
  });

  it("refuses 63 characters, naming the openssl command", () => {
    expect(() => assertValidSecret("a".repeat(63))).toThrowError(
      new RegExp(GENERATE_SECRET_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  it("refuses 65 characters", () => {
    expect(() => assertValidSecret("a".repeat(65))).toThrow(new RegExp(GENERATE_SECRET_COMMAND));
  });

  it("refuses non-hex characters at the right length", () => {
    expect(() => assertValidSecret("g".repeat(64))).toThrow(new RegExp(GENERATE_SECRET_COMMAND));
  });

  it("refuses an empty string", () => {
    expect(() => assertValidSecret("")).toThrow(new RegExp(GENERATE_SECRET_COMMAND));
  });

  it("refuses uppercase hex — refused, not silently normalised", () => {
    expect(() => assertValidSecret(VALID_SECRET.toUpperCase())).toThrow(new RegExp(GENERATE_SECRET_COMMAND));
  });

  it("refuses mixed-case hex", () => {
    const mixed = "A" + VALID_SECRET.slice(1);
    expect(() => assertValidSecret(mixed)).toThrow();
  });

  it("every refusal names the exact expectation (64, lowercase, hex)", () => {
    try {
      assertValidSecret("bad");
      expect.unreachable("expected assertValidSecret to throw");
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
      assertValidSecret(distinctive);
      expect.unreachable("expected assertValidSecret to throw");
    } catch (error) {
      expect((error as Error).message).not.toContain(distinctive);
      expect((error as Error).message).not.toContain("zzzz");
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
