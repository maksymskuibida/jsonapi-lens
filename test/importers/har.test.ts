import { describe, expect, it } from "vitest";
import { detectHar, harImporter, parseHar } from "../../src/importers/har.js";
import { ImportError } from "../../src/importers/types.js";
import { getHeaderAll } from "../../src/headers.js";
import { findParam } from "../../src/params.js";
import sampleHar from "../fixtures/sample.har?raw";
import { toBase64Standard } from "../../src/importers/shared.js";

// `Buffer` is a Node global outside this project's typecheck surface
// (`tsconfig.json` scopes `types` to `vite/client` only, deliberately — see
// `test/hygiene.test.ts`'s header), so base64 fixtures here go through the
// same browser-safe codec the HAR importer itself uses.
function base64Of(bytes: Uint8Array): string {
  return toBase64Standard(bytes);
}

describe("HAR — detection", () => {
  it("recognises a HAR file by its log.entries shape", () => {
    const detection = detectHar(sampleHar);
    expect(detection).not.toBeNull();
    expect(detection?.summary).toContain("2");
  });

  it("does not recognise unrelated JSON or text", () => {
    expect(detectHar('{"data":{"type":"widgets","id":"1"}}')).toBeNull();
    expect(detectHar("not json")).toBeNull();
    expect(detectHar("")).toBeNull();
  });
});

describe("HAR — the fixture round-trips to two exchanges", () => {
  it("first entry: GET with query, headers, and a JSON:API response", () => {
    const result = parseHar(sampleHar);
    expect(result.exchanges).toHaveLength(2);

    const first = result.exchanges[0]!;
    expect(first.request?.method).toBe("GET");
    expect(first.request?.url).toBe("https://api.example.com/v2/widgets");
    expect(findParam(first.request!.query!, "active")?.value).toBe("true");
    expect(findParam(first.request!.query!, "sort")?.value).toBe("-created");
    expect(first.response?.status).toBe(200);
    expect(first.response?.body?.raw).toContain('"type":"widgets"');
    expect(first.origin).toEqual({ kind: "har" });
  });

  it("second entry: POST with a JSON:API request body", () => {
    const result = parseHar(sampleHar);
    const second = result.exchanges[1]!;
    expect(second.request?.method).toBe("POST");
    expect(second.request?.body?.raw).toContain('"name":"New widget"');
    expect(second.response?.status).toBe(201);
  });

  it("reports a masked-secret count for the Authorization header", () => {
    const result = parseHar(sampleHar);
    expect(result.warnings.some((w) => /masked/i.test(w))).toBe(true);
  });
});

describe("HAR — Set-Cookie is never comma-joined", () => {
  it("two Set-Cookie headers with a comma inside Expires parse as two separate cookies", () => {
    const result = parseHar(sampleHar);
    const cookies = result.exchanges[0]!.response?.cookies?.entries;
    expect(cookies).toHaveLength(2);
    expect(cookies?.[0]).toMatchObject({ name: "session", value: "abc123" });
    expect(cookies?.[0]?.expires).toContain("Wed, 21 Oct 2026");
    expect(cookies?.[1]).toMatchObject({ name: "theme", value: "dark", secure: true });
  });

  it("falls back to raw Set-Cookie headers, one call per value, when entry.response.cookies is empty", () => {
    const har = {
      log: {
        entries: [
          {
            request: { method: "GET", url: "https://api.example.com/x", headers: [] },
            response: {
              status: 200,
              headers: [
                { name: "Set-Cookie", value: "a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT" },
                { name: "Set-Cookie", value: "b=2; Path=/" },
              ],
              cookies: [],
            },
          },
        ],
      },
    };
    const result = parseHar(JSON.stringify(har));
    const cookies = result.exchanges[0]!.response?.cookies?.entries;
    expect(cookies).toHaveLength(2);
    expect(cookies?.[0]).toMatchObject({ name: "a", value: "1" });
    expect(cookies?.[0]?.expiresAt).toBeDefined();
    expect(cookies?.[1]).toMatchObject({ name: "b", value: "2", path: "/" });
  });

  it("preserves duplicate headers of the same name as separate entries, never joined", () => {
    const har = {
      log: {
        entries: [
          {
            request: { method: "GET", url: "https://api.example.com/x", headers: [] },
            response: {
              status: 200,
              headers: [
                { name: "Set-Cookie", value: "a=1" },
                { name: "Set-Cookie", value: "b=2" },
              ],
            },
          },
        ],
      },
    };
    const result = parseHar(JSON.stringify(har));
    expect(getHeaderAll(result.exchanges[0]!.response!.headers!, "set-cookie")).toEqual(["a=1", "b=2"]);
  });
});

