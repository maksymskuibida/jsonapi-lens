// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * `src/worker.ts` is excluded from the app tsconfig (it is built for workerd
 * and its globals conflict with the DOM lib), so it cannot be `import`ed with
 * a literal specifier here. A specifier held in a variable is opaque to the
 * typechecker and still resolved by Vite at run time — that is the whole
 * trick, and the reason `Worker` below is hand-typed.
 */
interface Worker {
  fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
}
const WORKER_PATH: string = "../src/worker.ts";
const worker = (await import(/* @vite-ignore */ WORKER_PATH)).default as Worker;

/** What `public/_headers` gives the shell, at the one place that matters here. */
const SITE_WIDE_REFERRER = "strict-origin-when-cross-origin";

/**
 * A stand-in `ASSETS` binding. `serveShell` asks it for `/` and re-wraps the
 * answer; this returns a shell that already carries the site-wide policy,
 * like the real asset router does.
 */
const env = {
  ASSETS: {
    async fetch(): Promise<Response> {
      return new Response("<!doctype html><title>shell</title>", {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "referrer-policy": SITE_WIDE_REFERRER,
          "x-content-type-options": "nosniff",
        },
      });
    },
  },
};
const ctx = { waitUntil() {} };

const call = (path: string, method = "GET") =>
  worker.fetch(new Request(`https://example.test${path}`, { method }), env, ctx);

describe("Referrer-Policy on page responses — QA4 item 2", () => {
  it.each([
    ["/d/42", "share-damaged: how the server sees an ordinary # link"],
    ["/d/42:AAAAAAAAAAAA", "legacy in-path key"],
    ["/d/42.AAAAAAAAAAAA", "legacy dotted key"],
    ["/d/42%23AAAAAAAAAAAA", "%23-rewritten key"],
  ])("%s (%s) is served no-referrer, replacing the inherited value", async (path) => {
    for (const method of ["GET", "HEAD"]) {
      const res = await call(path, method);
      expect(res.status, `${method} ${path}`).toBe(200);
      // `Headers` folds duplicates into one comma-joined value, so a second
      // header would show up as "no-referrer, strict-origin-…", not be hidden.
      expect(res.headers.get("referrer-policy"), `${method} ${path}`).toBe("no-referrer");
    }
  });

  it.each(["/", "/view", "/impressum", "/privacy"])("%s keeps the site-wide policy", async (path) => {
    const res = await call(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("referrer-policy")).toBe(SITE_WIDE_REFERRER);
  });

  it("an unknown path is a 404 and keeps the site-wide policy", async () => {
    for (const path of ["/nope", "/d/notanumber"]) {
      const res = await call(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("referrer-policy"), path).toBe(SITE_WIDE_REFERRER);
    }
  });

  it("the 405 for a share route says no-referrer too; for /view it keeps the site-wide policy", async () => {
    const share = await call("/d/42", "POST");
    expect(share.status).toBe(405);
    expect(share.headers.get("allow")).toBe("GET, HEAD");
    expect(share.headers.get("referrer-policy")).toBe("no-referrer");

    const view = await call("/view", "POST");
    expect(view.status).toBe(405);
    expect(view.headers.get("referrer-policy")).toBe(SITE_WIDE_REFERRER);
    // The rest of the security headers are still there on the share 405.
    expect(share.headers.get("x-frame-options")).toBe("DENY");
    expect(share.headers.get("content-security-policy")).toContain("default-src 'none'");
  });
});

describe("/api/health methods — QA4 item 4", () => {
  it.each(["GET", "HEAD"])("%s answers 200 {ok:true} with the JSON headers", async (method) => {
    const res = await call("/api/health", method);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    if (method === "GET") expect(await res.text()).toBe('{"ok":true}');
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "%s answers 405 with Allow: GET, HEAD and the same JSON headers",
    async (method) => {
      const res = await call("/api/health", method);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD");
      expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await res.json()).toEqual({ error: "Method not allowed." });
    },
  );

  it("does not change an unknown /api path: still 404", async () => {
    const res = await call("/api/nope", "POST");
    expect(res.status).toBe(404);
    expect(res.headers.get("allow")).toBeNull();
  });
});

describe("Workers Logs cannot retain a share key — QA4 item 1", () => {
  const source = readFileSync(new URL("../src/worker.ts", import.meta.url), "utf8");
  const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");

  /** Every `console.<method>(…)` call, argument text included, up to the matching paren. */
  function consoleCalls(text: string): string[] {
    const calls: string[] = [];
    const re = /console\.\w+\(/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      let depth = 1;
      let i = re.lastIndex;
      for (; i < text.length && depth > 0; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")") depth--;
      }
      calls.push(text.slice(m.index, i));
    }
    return calls;
  }

  const FORBIDDEN = /request\.url|\burl\b|pathname|\.headers|\breferer\b|\breferrer\b|\brequest\b/i;

  it("the scan finds the Worker's console calls, so it cannot pass vacuously", () => {
    expect(consoleCalls(source).length).toBeGreaterThanOrEqual(2);
  });

  it("no console.* call in worker.ts mentions the request, its URL, its path or a header", () => {
    for (const call of consoleCalls(source)) {
      expect(call, call).not.toMatch(FORBIDDEN);
    }
  });

  it("the scan itself would catch the offending shapes", () => {
    for (const bad of [
      "console.log(request.url)",
      "console.info(`GET ${url.pathname}`)",
      'console.warn("ref", request.headers.get("referer"))',
    ]) {
      expect(consoleCalls(bad).some((c) => FORBIDDEN.test(c)), bad).toBe(true);
    }
  });

  it("wrangler.jsonc turns invocation logs off while keeping observability on", () => {
    // JSONC: strip line comments (none of them contain a quote-delimited `//`
    // inside a string except the URL-free strings this file has), then parse.
    const json = JSON.parse(
      config
        .split("\n")
        .map((line) => line.replace(/^\s*\/\/.*$/, ""))
        .join("\n")
        .replace(/,(\s*[}\]])/g, "$1"),
    ) as { observability: { enabled: boolean; head_sampling_rate: number; logs: { invocation_logs: boolean } } };
    expect(json.observability.enabled).toBe(true);
    expect(json.observability.head_sampling_rate).toBe(1);
    expect(json.observability.logs.invocation_logs).toBe(false);
  });
});
