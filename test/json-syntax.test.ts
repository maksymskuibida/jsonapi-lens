/**
 * QA5 — JSON syntax errors are located and worded by the app, never by the engine.
 *
 * The defect: in German and Ukrainian the "not valid JSON" hint ended with the
 * browser's raw English `SyntaxError` message, which also echoed the first
 * characters of the input. These tests pin three things: the scanner agrees
 * with `JSON.parse` about *whether* text is JSON, it reports the right kind and
 * place, and no language's hint contains anything the engine said.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { lineColumnAt, locateSyntaxError } from "../src/json-syntax.js";
import { STORAGE_KEY } from "../src/i18n/index.js";
import { richToText } from "../src/dom.js";

const at = (text: string) => {
  const found = locateSyntaxError(text);
  return found && { kind: found.problem.kind, offset: found.offset, ...("char" in found.problem ? { char: found.problem.char } : {}) };
};

describe("locateSyntaxError", () => {
  it("names a stray character and where it is", () => {
    expect(at("QA synthetic payload")).toEqual({ kind: "unexpected-char", offset: 0, char: "Q" });
    expect(at('{"a": 1 "b": 2}')).toEqual({ kind: "unexpected-char", offset: 8, char: '"' });
    expect(at("{'a': 1}")).toEqual({ kind: "unexpected-char", offset: 1, char: "'" });
    expect(at('{"a": None}')).toEqual({ kind: "unexpected-char", offset: 6, char: "N" });
    expect(at('{"a": tru}')).toEqual({ kind: "unexpected-char", offset: 9, char: "}" });
  });

  it("recognises a truncated document, at the end", () => {
    expect(at('{"data": [1, 2')).toEqual({ kind: "unexpected-end", offset: 14 });
    expect(at('{"data": "abc')).toEqual({ kind: "unexpected-end", offset: 13 });
    expect(at('{"data":')).toEqual({ kind: "unexpected-end", offset: 8 });
    expect(at('{"a": nul')).toEqual({ kind: "unexpected-end", offset: 9 });
    expect(at('{"a": "\\u12')).toEqual({ kind: "unexpected-end", offset: 11 });
  });

  it("recognises a trailing comma in an object and in an array", () => {
    expect(at('{"a": 1,}')).toEqual({ kind: "trailing-comma", offset: 8 });
    expect(at("[1, 2, ]")).toEqual({ kind: "trailing-comma", offset: 7 });
    expect(at('{"a": [1,],}')?.kind).toBe("trailing-comma");
  });

  it("recognises a raw line break and a bad escape inside a string", () => {
    expect(at('{"a": "line\nbreak"}')).toEqual({ kind: "control-in-string", offset: 11 });
    expect(at('{"a": "tab\there"}')?.kind).toBe("control-in-string");
    expect(at('{"a": "\\x"}')).toEqual({ kind: "bad-escape", offset: 8 });
    expect(at('{"a": "\\u12G4"}')).toEqual({ kind: "bad-escape", offset: 11 });
  });

  it("recognises text after a complete document", () => {
    expect(at('{"a":1} {"b":2}')).toEqual({ kind: "extra-content", offset: 8, char: "{" });
    expect(at("[] x")).toEqual({ kind: "extra-content", offset: 3, char: "x" });
  });

  it("rejects the number shapes JSON forbids", () => {
    for (const text of ["01", "1.", ".5", "+1", "1e", "-", "[1.e3]", "0x10"]) {
      expect(at(text), text).not.toBeNull();
    }
  });

  it("names an invisible character by code point instead of printing nothing", () => {
    expect(at('{"a": 1}')).toEqual({ kind: "unexpected-char", offset: 5, char: "U+00A0" });
    expect(at('{"a":​1}')).toEqual({ kind: "unexpected-char", offset: 5, char: "U+200B" });
  });

  it("names a lone combining mark by code point, since beside the quote it would be invisible", () => {
    expect(at("\u0301{}")).toEqual({ kind: "unexpected-char", offset: 0, char: "U+0301" });
  });

  it("reports an astral character whole, not as half a surrogate pair", () => {
    expect(at("\u{1F682} train")).toEqual({ kind: "unexpected-char", offset: 0, char: "\u{1F682}" });
  });

  it("does not overflow the stack on a deeply nested document that is also malformed", () => {
    const depth = 200_000;
    const text = "[".repeat(depth) + "x";
    expect(at(text)).toEqual({ kind: "unexpected-char", offset: depth, char: "x" });
    expect(at("[".repeat(depth))?.kind).toBe("unexpected-end");
  });

  it("agrees with JSON.parse about whether text is JSON, over valid documents and their mutations", () => {
    const valid = [
      '{"data":{"type":"a","id":"1","attributes":{"n":[1,-2.5e+3,true,false,null,"\\u00e9\\n"]}}}',
      "[]",
      "{}",
      '"s"',
      "0",
      "-0.0e-0",
      '  [ 1 , { "k" : [ ] } ]\n',
    ];
    const mutations = (text: string): string[] => {
      const out: string[] = [];
      for (let i = 0; i <= text.length; i++) {
        out.push(text.slice(0, i)); // every truncation
        out.push(text.slice(0, i) + text.slice(i + 1)); // every deletion
        for (const ch of [",", ":", "}", "]", '"', "x", "\n", "\\"]) out.push(text.slice(0, i) + ch + text.slice(i));
      }
      return out;
    };
    let checked = 0;
    for (const doc of valid) {
      for (const candidate of [doc, ...mutations(doc)]) {
        let parses = true;
        try {
          JSON.parse(candidate);
        } catch {
          parses = false;
        }
        const located = locateSyntaxError(candidate);
        // Empty / whitespace-only input is `unexpected-end` here and `parse.ts` never reaches us with it.
        expect(located === null, JSON.stringify(candidate)).toBe(parses);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe("lineColumnAt", () => {
  it("counts lines and columns from 1", () => {
    expect(lineColumnAt("abc", 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumnAt("abc\ndef", 5)).toEqual({ line: 2, column: 2 });
  });

  it("counts CRLF as one line break and a lone CR as one", () => {
    expect(lineColumnAt("a\r\nb", 3)).toEqual({ line: 2, column: 1 });
    expect(lineColumnAt("a\rb", 2)).toEqual({ line: 2, column: 1 });
  });

  it("counts columns in characters, not UTF-16 units", () => {
    expect(lineColumnAt("\u{1F682}x", 2)).toEqual({ line: 1, column: 2 });
  });

  it("clamps an offset past the end", () => {
    expect(lineColumnAt("ab", 99)).toEqual({ line: 1, column: 3 });
  });
});

async function parseIn(lang: "en" | "de" | "uk", text: string) {
  localStorage.setItem(STORAGE_KEY, lang);
  vi.resetModules();
  const { parseJson, DocumentError } = await import("../src/parse.js");
  try {
    parseJson(text);
  } catch (error) {
    if (error instanceof DocumentError) return error;
    throw error;
  }
  throw new Error("expected a DocumentError");
}

afterEach(() => {
  localStorage.setItem(STORAGE_KEY, "en");
  vi.resetModules();
});

describe("parseJson errors, per language", () => {
  // The exact text from the QA report, and a document that really is truncated.
  const CASES: Record<string, { text: string; line: number; column: number }> = {
    "QA synthetic": { text: "QA synthetic payload, not JSON", line: 1, column: 1 },
    "truncated": { text: '{\n  "data": [\n    {"type": "a"', line: 3, column: 17 },
    "leading blank lines count": { text: '\n\n  {"a": 1,}', line: 3, column: 11 },
    "python dict": { text: "{'data': None}", line: 1, column: 2 },
    "trailing comma": { text: '{"data": [1,]}', line: 1, column: 13 },
  };

  const ENGINE_WORDS = /Unexpected token|Unexpected identifier|Unexpected end|\.\.\. is not valid JSON|JSON\.parse|JSON Parse error|SyntaxError|after property|in JSON at position|position \d|line \d+ column \d+/i;

  for (const lang of ["en", "de", "uk"] as const) {
    for (const [name, c] of Object.entries(CASES)) {
      it(`${lang}: ${name} — located exactly, and nothing the engine said appears`, async () => {
        const error = await parseIn(lang, c.text);
        expect(error.line).toBe(c.line);
        expect(error.column).toBe(c.column);

        const hint = typeof error.hint === "string" ? error.hint : richToText(error.hint);
        expect(error.headline).not.toMatch(ENGINE_WORDS);
        // The English words of `invalidJson`'s own hint are fine in `en` and must not leak into the others.
        if (lang !== "en") {
          expect(`${error.headline} ${hint}`).not.toMatch(/\b(the|parser|stopped|unexpected)\b/);
        }
        expect(hint).not.toMatch(ENGINE_WORDS);
        // And the input is not echoed beyond the one offending character the hint is entitled to quote.
        expect(hint).not.toContain("QA synthet");
      });
    }
  }

  it("a hostile character is carried as a value, so it can never be parsed as markup", async () => {
    const error = await parseIn("en", "<img src=x onerror=alert(1)>");
    const parts = error.hint as readonly unknown[];
    expect(Array.isArray(parts)).toBe(true);
    expect(parts).toContainEqual({ verbatim: "“<”" });
  });

  it("wrong top-level types are worded in the interface language, not with typeof's English", async () => {
    localStorage.setItem(STORAGE_KEY, "de");
    vi.resetModules();
    const { parseJson, assertJsonApi, DocumentError } = await import("../src/parse.js");
    const headlines: string[] = [];
    for (const raw of ["42", "true", "null"]) {
      try {
        assertJsonApi(parseJson(raw));
      } catch (error) {
        if (error instanceof DocumentError) headlines.push(error.headline);
      }
    }
    expect(headlines).toEqual([
      "Das ist eine JSON-Zahl, kein JSON:API-Dokument.",
      "Das ist ein JSON-Boolean, kein JSON:API-Dokument.",
      "Das ist JSON-`null`, kein JSON:API-Dokument.",
    ]);
  });
});
