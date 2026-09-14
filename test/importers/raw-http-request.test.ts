import { describe, expect, it } from "vitest";
import { detectRawHttpRequest, parseRawHttpRequest, rawHttpRequestImporter } from "../../src/importers/raw-http-request.js";
import { ImportError } from "../../src/importers/types.js";
import { getHeader } from "../../src/headers.js";
import { findParam } from "../../src/params.js";

describe("raw HTTP request — detection", () => {
  it("recognises a request line", () => {
    const detection = detectRawHttpRequest("GET /v2/widgets HTTP/1.1\r\nHost: api.example.com\r\n");
    expect(detection).not.toBeNull();
    expect(detection?.summary).toContain("GET");
  });

  it("does not recognise a status line or unrelated text", () => {
    expect(detectRawHttpRequest("HTTP/1.1 200 OK")).toBeNull();
    expect(detectRawHttpRequest("just some text")).toBeNull();
    expect(detectRawHttpRequest("")).toBeNull();
  });
});

describe("raw HTTP request — CRLF and bare LF", () => {
  it("parses with \\r\\n line endings", () => {
    const text = "POST /v2/widgets HTTP/1.1\r\nHost: api.example.com\r\nContent-Type: application/json\r\n\r\n{\"a\":1}";
    const result = parseRawHttpRequest(text);
    const { request } = result.exchanges[0]!;
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.example.com/v2/widgets");
    expect(request?.body?.raw).toBe('{"a":1}');
    expect(request?.body?.contentType).toBe("application/json");
  });

  it("parses with bare \\n line endings identically", () => {
    const text = "POST /v2/widgets HTTP/1.1\nHost: api.example.com\nContent-Type: application/json\n\n{\"a\":1}";
    const result = parseRawHttpRequest(text);
    const { request } = result.exchanges[0]!;
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.example.com/v2/widgets");
    expect(request?.body?.raw).toBe('{"a":1}');
  });
});

describe("raw HTTP request — Host promotes a path target to a full URL", () => {
  it("uses https by default", () => {
    const text = "GET /v2/widgets?active=true HTTP/1.1\r\nHost: api.example.com\r\n";
    const result = parseRawHttpRequest(text);
    const { request } = result.exchanges[0]!;
    expect(request?.url).toBe("https://api.example.com/v2/widgets");
    expect(findParam(request!.query!, "active")?.value).toBe("true");
  });

  it("uses http when Host names port 80", () => {
    const text = "GET /v2/widgets HTTP/1.1\r\nHost: api.example.com:80\r\n";
    const result = parseRawHttpRequest(text);
    expect(result.exchanges[0]!.request?.url).toBe("http://api.example.com:80/v2/widgets");
  });

  it("with no Host header at all, the path is kept as-is, no origin invented", () => {
    const text = "GET /v2/widgets?a=1 HTTP/1.1\r\nAccept: */*\r\n";
    const result = parseRawHttpRequest(text);
    const { request } = result.exchanges[0]!;
    expect(request?.url).toBe("/v2/widgets");
    expect(findParam(request!.query!, "a")?.value).toBe("1");
  });

  it("an absolute-form request line (proxy style) is not touched by Host promotion", () => {
    const text = "GET https://other.example.org/x HTTP/1.1\r\nHost: api.example.com\r\n";
    const result = parseRawHttpRequest(text);
    expect(result.exchanges[0]!.request?.url).toBe("https://other.example.org/x");
  });
});

describe("raw HTTP request — no blank line", () => {
  it("is read as headers only, with a warning, and no body", () => {
    const text = "GET /v2/widgets HTTP/1.1\r\nHost: api.example.com\r\nAccept: */*";
    const result = parseRawHttpRequest(text);
    expect(result.exchanges[0]!.request?.body).toBeUndefined();
    expect(getHeader(result.exchanges[0]!.request!.headers!, "accept")).toBe("*/*");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("raw HTTP request — chunked body", () => {
  it("strips chunk sizes and reassembles cleanly", () => {
    const text =
      "POST /v2/widgets HTTP/1.1\r\n" +
      "Host: api.example.com\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      "4\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n";
    const result = parseRawHttpRequest(text);
    expect(result.exchanges[0]!.request?.body?.raw).toBe("Wikipedia");
    expect(result.warnings.some((w) => /clean/i.test(w))).toBe(false);
  });

  it("warns when the chunked stream does not end cleanly, but still returns what it read", () => {
    const text =
      "POST /v2/widgets HTTP/1.1\r\nHost: api.example.com\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nWiki\r\nnotahexsize\r\n";
    const result = parseRawHttpRequest(text);
    expect(result.exchanges[0]!.request?.body?.raw).toBe("Wiki");
    expect(result.warnings.some((w) => /clean/i.test(w))).toBe(true);
  });
});

describe("raw HTTP request — no request line", () => {
  it("throws ImportError", () => {
    expect(() => parseRawHttpRequest("Host: api.example.com\r\nAccept: */*")).toThrow(ImportError);
  });
});

describe("raw HTTP request — form body decodes to params", () => {
  it("sets .form for an x-www-form-urlencoded body", () => {
    const text =
      "POST /login HTTP/1.1\r\nHost: api.example.com\r\nContent-Type: application/x-www-form-urlencoded\r\n\r\nuser=alice&remember=1";
    const result = parseRawHttpRequest(text);
    const form = result.exchanges[0]!.request?.body?.form;
    expect(findParam(form!, "user")?.value).toBe("alice");
  });
});

describe("raw HTTP request — origin.kind", () => {
  it("names this importer", () => {
    const text = "GET /x HTTP/1.1\r\nHost: api.example.com\r\n";
    expect(rawHttpRequestImporter.parse(text).exchanges[0]!.origin).toEqual({ kind: "raw-http-request" });
  });
});
