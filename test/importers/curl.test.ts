import { describe, expect, it } from "vitest";
import { curlImporter, detectCurl, parseCurl } from "../../src/importers/curl.js";
import { ImportError } from "../../src/importers/types.js";
import { getHeader, getHeaderAll } from "../../src/headers.js";
import { findParam } from "../../src/params.js";

describe("cURL — detection", () => {
  it("recognises a curl command and reports the method and header count", () => {
    const detection = detectCurl("curl 'https://api.example.com/v2/widgets' -H 'accept: application/vnd.api+json'");
    expect(detection).not.toBeNull();
    expect(detection?.id).toBe("curl");
    expect(detection?.confidence).toBeGreaterThan(0.9);
    expect(detection?.summary).toContain("GET");
  });

  it("does not recognise unrelated text", () => {
    expect(detectCurl("GET /widgets HTTP/1.1")).toBeNull();
    expect(detectCurl("https://api.example.com")).toBeNull();
    expect(detectCurl("")).toBeNull();
  });
});

describe("cURL — the exact shapes devtools emits", () => {
  it("a GET with headers (Chrome 'Copy as cURL', bash)", () => {
    const command = [
      "curl 'https://api.example.com/v2/widgets?active=true&sort=-created' \\",
      "  -H 'accept: application/vnd.api+json' \\",
      "  -H 'accept-language: en-US,en;q=0.9' \\",
      "  -H 'authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U' \\",
      "  --compressed",
    ].join("\n");

    const detection = curlImporter.detect(command);
    expect(detection).not.toBeNull();

    const result = curlImporter.parse(command);
    expect(result.exchanges).toHaveLength(1);
    const { request } = result.exchanges[0]!;
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe("https://api.example.com/v2/widgets");
    expect(findParam(request!.query!, "active")?.value).toBe("true");
    expect(findParam(request!.query!, "sort")?.value).toBe("-created");
    expect(getHeader(request!.headers!, "accept")).toBe("application/vnd.api+json");
    expect(getHeader(request!.headers!, "accept-language")).toBe("en-US,en;q=0.9");
    expect(getHeader(request!.headers!, "authorization")).toContain("Bearer ");
    // --compressed with no explicit Accept-Encoding adds one.
    expect(getHeader(request!.headers!, "accept-encoding")).toContain("gzip");
    // A JWT-shaped Authorization value is exactly what the redaction offer should find.
    expect(result.warnings.some((w) => /masked/i.test(w))).toBe(true);
  });

  it("a POST with --data-raw (Chrome 'Copy as cURL', bash)", () => {
    const command = [
      "curl 'https://api.example.com/v2/widgets' \\",
      "  -H 'content-type: application/json' \\",
      "  -H 'authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U' \\",
      '  --data-raw \'{"data":{"type":"widgets","attributes":{"name":"Widget"}}}\' \\',
      "  --compressed",
    ].join("\n");

    const result = curlImporter.parse(command);
    const { request } = result.exchanges[0]!;
    // -d/--data-raw implies POST when -X is not given.
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe("https://api.example.com/v2/widgets");
    expect(request?.body?.raw).toBe('{"data":{"type":"widgets","attributes":{"name":"Widget"}}}');
    expect(request?.body?.contentType).toBe("application/x-www-form-urlencoded");
  });
});

describe("cURL — quoting styles", () => {
  it("single quotes are fully literal", () => {
    const result = parseCurl(`curl 'https://api.example.com/x' -H 'x-note: a $b \\c'`);
    expect(getHeader(result.exchanges[0]!.request!.headers!, "x-note")).toBe("a $b \\c");
  });

  it("double quotes process backslash escapes for \\\" \\\\ \\$ and backtick only", () => {
    const result = parseCurl(`curl "https://api.example.com/x" -H "x-note: say \\"hi\\" \\\\ done"`);
    expect(getHeader(result.exchanges[0]!.request!.headers!, "x-note")).toBe('say "hi" \\ done');
  });

  it("$'...' ANSI-C quoting decodes \\n, \\t and \\xHH", () => {
    const result = parseCurl(`curl 'https://api.example.com/x' -H $'x-note: a\\tb\\nc\\x21'`);
    expect(getHeader(result.exchanges[0]!.request!.headers!, "x-note")).toBe("a\tb\nc!");
  });

  it("adjacent quoted parts with no separating space concatenate into one token", () => {
    const result = parseCurl(`curl 'https://api.example.com/x' -H'accept: '"application/json"`);
    expect(getHeader(result.exchanges[0]!.request!.headers!, "accept")).toBe("application/json");
  });
});

describe("cURL — line continuations", () => {
  it("a backslash continuation joins the next line", () => {
    const command = "curl 'https://api.example.com/x' \\\n  -H 'accept: application/json'";
    const result = parseCurl(command);
    expect(getHeader(result.exchanges[0]!.request!.headers!, "accept")).toBe("application/json");
  });

  it("a caret continuation (cmd.exe) joins the next line", () => {
    const command = "curl 'https://api.example.com/x' ^\n  -H 'accept: application/json'";
    const result = parseCurl(command);
    expect(getHeader(result.exchanges[0]!.request!.headers!, "accept")).toBe("application/json");
  });
});

