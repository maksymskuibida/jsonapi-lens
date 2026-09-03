# jsonapi-lens

A single-page JSON:API document viewer. Paste a payload and every relationship becomes a link you
can click. `README.md` explains the architecture at length — read its *How it works* section before
changing anything about rendering, anchors or persistence.

## The flow

Work ships through the delivery loop in [docs/PROCESS.md](docs/PROCESS.md). In short:

```
task in docs/STATUS.md → task spec → implementer (PR) → CI → reviewer → qa-web → squash-merge → PRODUCTION
```

| | |
|---|---|
| What ships how | [docs/PROCESS.md](docs/PROCESS.md) |
| Commands, branches, labels, environments | [docs/DELIVERY.md](docs/DELIVERY.md) |
| What is on `main`, and what is queued | [docs/STATUS.md](docs/STATUS.md) |
| Decisions later work must respect | [docs/DECISIONS.md](docs/DECISIONS.md) |

**A squash-merge to `main` deploys to `https://jsonapi.mstool.dev`.** There is no pre-production
environment. Say plainly in every pull request what was *not* verified.

**Most of these gates are agent discipline, not platform enforcement.** `main` is not
branch-protected, and every role acts through one `gh` token, so `reviewed:approved` is a label
rather than an approval. [docs/PROCESS.md §8](docs/PROCESS.md) is the single source of truth on what
is actually enforced — nothing in this repository may contradict that table.

## Verify before you open anything

```bash
npx wrangler types && npx tsc --noEmit && npx tsc -p tsconfig.worker.json --noEmit && npx tsc -p mcp/tsconfig.json --noEmit && npm test && npx vite build && scripts/attack-preflight.sh
```

`npx wrangler types` first is not optional — `worker-configuration.d.ts` is generated rather than
committed, and the Worker typecheck fails without it for reasons unrelated to your change.

**`npm test` runs under jsdom, which has no layout engine.** A green suite says nothing about
`content-visibility`, scroll restoration, or anything measured in pixels. Those live in
`node test/browser/run.mjs`, which needs a visible, non-occluded tab of a non-minimised window —
`test/browser/README.md` says why a backgrounded tab makes every scenario pass vacuously.

## Four things this codebase loses if nobody is watching

The full list with its reasoning is [docs/PROCESS.md §6](docs/PROCESS.md); these are the ones that
fail silently.

1. **Every interpolation on an `innerHTML` path goes through `escapeHtml`.** Type names, ids,
   attribute keys and values, `meta`, error strings, and now URLs and header values are all
   untrusted payload data. A URL rendered as an `href` needs a **scheme allowlist** as well —
   `javascript:` and `data:` survive HTML escaping intact.
2. **Element ids must be unique**, and are only ever minted by `src/ident.ts`. A duplicate id does
   not throw; the browser resolves every anchor to the first match. See
   [DECISIONS.md D1](docs/DECISIONS.md).
3. **No hardcoded user-facing copy.** `src/i18n/en.ts` is the schema and `de.ts`/`uk.ts` must match
   it — there are no fallbacks, ever. And call `t()` at render time, never at module scope, or the
   string freezes in whichever language was active when the module first loaded.
4. **Nothing outside `store.ts`, `share.ts` and `crypto.ts` opens a client network connection.**
   Reading a document is local; that is the product's central promise, not an implementation
   detail. `worker.ts` is the server — its `env.ASSETS.fetch` is how assets get served.
