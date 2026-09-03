// @vitest-environment node
/**
 * The one test in this suite that runs the actual shipped artifact —
 * `mcp/server.ts`, spawned as a real subprocess talking real stdio, exactly
 * as a user's MCP client would run it (see `mcp/README.md`) — rather than
 * `mcp/build-server.ts`'s factory wired to an in-process stub.
 *
 * `docs/task-specs/T7.md` requires "a test that greps everything written to
 * stdout and stderr during a full share + read run". An earlier version of
 * this file used the SDK's own `Client`/`StdioClientTransport` for that,
 * which is not the same thing: the client only ever sees the JSON-RPC
 * messages it successfully *parsed*, and `StdioClientTransport` exposes no
 * handle onto the child's raw stdout at all (only `stderr`, via its own
 * `get stderr()`). A `console.log(secret)` planted in the `share` handler
 * turned the in-process spy-based test red but left that version of this
 * file green — confirmed by spawning the mutated server directly and
 * grepping the real pipes: the secret was in raw stdout, and the test that
 * claimed to check stdout never looked at it.
 *
 * So this file speaks the wire protocol by hand instead: MCP over stdio is
 * one JSON-RPC message per line (`ReadBuffer`/`serializeMessage` in the
 * SDK's own `shared/stdio.ts` — no framing beyond the newline), which is a
 * simple, stable format worth writing three or four request objects for, in
 * exchange for an actual handle on the child's real `stdout`/`stderr`
 * buffers. This is not a second implementation of MCP in the sense this
 * project worries about for crypto — nothing here seals or opens anything,
 * it only drives a documented, minimal wire format for one test — and the
 * production server and every other test still go through the real SDK.
 *
 * "No test touches the real deployment" still holds: `origin` points at a
 * throwaway `node:http` server bound to `127.0.0.1` on an ephemeral port,
 * started and torn down inside this test, standing in for `src/worker.ts`'s
 * two routes. The subprocess only ever talks to that loopback server.
 */
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const TSX_BIN = resolve(REPO_ROOT, "node_modules/.bin/tsx");
const SERVER_ENTRY = resolve(REPO_ROOT, "mcp/server.ts");

/** A minimal stand-in for `POST /api/shares` and `GET /api/shares/<id>`,
 * real enough for one round trip: it actually stores and serves back the
 * bytes it is given, over a real loopback TCP connection. */
function startStubWorker(): Promise<{ origin: string; server: Server }> {
  const shares = new Map<number, Buffer>();
  let nextId = 1;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "POST" && url.pathname === "/api/shares") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const id = nextId++;
        shares.set(id, Buffer.concat(chunks));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id, expiresAt: Date.now() + 900_000, lifetime: "15m" }));
      });
      return;
    }

    const match = /^\/api\/shares\/(\d+)$/.exec(url.pathname);
    if (req.method === "GET" && match) {
      const blob = shares.get(Number(match[1]));
      if (!blob) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(blob);
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found." }));
  });

  return new Promise((resolveStart) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("expected startStubWorker to bind a TCP port");
      }
      resolveStart({ origin: `http://127.0.0.1:${address.port}`, server });
    });
  });
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: {
    content?: { type: string; text?: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
    [key: string]: unknown;
  };
  error?: { code: number; message: string };
}

/**
 * Hand-rolled MCP client: newline-delimited JSON-RPC over a real child
 * process's real stdio, with the raw bytes captured as they arrive — the one
 * thing the SDK's own transport does not expose.
 */
class RawMcpSession {
  readonly child: ChildProcessWithoutNullStreams;
  stdoutRaw = "";
  stderrRaw = "";
  private lineBuffer = "";
  private nextId = 1;
  private pending = new Map<number, { resolve: (msg: JsonRpcResponse) => void; reject: (err: Error) => void }>();

