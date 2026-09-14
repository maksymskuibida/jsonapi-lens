// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fetchShareBlob, uploadShare } from "../../mcp/transport.js";
import type { FetchLike, MinimalResponse } from "../../mcp/transport.js";
import { createStubBackend } from "./stub-backend.js";

const ORIGIN = "https://stub.example";

function fakeResponse(partial: Partial<MinimalResponse> & { url: string }): MinimalResponse {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(0),
    ...partial,
  };
}

describe("uploadShare / fetchShareBlob against the stub backend", () => {
  it("round-trips a blob through create then read", async () => {
    const backend = createStubBackend(ORIGIN);
    const blob = new Uint8Array([1, 2, 3, 4, 5]) as Uint8Array<ArrayBuffer>;

    const created = await uploadShare(backend.fetchImpl, ORIGIN, blob, "1d");
    expect(created.id).toBeGreaterThan(0);
    expect(created.expiresAt).not.toBeNull();

    const fetched = await fetchShareBlob(backend.fetchImpl, ORIGIN, created.id);
    expect(Array.from(fetched)).toEqual([1, 2, 3, 4, 5]);
  });

  it("passes the lifetime through as a query parameter", async () => {
    const backend = createStubBackend(ORIGIN);
    await uploadShare(backend.fetchImpl, ORIGIN, new Uint8Array([1]) as Uint8Array<ArrayBuffer>, "forever");
    expect(backend.calls[0]!.url).toContain("lifetime=forever");
    const created = await fetchShareBlob(backend.fetchImpl, ORIGIN, 1);
    expect(Array.from(created)).toEqual([1]);
  });

  it("reports a 404 as gone-or-never-existed", async () => {
    const backend = createStubBackend(ORIGIN);
    await expect(fetchShareBlob(backend.fetchImpl, ORIGIN, 999)).rejects.toThrow(/gone or never existed/i);
  });

  it("reports a 410 as expired, distinctly from a 404", async () => {
    const backend = createStubBackend(ORIGIN);
    const created = await uploadShare(backend.fetchImpl, ORIGIN, new Uint8Array([9]) as Uint8Array<ArrayBuffer>, "15m");
    backend.expire(created.id);

    let message = "";
    try {
      await fetchShareBlob(backend.fetchImpl, ORIGIN, created.id);
      expect.unreachable("expected fetchShareBlob to throw on an expired share");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/expired/i);
    expect(message).not.toMatch(/gone or never existed/i);
  });

  it("surfaces the server's own error text and status on a non-2xx create", async () => {
    const fetchImpl: FetchLike = async (url) =>
      fakeResponse({ url, ok: false, status: 413, json: async () => ({ error: "Encrypted document is 13.0 MB, over the 12 MB share limit." }) });

    await expect(uploadShare(fetchImpl, ORIGIN, new Uint8Array([1]) as Uint8Array<ArrayBuffer>, "1d")).rejects.toThrow(
      /413/,
    );
    await expect(uploadShare(fetchImpl, ORIGIN, new Uint8Array([1]) as Uint8Array<ArrayBuffer>, "1d")).rejects.toThrow(
      /12 MB share limit/,
    );
  });

  it("does not retry a non-2xx response", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async (url) => {
      calls++;
      return fakeResponse({ url, ok: false, status: 500, json: async () => ({ error: "boom" }) });
    };
    await expect(uploadShare(fetchImpl, ORIGIN, new Uint8Array([1]) as Uint8Array<ArrayBuffer>, "1d")).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("surfaces a network failure readably rather than an unhandled rejection", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(fetchShareBlob(fetchImpl, ORIGIN, 1)).rejects.toThrow(/could not reach/i);
  });

  it("refuses a response that arrives from a different host than requested (a followed redirect)", async () => {
    const fetchImpl: FetchLike = async () =>
      fakeResponse({
        url: "https://evil.example/api/shares/1",
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      });
    await expect(fetchShareBlob(fetchImpl, ORIGIN, 1)).rejects.toThrow(/redirect/i);
  });

  it("does not flag a response whose url matches the requested origin exactly", async () => {
    const fetchImpl: FetchLike = async (url) =>
      fakeResponse({ url, ok: true, status: 200, arrayBuffer: async () => new Uint8Array([7]).buffer });
    await expect(fetchShareBlob(fetchImpl, ORIGIN, 1)).resolves.toEqual(new Uint8Array([7]));
  });

  // S1r: assertSameOrigin only ever sees a redirect on a hand-built test
  // double — on a real fetch, redirect: "error" means the promise itself
  // rejects before a response exists at all. So the actual hardening is this
  // flag being present on every real network call, not just the backstop
  // check above. Nothing failed before these existed: deleting `redirect:
  // "error"` from either call site left every other test in this file green.
  it("pins redirect: 'error' on the create call", async () => {
    const backend = createStubBackend(ORIGIN);
    await uploadShare(backend.fetchImpl, ORIGIN, new Uint8Array([1]) as Uint8Array<ArrayBuffer>, "1d");
    expect(backend.calls[0]!.init?.redirect).toBe("error");
  });

  it("pins redirect: 'error' on the read call", async () => {
    const backend = createStubBackend(ORIGIN);
    await uploadShare(backend.fetchImpl, ORIGIN, new Uint8Array([1]) as Uint8Array<ArrayBuffer>, "1d");
    await fetchShareBlob(backend.fetchImpl, ORIGIN, 1);
    // calls[0] is the POST from uploadShare above; this is the GET.
    expect(backend.calls[1]!.init?.redirect).toBe("error");
  });

  // S1r: redirect: "error" made the property durable but, on a real fetch,
  // buries the actual reason (a refused redirect, a refused connection, a
  // DNS failure) one level down in Error#cause behind an identical generic
  // outer message — verified this really is undici's shape by triggering
  // each against a real node:http server and reading `cause.cause?.message`
  // by hand (redirect: "unexpected redirect", refused connection:
  // "ECONNREFUSED"/"bad port", DNS: "getaddrinfo ENOTFOUND …"). This test
  // exercises the unwrapping logic itself without needing a real socket.
  it("surfaces the inner cause of a fetch failure, not just the generic outer message", async () => {
    const fetchImpl: FetchLike = async () => {
      const outer = new TypeError("fetch failed");
      (outer as { cause?: unknown }).cause = new Error("unexpected redirect");
      throw outer;
    };
    await expect(fetchShareBlob(fetchImpl, ORIGIN, 1)).rejects.toThrow(/fetch failed.*unexpected redirect/);
  });

  it("falls back to the outer message alone when there is no cause", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    let message = "";
    try {
      await fetchShareBlob(fetchImpl, ORIGIN, 1);
      expect.unreachable("expected fetchShareBlob to throw");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("fetch failed");
    expect(message).not.toContain("undefined");
    expect(message).not.toContain("null");
  });
});
