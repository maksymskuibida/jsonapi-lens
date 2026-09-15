# jsonapi-lens

A single-page JSON:API document viewer. Paste a payload and every relationship becomes a link you
can click. `README.md` explains the architecture at length — read its *How it works* section before
changing anything about rendering, anchors or persistence.

## How this repo is worked

Development runs through a delivery process — task specs, an implementer/reviewer/QA loop, a review
preflight and its attack suite. **Those files are deliberately not in the repository**: they are how
the work is done, not what the product is, and they are ignored in `.gitignore`.

What *is* here, because the code depends on it:
[docs/DECISIONS.md](docs/DECISIONS.md) — decisions later work must respect. `src/ident.ts` and
`src/exchange.ts` cite D1 and D2 in their header comments, and **D1 carries the proof that no two
anchor scopes can mint the same DOM id**, which the entire navigation model rests on.

**A merge to `main` deploys to `https://jsonapi.mstool.dev`.** There is no pre-production
environment, and `main` is not branch-protected.

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
