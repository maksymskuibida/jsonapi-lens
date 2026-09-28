/**
 * The security headers `public/_headers` sets for every asset response.
 *
 * This is a second copy of those values, and it has to be: `_headers` is
 * read natively by the Workers asset router at request time, and nothing in
 * `worker.ts` (a separate program, built by `tsconfig.worker.json` for the
 * `workerd` runtime rather than by Vite) can import a text file the way
 * `?raw` lets the browser build and the test suite do — see `seo.test.ts`'s
 * own `headersFile` import for that path, which is unavailable here.
 *
 * `worker.ts` needs these on exactly one response it builds itself: the
 * `405` it gives a non-GET/HEAD request for a page path (N2, 2026-09-28).
 * Every other response either comes straight from `env.ASSETS.fetch` — which
 * already carries `_headers`' values — or is a `/api/*` JSON response, whose
 * own header set is `JSON_HEADERS` in `worker.ts` and out of scope here.
 *
 * `test/security-headers.test.ts` parses `public/_headers`' own text and
 * asserts this list agrees with it byte for byte, so an edit to one that
 * forgets the other fails CI rather than drifting silently.
 */
export const SECURITY_HEADERS: ReadonlyArray<readonly [name: string, value: string]> = [
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["x-content-type-options", "nosniff"],
  [
    "content-security-policy",
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  ],
  ["x-frame-options", "DENY"],
];
