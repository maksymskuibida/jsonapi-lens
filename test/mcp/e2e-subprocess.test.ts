// @vitest-environment node
/**
 * The one test in this suite that runs the actual shipped artifact —
 * `mcp/server.ts`, spawned as a real subprocess talking real stdio, exactly
 * as a user's MCP client would run it (see `mcp/README.md`) — rather than
 * `mcp/build-server.ts`'s factory wired to an in-process stub. Every other
 * test in `test/mcp/` proves the tool logic is correct; this one proves the
 * actual entry point, actual `StdioServerTransport`, and actual process
 * boundary do not leak the secret anywhere `client.callTool` hands back or
 * that the child writes to its own stderr — which is what
 * `docs/task-specs/T7.md` means by "everything written to stdout and stderr
 * during a full share + read run."
 *
 * "No test touches the real deployment" still holds: `origin` points at a
 * throwaway `node:http` server bound to `127.0.0.1` on an ephemeral port,
 * started and torn down inside this test, standing in for `src/worker.ts`'s
 * two routes. The subprocess only ever talks to that loopback server.
 */
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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

function asToolResult(result: object) {
  if (!("content" in result)) throw new Error("expected an ordinary tool result, got a task result");
  return result as {
    content: { type: string; text?: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  };
}

describe("real subprocess: mcp/server.ts over real stdio", () => {
  let stubWorker: { origin: string; server: Server };

  beforeAll(async () => {
    stubWorker = await startStubWorker();
  });

  afterAll(async () => {
    await new Promise<void>((resolveClose) => stubWorker.server.close(() => resolveClose()));
  });

  it(
    "a full share + read run never writes the secret to stdout or stderr, anywhere but the url field",
    async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [TSX_BIN, SERVER_ENTRY],
        cwd: REPO_ROOT,
        env: process.env as Record<string, string>,
        stderr: "pipe",
      });

      let stderrOutput = "";
      transport.stderr?.on("data", (chunk: Buffer) => {
        stderrOutput += chunk.toString("utf8");
      });

      const client = new Client({ name: "e2e-subprocess-test", version: "0.0.0" });
      await client.connect(transport);

      try {
        const secret = "d".repeat(64);
        const wrongSecret = "e".repeat(64);
        const text = '{"data":{"type":"e2e","id":"1"}}';

        const shareResult = asToolResult(
          await client.callTool({
            name: "share",
            arguments: {
              documents: [{ label: "e2e.json", text }],
              secret,
              origin: stubWorker.origin,
              lifetime: "15m",
            },
          }),
        );
        expect(shareResult.isError).not.toBe(true);
        const id = shareResult.structuredContent!.id as number;
        const url = shareResult.structuredContent!.url as string;
        expect(url).toBe(`${stubWorker.origin}/d/${id}:${secret}`);

        // A failure path too, deliberately, since a refusal is exactly the
        // kind of place a secret gets echoed back by accident.
        const wrongSecretResult = asToolResult(
          await client.callTool({ name: "read", arguments: { id, secret: wrongSecret, origin: stubWorker.origin } }),
        );
        expect(wrongSecretResult.isError).toBe(true);

        const readResult = asToolResult(
          await client.callTool({ name: "read", arguments: { id, secret, origin: stubWorker.origin } }),
        );
        expect(readResult.structuredContent).toMatchObject({ kind: "document", label: "e2e.json", text });

        const listToolsResult = await client.listTools();

        // Everything the JSON-RPC layer handed back to this client over the
        // subprocess's real stdout, concatenated, with the one legitimate
        // occurrence (inside `url`) removed before checking for the rest.
        const everyResponse = JSON.stringify({ shareResult, wrongSecretResult, readResult, listToolsResult });
        const withUrlRemoved = everyResponse.split(url).join("");

        expect(withUrlRemoved).not.toContain(secret);
        expect(withUrlRemoved).not.toContain(wrongSecret);
        expect(stderrOutput).not.toContain(secret);
        expect(stderrOutput).not.toContain(wrongSecret);
      } finally {
        await client.close();
      }
    },
    30_000,
  );
});
