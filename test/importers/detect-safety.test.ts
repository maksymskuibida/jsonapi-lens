/**
 * `docs/task-specs/T3.md`'s required test: "every `detect` returns `null`
 * rather than throwing, over a corpus including empty string, binary bytes,
 * a 5 MB single line, and a deeply nested object."
 *
 * The corpus also carries prototype-pollution-shaped keys (`__proto__`,
 * `constructor.prototype`) — not in the spec's own list, but flagged during
 * T2a's PR #6 review as a live class of hostile input `decodeParams` does
 * not yet defend itself against. Every importer here reaches `decodeParams`
 * transitively (a query string, a HAR `postData`, a transport-log
 * `request_params`), so this importer's own corpus needs the same entries T2a's
 * review added to its — a query string carrying `__proto__` reaches this
 * directory exactly the way it reaches `params.ts`.
 */
import { describe, expect, it } from "vitest";
import { IMPORTERS } from "../../src/importers/index.js";

function repeat(char: string, times: number): string {
  return new Array(times + 1).join(char);
}

/** A JSON document nested far deeper than any real payload — the corpus's "deeply nested object" case. */
function deeplyNestedJson(depth: number): string {
  return repeat('{"a":', depth) + "1" + repeat("}", depth);
}

const HOSTILE_CORPUS: { name: string; text: string }[] = [
  { name: "empty string", text: "" },
  { name: "whitespace only", text: "   \n\t  " },
  { name: "binary bytes", text: "\x00\x01\x02\xff\xfe\xfd\x07\x1b\x00" },
  { name: "binary bytes with a null in the middle", text: "curl \x00 https://api.example.com" },
  { name: "a 5 MB single line", text: "a".repeat(5 * 1024 * 1024) },
  { name: "a 5 MB single line that looks JSON-ish", text: `{"a":"${"x".repeat(5 * 1024 * 1024)}"}` },
  { name: "a deeply nested JSON object (10,000 levels)", text: deeplyNestedJson(10_000) },
  { name: "a deeply bracketed query string (10,000 segments)", text: `https://api.example.com/x?a${repeat("[a]", 10_000)}=1` },
  { name: "__proto__ in a query string", text: "https://api.example.com/x?__proto__[polluted]=1" },
  { name: "__proto__.polluted include-style value", text: "https://api.example.com/x?include=__proto__.polluted" },
  { name: "constructor.prototype in a query string", text: "https://api.example.com/x?constructor[prototype][polluted]=1" },
  { name: "__proto__ as a HAR postData form value", text: JSON.stringify({ log: { entries: [{ request: { method: "POST", url: "https://api.example.com", postData: { mimeType: "application/x-www-form-urlencoded", text: "__proto__[polluted]=1" } }, response: { status: 200 } }] } }) },
  { name: "__proto__ inside a transport log's request_params object", text: JSON.stringify({ context: {}, info: { message_type: "transport_logging", http_method: "GET", url: "https://api.example.com", request_params: { __proto__: { polluted: 1 } } } }) },
  { name: "a lone surrogate", text: "\ud800curl https://api.example.com\ud800" },
  { name: "not even text-shaped", text: "\u{1F4A9}".repeat(10_000) },
  { name: "a single unterminated quote", text: "curl 'https://api.example.com" },
  { name: "just the word curl", text: "curl" },
  { name: "just an HTTP version token", text: "HTTP/1.1" },
  { name: "a bare slash", text: "/" },
  { name: "NDJSON of garbage", text: "not json\nalso not json\n{still not" },
];

describe("every importer's detect() never throws", () => {
  for (const importer of IMPORTERS) {
    describe(importer.id, () => {
      for (const { name, text } of HOSTILE_CORPUS) {
        it(`does not throw on: ${name}`, () => {
          expect(() => importer.detect(text)).not.toThrow();
        });
      }
    });
  }
});

describe("hostile input does not pollute Object.prototype", () => {
  it("importing __proto__-shaped query data does not add a prototype property", () => {
    const before = ({} as Record<string, unknown>)["polluted"];
    expect(before).toBeUndefined();

    for (const importer of IMPORTERS) {
      const text = "https://api.example.com/x?__proto__[polluted]=1&constructor[prototype][polluted]=1";
      const detection = importer.detect(text);
      if (detection === null) continue;
      try {
        importer.parse(text);
      } catch {
        // A rejected parse is fine — the only thing under test is that
        // *attempting* it never reaches through to the shared prototype.
      }
    }

    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
  });

  it("importing a __proto__-shaped transport-log request_params object does not add a prototype property", () => {
    const text = JSON.stringify({
      context: { correlation_id: "x" },
      info: {
        message_type: "transport_logging",
        http_method: "GET",
        url: "https://api.example.com/x",
        request_params: { __proto__: { polluted: 1 }, constructor: { prototype: { polluted: 1 } } },
      },
    });

    for (const importer of IMPORTERS) {
      if (importer.detect(text) === null) continue;
      try {
        importer.parse(text);
      } catch {
        /* rejection is fine; pollution is not */
      }
    }

    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});
