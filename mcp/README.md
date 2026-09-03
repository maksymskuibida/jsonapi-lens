# jsonapi-lens MCP server

A stdio [MCP](https://modelcontextprotocol.io) server with two tools, `share` and `read`, so an
assistant can put a document — or several — behind a [jsonapi-lens](https://jsonapi.mstool.dev)
share link, and read one back, without a browser.

It is a separate program from the site. It imports the site's own [`src/crypto.ts`](../src/crypto.ts)
so that a link minted here opens in a browser and a link minted in a browser opens here — see
*One crypto implementation* below — but it shares no runtime with the Worker or the static app, and
it is the only part of this repository that a user runs directly and that is expected to open a
network connection on its own (see `docs/PROCESS.md` §5).

## What it can and cannot see

- It generates nothing. **You supply the secret** when minting a link with `share`, as 64 lowercase
  hex characters from `openssl rand -hex 32`. The server never invents one, and never falls back to
  generating one if yours is malformed — a caller that believes it knows the secret and does not has
  minted a link nobody can open, including you. `read`, opening a link somebody else already made,
  is deliberately less strict: it accepts any secret the envelope format itself can carry — the same
  range this app's `generateSecret()` produces, 8-64 characters — because most links it opens will
  not have come from this server's own `share` at all. See the *tools* section below.
- It cannot decrypt without that secret. Sealing and opening both happen with the same
  `src/crypto.ts` this site's browser build uses: AES-256-GCM over a key derived from your secret
  with PBKDF2. The secret never leaves this process except inside the `url` field a successful
  `share` call returns.
- It talks to exactly one HTTP surface: `POST /api/shares` and `GET /api/shares/<id>` on whichever
  `origin` you pass (default `https://jsonapi.mstool.dev`) — the same public API the browser app
  uses, with the same 12 MB ciphertext cap. There is no separate or privileged endpoint for this
  server; it is just another client.
- It cannot read, write or index anything on your machine. Text goes in through the tool call and
  comes back out through the tool result — no file access, no browser storage, no parsing of the
  document's contents.

## Minimum Node version

**Node 22 or newer.** `seal`/`open` in `src/crypto.ts` need `crypto.subtle` (WebCrypto) and
`CompressionStream`/`DecompressionStream`, both of which Node has shipped since v17-18, but 22 is
what this project's CI runs and the version this server checks for. On anything older, it prints a
readable message naming the problem and exits, rather than failing several calls deep with a
`TypeError` about an undefined property.

## Running it

There is no build step — `mcp/server.ts` runs as TypeScript directly, via
[`tsx`](https://github.com/privatenumber/tsx), which is also how this repository already generates
its `crypto.ts` compatibility fixtures. From the repository root:

```bash
npm run mcp
```

## Registering it with an MCP client

Point your client at `tsx` and this file, from the repository root. For a client that reads JSON
configuration (Claude Desktop's `claude_desktop_config.json`, for example):

```json
{
  "mcpServers": {
    "jsonapi-lens": {
      "command": "node_modules/.bin/tsx",
      "args": ["mcp/server.ts"],
      "cwd": "/absolute/path/to/jsonapi-lens"
    }
  }
}
```

Use an absolute path for `cwd` — most clients spawn the server with a working directory you do not
control otherwise.

## The tools

Both tool descriptions are registered on the server itself and are what a calling model actually
reads; this is a summary, not the source of truth for that wording.

### `share`

Takes one or more `{ label, text, exchange? }` documents and a secret, seals them, and uploads the
ciphertext. One document becomes a version-2 single-document link; several become a version-3
**bundle** link that opens all of them together — the same rule the browser's own share button
follows, so the two mint byte-identical envelopes. Returns `{ id, url, expiresAt, bytes, kind }`,
where `url` is exactly `<origin>/d/<id>:<secret>` — built for you because it is the one string in
this whole flow that cannot be retried if it comes out wrong.

**Anyone who has the returned `url` can read the document. Anyone who has only the `id` cannot.**

### `read`

Takes `{ id, secret, origin? }`, fetches the ciphertext, decrypts it, and returns it as it was
sealed: `{ kind: "document", label, savedAt, text, exchange? }` for a single document, or
`{ kind: "bundle", savedAt, documents: [...] }` for a bundle — every document in it, never just the
first. No parsing, indexing or validation of the text happens here; that is what the browser is for.

**`secret` here is not held to `share`'s 64-hex rule.** Most links `read` opens will have come from
the browser's own Share button, whose secret is 10 characters of mixed-case letters, digits, hyphens
and underscores, nothing like 64 lowercase hex — so `read` accepts anything the wire format itself
can carry (case-sensitive, never normalised), and only refuses something malformed or truncated. A
`read` refusal never suggests running `openssl rand -hex 32`; there is nothing to generate on this
path, only a link to check was copied in full.

A wrong secret and a corrupted or tampered blob **fail identically**. This is deliberate — telling
them apart would hand an attacker a way to test guesses.

## One crypto implementation, never two

This server does not reimplement sealing or opening. It imports `seal`, `sealBundle`, `open` and
`isBundlePayload` from [`src/crypto.ts`](../src/crypto.ts) directly, unmodified. A second
implementation would drift from the first in some byte nobody notices until a link minted by one
side refuses to open on the other — the worst failure mode this feature has, because it is invisible
until someone else clicks the link. `test/mcp/cross-compat.test.ts` asserts both directions against
that same module, plus the committed `test/fixtures/share-v2-compat.json` fixture, specifically so
this cannot regress silently.

One consequence of sharing the module: `crypto.ts` reads its error strings through the site's
`t()`, which negotiates a language from (among other things) `navigator.language` — and Node's own
built-in `navigator` reports the *host machine's* locale, not English. `mcp/locale.ts` pins this
process to the English catalogue before anything else runs; see its header comment for the exact
mechanism and why it does not touch `src/`.

## Development

```bash
npx tsc -p mcp/tsconfig.json --noEmit   # typecheck (part of the repo's normal verify chain)
npm test                                 # includes test/mcp/**
```

`mcp/tsconfig.json` is a separate TypeScript program from the root config, for the same reason
`tsconfig.worker.json` is: this tree runs on Node, not in a browser, so it needs `@types/node` and
Node-style module resolution rather than the root program's DOM-and-bundler setup.
