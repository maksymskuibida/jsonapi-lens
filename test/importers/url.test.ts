import { describe, expect, it } from "vitest";
import { detectUrl, parseUrl, urlImporter } from "../../src/importers/url.js";
import { ImportError } from "../../src/importers/types.js";
import { findParam } from "../../src/params.js";

describe("bare URL — detection", () => {
  it("recognises an absolute https URL", () => {
    const detection = detectUrl("https://api.example.com/v2/widgets?active=true");
    expect(detection).not.toBeNull();
    expect(detection?.confidence).toBeGreaterThan(0.8);
  });

  it("recognises a scheme-less host+path at lower confidence", () => {
    const detection = detectUrl("api.example.com/v2/widgets");
    expect(detection).not.toBeNull();
    expect(detection!.confidence).toBeLessThan(detectUrl("https://api.example.com/v2/widgets")!.confidence);
  });

  it("does not recognise text with whitespace, a curl command, or plain words", () => {
    expect(detectUrl("this has spaces.com")).toBeNull();
    expect(detectUrl("curl https://api.example.com")).toBeNull();
    expect(detectUrl("hello")).toBeNull();
    expect(detectUrl("")).toBeNull();
  });

  it("rejects anything past the length budget outright", () => {
    expect(detectUrl(`https://api.example.com/${"a".repeat(9000)}`)).toBeNull();
  });
});

describe("bare URL — parse", () => {
  it("fills method GET and decodes the query", () => {
    const result = parseUrl("https://api.example.com/v2/widgets?active=true&sort=-created");
    const { request } = result.exchanges[0]!;
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe("https://api.example.com/v2/widgets");
    expect(findParam(request!.query!, "active")?.value).toBe("true");
    expect(findParam(request!.query!, "sort")?.value).toBe("-created");
  });

  it("a URL with no query at all leaves query absent, not an empty set", () => {
    const result = parseUrl("https://api.example.com/v2/widgets");
    expect("query" in result.exchanges[0]!.request!).toBe(false);
  });

  it("assumes https for a scheme-less URL and warns about the assumption", () => {
    const result = parseUrl("api.example.com/v2/widgets");
    expect(result.exchanges[0]!.request?.url).toBe("https://api.example.com/v2/widgets");
    expect(result.warnings.some((w) => /https/i.test(w))).toBe(true);
  });

  it("throws ImportError for text that cannot be read as a URL", () => {
    expect(() => parseUrl("not a url")).toThrow(ImportError);
  });

  it("sets origin.kind", () => {
    expect(urlImporter.parse("https://api.example.com/x").exchanges[0]!.origin).toEqual({ kind: "url" });
  });
});
