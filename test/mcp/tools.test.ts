// @vitest-environment node
import "../../mcp/locale.js";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMcpServer } from "../../mcp/build-server.js";
import { GENERATE_SECRET_COMMAND, LIFETIME_KEYS } from "../../mcp/validate.js";
import { generateSecret, open, seal } from "../../src/crypto.js";
import type { SharePayload } from "../../src/crypto.js";
import { createStubBackend } from "./stub-backend.js";
import type { StubBackend } from "./stub-backend.js";

const ORIGIN = "https://stub.example";
const SECRET_A = "a".repeat(64);
const SECRET_B = "b".repeat(64);
const SECRET_BUNDLE = "c".repeat(64);

/**
 * Deterministic, high-entropy filler — copied from the same, already-proven
 * generator in `test/crypto.test.ts`, because a size-cap test's plaintext
 * must actually resist gzip. A naive `Math.random()` loop over a small
 * alphabet is *not* high enough entropy: DEFLATE's Huffman stage still
 * shrinks a small, uniform alphabet noticeably, which is exactly what made
 * this test pass for the wrong reason (no error at all) the first time it
 * was written with only ~1 KB of margin over the cap. 18 MB raw, at this
 * alphabet's entropy, reliably seals to more than the 12 MB cap — matching
 * `test/crypto.test.ts`'s own margin for the same check.
 */
function pseudoRandomText(byteLength: number): string {
  const printable: number[] = [];
  for (let code = 0x21; code <= 0x7e; code++) {
    if (code !== 0x22 && code !== 0x5c) printable.push(code); // skip " and \
  }
  const bytes = new Uint8Array(byteLength);
  let seed = 0x2545f491 ^ byteLength;
  for (let i = 0; i < byteLength; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    bytes[i] = printable[seed % printable.length]!;
  }
  let text = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    text += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return text;
}

/**
 * `crypto.ts` must never be able to reach the real network, and neither
 * should this test file's own tool calls — every one of them is wired to
 * `createStubBackend`, never to `globalThis.fetch`. A throwing spy turns
 * "this test never touches the real deployment" from an assumption into
 * something that fails loudly the moment it stops being true, matching the
 * convention already established in `test/crypto.test.ts`.
 */
let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("this test must never call the real fetch — every network call goes through a stub");
  });
});
afterEach(() => {
  fetchSpy?.mockRestore();
});