describe("HAR — binary content", () => {
  it("base64 content that is not valid UTF-8 is shown as a size, not as text", () => {
    // Two invalid UTF-8 continuation bytes with no leading byte — guaranteed to fail strict decoding.
    const binary = base64Of(new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x02]));
    const har = {
      log: {
        entries: [
          {
            request: { method: "GET", url: "https://api.example.com/image", headers: [] },
            response: {
              status: 200,
              headers: [],
              content: { size: 5, mimeType: "image/png", text: binary, encoding: "base64" },
            },
          },
        ],
      },
    };
    const result = parseHar(JSON.stringify(har));
    const body = result.exchanges[0]!.response?.body;
    expect(body?.raw).not.toBe(binary);
    expect(body?.raw).toMatch(/\d/); // names a size
    expect(result.warnings.some((w) => /binary/i.test(w))).toBe(true);
  });

  it("base64 content that IS valid UTF-8 text decodes normally, no warning", () => {
    const text = '{"data":{"type":"widgets","id":"1"}}';
    const har = {
      log: {
        entries: [
          {
            request: { method: "GET", url: "https://api.example.com/x", headers: [] },
            response: {
              status: 200,
              headers: [],
              content: {
                size: text.length,
                mimeType: "application/vnd.api+json",
                text: base64Of(new TextEncoder().encode(text)),
                encoding: "base64",
              },
            },
          },
        ],
      },
    };
    const result = parseHar(JSON.stringify(har));
    expect(result.exchanges[0]!.response?.body?.raw).toBe(text);
    expect(result.warnings.some((w) => /binary/i.test(w))).toBe(false);
  });
});

describe("HAR — many entries", () => {
  it("400 entries yield 400 exchanges, not a merged one", () => {
    const entries = Array.from({ length: 400 }, (_, i) => ({
      request: { method: "GET", url: `https://api.example.com/x/${i}`, headers: [] },
      response: { status: 200, headers: [] },
    }));
    const result = parseHar(JSON.stringify({ log: { entries } }));
    expect(result.exchanges).toHaveLength(400);
    expect(result.exchanges[399]!.request?.url).toBe("https://api.example.com/x/399");
  });
});

describe("HAR — malformed and edge-case entries", () => {
  it("an empty HAR produces zero exchanges and a warning", () => {
    const result = parseHar(JSON.stringify({ log: { entries: [] } }));
    expect(result.exchanges).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("an entry missing request.method/url is skipped with a warning, others still import", () => {
    const har = {
      log: {
        entries: [
          { request: { headers: [] }, response: { status: 200, headers: [] } },
          { request: { method: "GET", url: "https://api.example.com/ok", headers: [] }, response: { status: 200, headers: [] } },
        ],
      },
    };
    const result = parseHar(JSON.stringify(har));
    expect(result.exchanges).toHaveLength(1);
    expect(result.exchanges[0]!.request?.url).toBe("https://api.example.com/ok");
    expect(result.warnings.some((w) => /entry 1/i.test(w))).toBe(true);
  });

  it("an entry with no response at all still imports the request", () => {
    const har = { log: { entries: [{ request: { method: "GET", url: "https://api.example.com/x", headers: [] } }] } };
    const result = parseHar(JSON.stringify(har));
    expect(result.exchanges[0]!.request?.method).toBe("GET");
    expect(result.exchanges[0]!.response).toBeUndefined();
  });

  it("not a HAR at all throws ImportError", () => {
    expect(() => parseHar('{"not":"har"}')).toThrow(ImportError);
  });
});

describe("HAR — request body form decoding", () => {
  it("an x-www-form-urlencoded postData decodes .form", () => {
    const har = {
      log: {
        entries: [
          {
            request: {
              method: "POST",
              url: "https://api.example.com/login",
              headers: [],
              postData: { mimeType: "application/x-www-form-urlencoded", text: "user=alice&remember=1" },
            },
            response: { status: 200, headers: [] },
          },
        ],
      },
    };
    const result = parseHar(JSON.stringify(har));
    expect(findParam(result.exchanges[0]!.request!.body!.form!, "user")?.value).toBe("alice");
  });
});

describe("HAR — origin.kind via the Importer object", () => {
  it("is set on every exchange", () => {
    for (const exchange of harImporter.parse(sampleHar).exchanges) {
      expect(exchange.origin).toEqual({ kind: "har" });
    }
  });
});
