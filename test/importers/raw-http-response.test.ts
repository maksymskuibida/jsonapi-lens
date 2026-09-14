import { describe, expect, it } from "vitest";
import { detectRawHttpResponse, parseRawHttpResponse, rawHttpResponseImporter } from "../../src/importers/raw-http-response.js";
import { ImportError } from "../../src/importers/types.js";
import { getHeader } from "../../src/headers.js";

describe("raw HTTP response — detection", () => {
  it("recognises a status line", () => {
    const detection = detectRawHttpResponse("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n");
    expect(detection).not.toBeNull();
    expect(detection?.summary).toContain("200");
  });

  it("does not recognise a request line or unrelated text", () => {
    expect(detectRawHttpResponse("GET /x HTTP/1.1")).toBeNull();
    expect(detectRawHttpResponse("not http at all")).toBeNull();
    expect(detectRawHttpResponse("")).toBeNull();
  });
});

describe("raw HTTP response — status, headers and body in one paste", () => {
  it("with \\r\\n line endings", () => {
    const text =
      "HTTP/1.1 404 Not Found\r\nContent-Type: application/vnd.api+json\r\n\r\n" +
      '{"errors":[{"status":"404","title":"Not Found"}]}';
    const result = parseRawHttpResponse(text);
    const { response } = result.exchanges[0]!;
    expect(response?.status).toBe(404);
    expect(response?.statusText).toBe("Not Found");
    expect(getHeader(response!.headers!, "content-type")).toBe("application/vnd.api+json");
    expect(response?.body?.raw).toBe('{"errors":[{"status":"404","title":"Not Found"}]}');
  });

  it("with bare \\n line endings", () => {
    const text = "HTTP/1.1 200 OK\nContent-Type: text/plain\n\nhello";
    const result = parseRawHttpResponse(text);
    expect(result.exchanges[0]!.response?.status).toBe(200);
    expect(result.exchanges[0]!.response?.body?.raw).toBe("hello");
  });

  it("a status line with no reason phrase", () => {
    const result = parseRawHttpResponse("HTTP/1.1 204\r\n\r\n");
    expect(result.exchanges[0]!.response?.status).toBe(204);
    expect(result.exchanges[0]!.response?.statusText).toBeUndefined();
  });
});

describe("raw HTTP response — no blank line", () => {
  it("is read as headers only, with a warning", () => {
    const text = "HTTP/1.1 200 OK\r\nContent-Type: text/plain";
    const result = parseRawHttpResponse(text);
    expect(result.exchanges[0]!.response?.body).toBeUndefined();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("raw HTTP response — chunked body", () => {
  it("reassembles cleanly and strips chunk sizes", () => {
    const text = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n";
    const result = parseRawHttpResponse(text);
    expect(result.exchanges[0]!.response?.body?.raw).toBe("Wikipedia");
  });
});

describe("raw HTTP response — no status line", () => {
  it("throws ImportError", () => {
    expect(() => parseRawHttpResponse("Content-Type: text/plain\r\n\r\nbody")).toThrow(ImportError);
  });
});

describe("raw HTTP response — secrets in headers are counted", () => {
  it("warns with a count when Set-Cookie or Authorization-shaped headers appear", () => {
    const text = "HTTP/1.1 200 OK\r\nSet-Cookie: session=abc123; HttpOnly\r\n\r\n";
    const result = parseRawHttpResponse(text);
    expect(result.warnings.some((w) => /masked/i.test(w))).toBe(true);
  });
});

describe("raw HTTP response — origin.kind", () => {
  it("names this importer", () => {
    const result = rawHttpResponseImporter.parse("HTTP/1.1 200 OK\r\n\r\n");
    expect(result.exchanges[0]!.origin).toEqual({ kind: "raw-http-response" });
  });
});