async function connectedClient(backend: StubBackend, defaultOrigin = ORIGIN) {
  const server = createMcpServer({ fetchImpl: backend.fetchImpl, defaultOrigin });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Narrows `callTool`'s result union to the ordinary (non task-based) shape
 * this server always returns — it registers no task tools. */
function asToolResult(result: Awaited<ReturnType<Client["callTool"]>>) {
  if (!("content" in result)) throw new Error("expected an ordinary tool result, got a task result");
  return result as {
    content: { type: string; text?: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
}

function textOf(result: ReturnType<typeof asToolResult>): string {
  return result.content.map((c) => c.text ?? "").join("\n");
}

describe("registered tool descriptions", () => {
  it("share's description tells the model how to build the URL and that the secret is unrecoverable", async () => {
    const client = await connectedClient(createStubBackend(ORIGIN));
    const { tools } = await client.listTools();
    const share = tools.find((t) => t.name === "share");
    expect(share).toBeDefined();
    const description = share!.description ?? "";

    expect(description).toContain(GENERATE_SECRET_COMMAND);
    expect(description).toContain("<origin>/d/<id>:<secret>");
    expect(description.toLowerCase()).toMatch(/not recoverable|unrecoverable/);
    expect(description).toMatch(/anyone with that link can read the document/i);
    expect(description).toMatch(/anyone with only the id cannot/i);
  });

  it("read's description never promises a 64-hex secret, and never tells the model to generate one", async () => {
    // B1 (round 2): read's registered description used to say "the secret is
    // the same 64-character hex string the link was created with" — true of
    // what share mints, false of what a real browser Share-button link
    // carries (10 mixed-case characters). A model handed a real link would
    // read that sentence, see the secret doesn't match, and decline to call
    // the tool at all — the exact failure this test now guards against.
    const client = await connectedClient(createStubBackend(ORIGIN));
    const { tools } = await client.listTools();
    const read = tools.find((t) => t.name === "read");
    expect(read).toBeDefined();
    const description = read!.description ?? "";

    expect(description.length).toBeGreaterThan(20);
    // Never the minting-side instruction — read's caller does not choose,
    // let alone generate, the secret. The correct description of read's
    // actual policy never needs to say "64" or "hex" at all (it accepts any
    // length/alphabet the link format allows), so requiring their total
    // absence is a direct, low-false-positive guard against the exact
    // regression this test exists for — confirmed by reverting this fix
    // locally and watching this assertion fail on the original wording.
    expect(description).not.toContain(GENERATE_SECRET_COMMAND);
    expect(description.toLowerCase()).not.toContain("64");
    expect(description.toLowerCase()).not.toContain("hex");
    // States what read actually accepts: the secret from the link, in
    // whatever shape it has.
    expect(description.toLowerCase()).toMatch(/mixed-case/);
    expect(description.toLowerCase()).toMatch(/not recoverable/);
  });

  it("read's description names the full secret alphabet, hyphen and underscore included", async () => {
    // Approval-round finding, the same failure shape as B1r in miniature:
    // this description used to say the Share-button secret was "10
    // mixed-case letters and digits" — true of only 72.9% of real
    // generateSecret() outputs. generateSecret()'s actual alphabet
    // (src/crypto.ts's SECRET_ALPHABET) also draws from `-` and `_`, which
    // land in about 27% of real 10-character secrets (62 of 64 alphabet
    // characters are letters/digits, so P(a 10-char secret has none of the
    // other 2) = (62/64)^10 ≈ 72.8% — matching the empirical figure). A
    // model told "letters and digits" and handed a real secret containing
    // `-`/`_` could reasonably treat it as mistyped and decline or "correct"
    // it — on roughly a quarter of every link this tool will ever be asked
    // to open. Pinned so the character class cannot silently drop out of
    // the description again the way it did here.
    const client = await connectedClient(createStubBackend(ORIGIN));
    const { tools } = await client.listTools();
    const read = tools.find((t) => t.name === "read");
    const description = (read!.description ?? "").toLowerCase();

    expect(description).toMatch(/hyphen/);
    expect(description).toMatch(/underscore/);
    // The mixed-case claim is still true and still worth stating — this is
    // additive, not a replacement.
    expect(description).toMatch(/mixed-case/);
  });
});

describe("share", () => {
  it("one document seals as kind 'document', version byte 2, and the url opens it", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);

    const result = asToolResult(
      await client.callTool({
        name: "share",
        arguments: { documents: [{ label: "a.json", text: '{"data":[]}' }], secret: SECRET_A },
      }),
    );

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent?.kind).toBe("document");
    expect(result.structuredContent?.url).toBe(`${ORIGIN}/d/${result.structuredContent?.id}:${SECRET_A}`);

    const uploaded = backend.calls.find((c) => c.init?.method === "POST")!.init!.body!;
    expect(uploaded[0]).toBe(2);
  });

  it("several documents seal as kind 'bundle', version byte 3", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);

    const result = asToolResult(
      await client.callTool({
        name: "share",
        arguments: {
          documents: [
            { label: "a.json", text: "{}" },
            { label: "b.json", text: "[]" },
            { label: "c.json", text: '"x"' },
          ],
          secret: SECRET_A,
        },
      }),
    );

    expect(result.structuredContent?.kind).toBe("bundle");
    const uploaded = backend.calls.find((c) => c.init?.method === "POST")!.init!.body!;
    expect(uploaded[0]).toBe(3);
  });

  it("defaults lifetime to 1d and honours an explicit one", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);
    await client.callTool({
      name: "share",
      arguments: { documents: [{ label: "a.json", text: "{}" }], secret: SECRET_A },
    });
    expect(backend.calls[0]!.url).toContain("lifetime=1d");

    await client.callTool({
      name: "share",
      arguments: { documents: [{ label: "a.json", text: "{}" }], secret: SECRET_A, lifetime: "15m" },
    });
    expect(backend.calls[1]!.url).toContain("lifetime=15m");
  });

  it("refuses an empty documents array before any network call", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);
    const result = asToolResult(
      await client.callTool({ name: "share", arguments: { documents: [], secret: SECRET_A } }),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/at least one document/i);
    expect(backend.calls).toHaveLength(0);
  });

  it("refuses a document with empty text before any network call", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);
    const result = asToolResult(
      await client.callTool({
        name: "share",
        arguments: { documents: [{ label: "empty.json", text: "" }], secret: SECRET_A },
      }),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("empty.json");
    expect(backend.calls).toHaveLength(0);
  });

  for (const badSecret of ["short", "g".repeat(64), SECRET_A.toUpperCase(), "a".repeat(65)]) {
    it(`refuses an unusable secret (${JSON.stringify(badSecret).slice(0, 20)}…) naming the openssl command, before any network call`, async () => {
      const backend = createStubBackend(ORIGIN);
      const client = await connectedClient(backend);
      const result = asToolResult(
        await client.callTool({
          name: "share",
          arguments: { documents: [{ label: "a.json", text: "{}" }], secret: badSecret },
        }),
      );
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain(GENERATE_SECRET_COMMAND);
      expect(backend.calls).toHaveLength(0);
    });
  }

  it("refuses a lifetime outside the table, listing every accepted value, before any network call", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);
    const result = asToolResult(
      await client.callTool({
        name: "share",
        arguments: { documents: [{ label: "a.json", text: "{}" }], secret: SECRET_A, lifetime: "2d" },
      }),
    );
    expect(result.isError).toBe(true);
    const text = textOf(result);
    for (const key of LIFETIME_KEYS) expect(text).toContain(key);
    expect(backend.calls).toHaveLength(0);
  });

  it("refuses an origin carrying a path, before any network call", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);
    const result = asToolResult(
      await client.callTool({
        name: "share",
        arguments: {
          documents: [{ label: "a.json", text: "{}" }],
          secret: SECRET_A,
          origin: `${ORIGIN}/api/shares`,
        },
      }),
    );
    expect(result.isError).toBe(true);
    expect(backend.calls).toHaveLength(0);
  });

  it("refuses a single document whose ciphertext exceeds the cap, naming it, before upload", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);
    const huge = pseudoRandomText(18 * 1024 * 1024);

    const result = asToolResult(
      await client.callTool({
        name: "share",
        arguments: { documents: [{ label: "huge.json", text: huge }], secret: SECRET_A },
      }),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("huge.json");
    expect(backend.calls).toHaveLength(0);
  }, 20_000);

  it("refuses an oversized bundle, naming the largest documents (sealBundle's own message), before upload", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);
    const huge = pseudoRandomText(18 * 1024 * 1024);

    const result = asToolResult(
      await client.callTool({
        name: "share",
        arguments: {
          documents: [
            { label: "huge-one.json", text: huge },
            { label: "small.json", text: "{}" },
          ],
          secret: SECRET_A,
        },
      }),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("huge-one.json");
    expect(backend.calls).toHaveLength(0);
  }, 20_000);

  it("surfaces the server's own error text and status verbatim on a failed upload", async () => {
    const backend: StubBackend = {
      fetchImpl: async (url) => ({
        url,
        ok: false,
        status: 502,
        json: async () => ({ error: "Could not store the document: R2 is unavailable" }),
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
      calls: [],
      shareCount: () => 0,
      expire: () => {},
    };
    const client = await connectedClient(backend);
    const result = asToolResult(
      await client.callTool({
        name: "share",
        arguments: { documents: [{ label: "a.json", text: "{}" }], secret: SECRET_A },
      }),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("502");
    expect(textOf(result)).toContain("R2 is unavailable");
  });
});

describe("read", () => {
  it("round-trips a single document byte-for-byte, including an exchange", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);

    const text = '{"data":{"type":"articles","id":"1"}}';
    const shared = asToolResult(
      await client.callTool({
        name: "share",
        arguments: {
          documents: [{ label: "a.json", text, exchange: { method: "GET", url: "https://api.example.com/x" } }],
          secret: SECRET_A,
        },
      }),
    );
    const id = shared.structuredContent!.id as number;

    const read = asToolResult(await client.callTool({ name: "read", arguments: { id, secret: SECRET_A } }));
    expect(read.isError).not.toBe(true);
    expect(read.structuredContent).toMatchObject({
      kind: "document",
      label: "a.json",
      text,
      exchange: { method: "GET", url: "https://api.example.com/x" },
    });
  });

  it("round-trips a bundle with every document, never just the first", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);

    const shared = asToolResult(
      await client.callTool({
        name: "share",
        arguments: {
          documents: [
            { label: "a.json", text: "1" },
            { label: "b.json", text: "2" },
            { label: "c.json", text: "3" },
          ],
          secret: SECRET_A,
        },
      }),
    );
    const id = shared.structuredContent!.id as number;

    const read = asToolResult(await client.callTool({ name: "read", arguments: { id, secret: SECRET_A } }));
    expect(read.structuredContent?.kind).toBe("bundle");
    const documents = read.structuredContent?.documents as { label: string; text: string }[];
    expect(documents).toHaveLength(3);
    expect(documents.map((d) => d.label)).toEqual(["a.json", "b.json", "c.json"]);
    expect(documents.map((d) => d.text)).toEqual(["1", "2", "3"]);
  });

  it("reports an unknown id as gone or never existed", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);
    const result = asToolResult(
      await client.callTool({ name: "read", arguments: { id: 999999, secret: SECRET_A } }),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/gone or never existed/i);
  });

  it("reports an expired id as expired", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);
    const shared = asToolResult(
      await client.callTool({
        name: "share",
        arguments: { documents: [{ label: "a.json", text: "{}" }], secret: SECRET_A, lifetime: "15m" },
      }),
    );
    backend.expire(shared.structuredContent!.id as number);

    const result = asToolResult(
      await client.callTool({ name: "read", arguments: { id: shared.structuredContent!.id, secret: SECRET_A } }),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/expired/i);
  });

  it("a wrong secret and a corrupt blob fail identically — no oracle", async () => {
    // Side A: share normally, then read it back with the WRONG secret.
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);
    const shared = asToolResult(
      await client.callTool({
        name: "share",
        arguments: { documents: [{ label: "a.json", text: "{}" }], secret: SECRET_A },
      }),
    );
    const id = shared.structuredContent!.id as number;
    const wrongSecretResult = asToolResult(
      await client.callTool({ name: "read", arguments: { id, secret: SECRET_B } }),
    );

    // Side B: the same blob, one byte flipped, read back with the ORIGINAL
    // (correct) secret. AES-GCM is authenticated, so "wrong key" and
    // "tampered ciphertext" must be indistinguishable failures.
    const rawBlob = new Uint8Array(await (await backend.fetchImpl(`${ORIGIN}/api/shares/${id}`)).arrayBuffer());
    const tamperedBlob = rawBlob.slice() as Uint8Array<ArrayBuffer>;
    tamperedBlob[tamperedBlob.length - 1] = (tamperedBlob[tamperedBlob.length - 1]! + 1) % 256;

    const tamperedBackend = createStubBackend(ORIGIN);
    await tamperedBackend.fetchImpl(`${ORIGIN}/api/shares?lifetime=1d`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: tamperedBlob,
    });
    const tamperedClient = await connectedClient(tamperedBackend);
    const tamperedResult = asToolResult(
      await tamperedClient.callTool({ name: "read", arguments: { id: 1, secret: SECRET_A } }),
    );

    expect(wrongSecretResult.isError).toBe(true);
    expect(tamperedResult.isError).toBe(true);
    expect(textOf(wrongSecretResult)).toBe(textOf(tamperedResult));
  });

  it("a version this build does not know fails readably, naming both version numbers", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);

    const shared = asToolResult(
      await client.callTool({
        name: "share",
        arguments: { documents: [{ label: "a.json", text: "{}" }], secret: SECRET_A },
      }),
    );
    const id = shared.structuredContent!.id as number;

    const rawUrl = `${ORIGIN}/api/shares/${id}`;
    const blob = new Uint8Array(await (await backend.fetchImpl(rawUrl)).arrayBuffer());
    blob[0] = 99; // neither version 2 nor 3

    const oddBackend = createStubBackend(ORIGIN);
    await oddBackend.fetchImpl(`${ORIGIN}/api/shares?lifetime=1d`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: blob as Uint8Array<ArrayBuffer>,
    });
    const oddClient = await connectedClient(oddBackend);
    const result = asToolResult(await oddClient.callTool({ name: "read", arguments: { id: 1, secret: SECRET_A } }));

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("99");
    expect(textOf(result)).toMatch(/version/i);
  });

  // Deliberately NOT the same list `share` refuses: `read` accepts anything
  // the wire format can produce (8-64 of [A-Za-z0-9_-]), so a share-only
  // restriction like uppercase hex or a non-hex letter is not invalid here —
  // that is the whole fix for B1. What is still invalid for `read` is
  // outside the *format's* own range: too short, too long, or a character
  // the format never allows at all.
  for (const badSecret of ["short", "a".repeat(65), "", "has a space in it!!"]) {
    it(`refuses a malformed secret (${JSON.stringify(badSecret).slice(0, 20)}…) before any network call, without suggesting openssl`, async () => {
      const backend = createStubBackend(ORIGIN);
      const client = await connectedClient(backend);
      const result = asToolResult(
        await client.callTool({ name: "read", arguments: { id: 1, secret: badSecret } }),
      );
      expect(result.isError).toBe(true);
      const text = textOf(result);
      expect(text.toLowerCase()).toMatch(/malformed|truncated/);
      // The bug this guards against: read's old refusal told the reader to
      // run `openssl rand -hex 32`, which makes no sense on a path where the
      // caller does not get to choose the secret.
      expect(text).not.toContain(GENERATE_SECRET_COMMAND);
      expect(text.toLowerCase()).not.toContain("generate");
      expect(backend.calls).toHaveLength(0);
    });
  }

  it("opens a link sealed with a real generateSecret() output — this is B1: read must open what the browser actually mints", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);

    // generateSecret() is the browser's own secret generator (src/crypto.ts):
    // 10 mixed-case base64url characters, nothing like share's 64-hex. Sealed
    // directly with the bare seal() — this is the shape a real Share button
    // click produces, not something the `share` tool here would ever mint
    // (its own policy is stricter on purpose; see mcp/validate.ts).
    const browserSecret = generateSecret();
    const payload: SharePayload = { text: "hello from a browser-minted link", label: "browser.json", savedAt: 1 };
    const blob = await seal(payload, browserSecret);
    await backend.fetchImpl(`${ORIGIN}/api/shares?lifetime=1d`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: blob,
    });

    const result = asToolResult(
      await client.callTool({ name: "read", arguments: { id: 1, secret: browserSecret } }),
    );
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ kind: "document", text: "hello from a browser-minted link" });
  });

  // N1r: nothing exercised readInputShape's `id: z.number().int().positive()`
  // — removing it entirely left the whole suite green, because every other
  // test already passes a real integer id.
  it("refuses a non-integer id locally, before any network call", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);
    const result = asToolResult(
      await client.callTool({ name: "read", arguments: { id: 1.5, secret: SECRET_A } }),
    );
    expect(result.isError).toBe(true);
    expect(backend.calls).toHaveLength(0);
  });

  it("refuses a non-positive id locally, before any network call", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);
    const result = asToolResult(
      await client.callTool({ name: "read", arguments: { id: -1, secret: SECRET_A } }),
    );
    expect(result.isError).toBe(true);
    expect(backend.calls).toHaveLength(0);
  });
});