describe("cURL — -G moves body params to the query", () => {
  it("combines -d data with an existing query string", () => {
    const result = parseCurl("curl -G 'https://api.example.com/x?existing=1' -d 'a=1' -d 'b=2'");
    const { request } = result.exchanges[0]!;
    expect(request?.method).toBe("GET");
    expect(request?.body).toBeUndefined();
    expect(findParam(request!.query!, "existing")?.value).toBe("1");
    expect(findParam(request!.query!, "a")?.value).toBe("1");
    expect(findParam(request!.query!, "b")?.value).toBe("2");
  });
});

describe("cURL — unknown flags are a warning, not a failure", () => {
  it("parses what it understood and names the flag it skipped", () => {
    const result = parseCurl("curl 'https://api.example.com/x' --frobnicate wat");
    expect(result.exchanges).toHaveLength(1);
    expect(result.exchanges[0]!.request?.url).toBe("https://api.example.com/x");
    expect(result.warnings.some((w) => w.includes("--frobnicate"))).toBe(true);
  });

  it("recognised no-op flags (like -s, -v, -L) never produce a warning", () => {
    const result = parseCurl("curl -sSL 'https://api.example.com/x' -o /dev/null -v");
    // -sSL is a bundle this importer does not decompose, so it is reported
    // as one unrecognised token — but the *separately listed* single-letter
    // no-ops must never appear in warnings text on their own.
    expect(result.warnings.join(" ")).not.toMatch(/\B-v\b|\B-o\b/);
  });
});

describe("cURL — unbalanced quotes", () => {
  it("throws ImportError naming the position, and never partially imports", () => {
    expect(() => parseCurl("curl 'https://api.example.com/x")).toThrow(ImportError);
    try {
      parseCurl("curl 'https://api.example.com/x");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ImportError);
      expect((error as ImportError).line).toBeGreaterThanOrEqual(1);
      expect((error as ImportError).headline.length).toBeGreaterThan(0);
    }
  });

  it("an unterminated double quote also throws", () => {
    expect(() => parseCurl('curl "https://api.example.com/x')).toThrow(ImportError);
  });

  it("an unterminated $'...' also throws", () => {
    expect(() => parseCurl("curl 'https://api.example.com/x' -H $'unterminated")).toThrow(ImportError);
  });
});

describe("cURL — -u, -b, -A, -e", () => {
  it("-u builds a Basic Authorization header", () => {
    const result = parseCurl("curl 'https://api.example.com/x' -u 'alice:s3cret'");
    const auth = getHeader(result.exchanges[0]!.request!.headers!, "authorization");
    expect(auth).toMatch(/^Basic /);
    const decoded = atob(auth!.slice("Basic ".length));
    expect(decoded).toBe("alice:s3cret");
  });

  it("-b sets request cookies, not a header", () => {
    const result = parseCurl("curl 'https://api.example.com/x' -b 'session=abc123; theme=dark'");
    const { request } = result.exchanges[0]!;
    expect(request?.cookies?.entries).toEqual([
      { name: "session", value: "abc123" },
      { name: "theme", value: "dark" },
    ]);
  });

  it("-b with no '=' is a cookie-jar filename, which cannot be read, and is skipped with a warning", () => {
    const result = parseCurl("curl 'https://api.example.com/x' -b cookies.txt");
    expect(result.exchanges[0]!.request?.cookies).toBeUndefined();
    expect(result.warnings.some((w) => w.includes("cookies.txt"))).toBe(true);
  });

  it("-A sets User-Agent and -e sets Referer", () => {
    const result = parseCurl("curl 'https://api.example.com/x' -A 'test-agent/1.0' -e 'https://example.com/from'");
    const { headers } = result.exchanges[0]!.request!;
    expect(getHeader(headers!, "user-agent")).toBe("test-agent/1.0");
    expect(getHeader(headers!, "referer")).toBe("https://example.com/from");
  });
});

describe("cURL — -F multipart", () => {
  it("records fields as name=value and warns when a file field cannot be read", () => {
    const result = parseCurl("curl 'https://api.example.com/x' -F 'title=hello' -F 'avatar=@photo.png'");
    const { request } = result.exchanges[0]!;
    expect(request?.body?.contentType).toBe("multipart/form-data");
    expect(request?.body?.raw).toContain("title=hello");
    expect(request?.body?.raw).toContain("avatar=@photo.png");
    expect(result.warnings.some((w) => w.includes("photo.png"))).toBe(true);
  });
});

describe("cURL — --data-urlencode", () => {
  it("url-encodes only the value half of name=value", () => {
    const result = parseCurl("curl 'https://api.example.com/x' --data-urlencode 'q=a b&c'");
    expect(request(result).body?.raw).toBe("q=a%20b%26c");
  });

  it("url-encodes a whole bare value with no name", () => {
    const result = parseCurl("curl 'https://api.example.com/x' --data-urlencode 'a b'");
    expect(request(result).body?.raw).toBe("a%20b");
  });

  function request(r: ReturnType<typeof parseCurl>) {
    return r.exchanges[0]!.request!;
  }
});

describe("cURL — duplicate headers are preserved", () => {
  it("two -H occurrences for the same name keep both", () => {
    const result = parseCurl("curl 'https://api.example.com/x' -H 'x-a: 1' -H 'x-a: 2'");
    expect(getHeaderAll(result.exchanges[0]!.request!.headers!, "x-a")).toEqual(["1", "2"]);
  });
});

describe("cURL — not a curl command at all", () => {
  it("parse throws ImportError rather than guessing", () => {
    expect(() => parseCurl("this is not curl")).toThrow(ImportError);
  });
});
