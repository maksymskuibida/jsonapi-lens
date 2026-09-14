/**
 * The stdio entry point. See `mcp/README.md` for how to register this with an
 * MCP client and the minimum Node version.
 *
 * Two things happen here, in order, before a single tool is registered:
 *
 * 1. `./locale.js` is imported for its side effect alone — it must run before
 *    anything calls into `src/crypto.ts`'s `t()`, so it is the first line.
 *    See that module's header comment for why this exists at all.
 * 2. The runtime is checked for WebCrypto and `CompressionStream`, which
 *    `seal`/`open` need and an old Node does not have. Checked here, before
 *    `main()`, so the failure is a readable message on stderr rather than a
 *    `TypeError` several calls deep the first time a tool actually runs.
 *
 * `fetch` is the one thing wired here rather than in `build-server.ts`: this
 * is the single call site in the whole server that touches the real global
 * fetch, matching `mcp/transport.ts`'s header comment about `fetchImpl`
 * having no default. Every test builds its server with a stub instead.
 */
import "./locale.js";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer } from "./build-server.js";
import { runtimeProblem } from "./runtime.js";
import type { FetchLike } from "./transport.js";

const problem = runtimeProblem({
  nodeVersion: process.version,
  hasSubtleCrypto: typeof globalThis.crypto?.subtle !== "undefined",
  hasCompressionStream: typeof globalThis.CompressionStream !== "undefined",
});

if (problem !== null) {
  console.error(problem);
  process.exit(1);
}

const fetchImpl: FetchLike = (url, init) => fetch(url, init);

async function main(): Promise<void> {
  const server = createMcpServer({ fetchImpl });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only: stdout is the JSON-RPC channel, and nothing may write to it
  // except the transport itself.
  console.error("jsonapi-lens MCP server ready on stdio.");
}

main().catch((error: unknown) => {
  console.error(
    "jsonapi-lens MCP server failed to start:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