  constructor(env: NodeJS.ProcessEnv) {
    this.child = spawn(process.execPath, [TSX_BIN, SERVER_ENTRY], {
      cwd: REPO_ROOT,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.stdoutRaw += text;
      this.lineBuffer += text;
      let newlineIndex: number;
      while ((newlineIndex = this.lineBuffer.indexOf("\n")) !== -1) {
        const line = this.lineBuffer.slice(0, newlineIndex);
        this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);
        this.handleLine(line);
      }
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderrRaw += chunk.toString("utf8");
    });
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let message: JsonRpcResponse;
    try {
      message = JSON.parse(line) as JsonRpcResponse;
    } catch {
      return; // not a JSON-RPC line (should not happen; nothing to correlate)
    }
    if (typeof message.id !== "number") return; // a notification, not a response
    const waiter = this.pending.get(message.id);
    if (!waiter) return;
    this.pending.delete(message.id);
    waiter.resolve(message);
  }

  private write(message: Record<string, unknown>): void {
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  private request(method: string, params?: unknown, timeoutMs = 15_000): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`timed out waiting for a response to "${method}"`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolvePromise(msg);
        },
        reject: (err) => {
          clearTimeout(timer);
          rejectPromise(err);
        },
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  /** The MCP lifecycle: an `initialize` request, then an `initialized`
   * notification, before any other request is meaningful. */
  async initialize(): Promise<void> {
    const response = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "raw-stdout-test", version: "0.0.0" },
    });
    if (response.error) throw new Error(`initialize failed: ${JSON.stringify(response.error)}`);
    this.notify("notifications/initialized");
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<NonNullable<JsonRpcResponse["result"]>> {
    const response = await this.request("tools/call", { name, arguments: args });
    if (response.error) throw new Error(`tools/call "${name}" failed: ${JSON.stringify(response.error)}`);
    if (!response.result) throw new Error(`tools/call "${name}" returned no result`);
    return response.result;
  }

  /** Sends SIGTERM and resolves once the child's stdio streams have actually
   * closed — i.e. every byte it ever wrote has already reached
   * `stdoutRaw`/`stderrRaw`. Asserting before this event, or right after
   * sending the signal, would race a leak written at the very end. */
  shutdownAndWaitForClose(): Promise<void> {
    return new Promise((resolveClose) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        resolveClose();
        return;
      }
      this.child.once("close", () => resolveClose());
      this.child.kill("SIGTERM");
    });
  }
}

describe("real subprocess, raw stdio: everything written to stdout and stderr", () => {
  let stubWorker: { origin: string; server: Server };

  beforeAll(async () => {
    stubWorker = await startStubWorker();
  });

  afterAll(async () => {
    await new Promise<void>((resolveClose) => stubWorker.server.close(() => resolveClose()));
  });

  it(
    "a full share + read run never writes the secret to raw stdout or raw stderr, anywhere but the url field",
    async () => {
      const session = new RawMcpSession({ ...process.env });
      await session.initialize();

      const secret = "d".repeat(64);
      const wrongSecret = "e".repeat(64);
      const text = '{"data":{"type":"e2e","id":"1"}}';

      const shareResult = await session.callTool("share", {
        documents: [{ label: "e2e.json", text }],
        secret,
        origin: stubWorker.origin,
        lifetime: "15m",
      });
      expect(shareResult.isError).not.toBe(true);
      const structured = shareResult.structuredContent!;
      const id = structured["id"] as number;
      const url = structured["url"] as string;
      expect(url).toBe(`${stubWorker.origin}/d/${id}:${secret}`);

      // A failure path too, deliberately, since a refusal is exactly the
      // kind of place a secret gets echoed back by accident.
      const wrongSecretResult = await session.callTool("read", { id, secret: wrongSecret, origin: stubWorker.origin });
      expect(wrongSecretResult.isError).toBe(true);

      const readResult = await session.callTool("read", { id, secret, origin: stubWorker.origin });
      expect(readResult.structuredContent).toMatchObject({ kind: "document", label: "e2e.json", text });

      // S2r: everything above is the single-document path — sealBundle's
      // own branch of the share handler is never reached, so a leak planted
      // only there would pass this whole test. One more share call, with
      // two documents, under its own secret, closes that gap.
      const bundleSecret = "f".repeat(64);
      const bundleShareResult = await session.callTool("share", {
        documents: [
          { label: "bundle-a.json", text: "1" },
          { label: "bundle-b.json", text: "2" },
        ],
        secret: bundleSecret,
        origin: stubWorker.origin,
        lifetime: "15m",
      });
      expect(bundleShareResult.isError).not.toBe(true);
      const bundleStructured = bundleShareResult.structuredContent!;
      const bundleId = bundleStructured["id"] as number;
      const bundleUrl = bundleStructured["url"] as string;
      await session.callTool("read", { id: bundleId, secret: bundleSecret, origin: stubWorker.origin });

      // Shut down and wait for the child's stdio to actually close before
      // reading the captured buffers — see shutdownAndWaitForClose's own
      // comment for why this ordering is load-bearing.
      await session.shutdownAndWaitForClose();

      // Positive control: an empty (or trivially short) capture must not be
      // able to pass the `not.toContain` assertions below by accident.
      expect(session.stderrRaw).toContain("ready on stdio");
      expect(session.stdoutRaw.length).toBeGreaterThan(100);

      const stdoutWithUrlsRemoved = session.stdoutRaw.split(url).join("").split(bundleUrl).join("");
      expect(stdoutWithUrlsRemoved).not.toContain(secret);
      expect(stdoutWithUrlsRemoved).not.toContain(wrongSecret);
      expect(stdoutWithUrlsRemoved).not.toContain(bundleSecret);
      expect(session.stderrRaw).not.toContain(secret);
      expect(session.stderrRaw).not.toContain(wrongSecret);
      expect(session.stderrRaw).not.toContain(bundleSecret);
    },
    30_000,
  );
});