describe("secrets never appear in a log, error, or any result field other than url", () => {
  it("across a full share + read cycle, including a failure path", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const shared = asToolResult(
        await client.callTool({
          name: "share",
          arguments: { documents: [{ label: "a.json", text: "{}" }], secret: SECRET_A },
        }),
      );
      const id = shared.structuredContent!.id as number;

      // A failure path too — a wrong secret must not leak either secret.
      await client.callTool({ name: "read", arguments: { id, secret: SECRET_B } });
      await client.callTool({ name: "read", arguments: { id, secret: SECRET_A } });

      // S2r: the single-document case above never touches the sealBundle
      // branch of the share handler at all — a leak planted only there
      // (e.g. `console.log("bundle secret=" + secret)` inside the `else`
      // branch in build-server.ts) would leave this test green with only
      // the calls above. A second share call, with two documents, closes
      // that gap; the assertions below already cover whatever it writes.
      const bundleShared = asToolResult(
        await client.callTool({
          name: "share",
          arguments: {
            documents: [
              { label: "bundle-a.json", text: "1" },
              { label: "bundle-b.json", text: "2" },
            ],
            secret: SECRET_BUNDLE,
          },
        }),
      );
      const bundleId = bundleShared.structuredContent!.id as number;
      await client.callTool({ name: "read", arguments: { id: bundleId, secret: SECRET_BUNDLE } });

      const everyLoggedArg = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...infoSpy.mock.calls, ...warnSpy.mock.calls]
        .flat()
        .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
        .join("\n");

      expect(everyLoggedArg).not.toContain(SECRET_A);
      expect(everyLoggedArg).not.toContain(SECRET_B);
      expect(everyLoggedArg).not.toContain(SECRET_BUNDLE);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("share's own result carries the secret only inside url, nowhere else", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);
    const result = asToolResult(
      await client.callTool({
        name: "share",
        arguments: { documents: [{ label: "a.json", text: "{}" }], secret: SECRET_A },
      }),
    );
    const structured = { ...result.structuredContent } as Record<string, unknown>;
    delete structured["url"];
    expect(JSON.stringify(structured)).not.toContain(SECRET_A);
    expect(JSON.stringify(result.content)).not.toContain(SECRET_A);
  });
});

// A round trip that only proves `open` can read what `seal` wrote, using the
// exact bytes this server produced, guards the wiring in `build-server.ts`
// itself (payload shape, field names) independently of `crypto.ts`'s own
// exhaustive seal/open suite in `test/crypto.test.ts`.
describe("what this server uploads is what src/crypto.ts's own open() expects", () => {
  it("a document minted by share opens with the bare crypto.ts open()", async () => {
    const backend = createStubBackend(ORIGIN);
    const client = await connectedClient(backend);
    await client.callTool({
      name: "share",
      arguments: { documents: [{ label: "a.json", text: "hello" }], secret: SECRET_A },
    });
    const blob = new Uint8Array(await (await backend.fetchImpl(`${ORIGIN}/api/shares/1`)).arrayBuffer());
    const payload = await open(blob as Uint8Array<ArrayBuffer>, SECRET_A);
    expect(payload).toMatchObject({ label: "a.json", text: "hello" });
  });
});
