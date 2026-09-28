/**
 * Path handling, done by hand.
 *
 * There are five paths and they never nest, so a router library would be more
 * machinery than the problem needs:
 *
 *   /                       the paste view
 *   /view                   the document view
 *   /d/<id>#<secret>        a share link, which loads and then becomes /view
 *   /impressum              provider information (§ 5 DDG)
 *   /privacy                the privacy policy
 *
 * The share key is a **fragment**, not a path segment, and that is a security
 * property rather than a formatting choice: a browser never puts the part
 * after `#` on the wire, so the key is absent from the request line, from
 * `Referer`, and therefore from every access log between here and the origin.
 * `/d/<id>:<secret>` — the form this app minted until the key moved — is still
 * parsed, because links already sent to people have to keep working, but
 * nothing mints it any more. See `shareUrl`, and DECISIONS.md D7.
 *
 * Anchors inside the document view are fragments on `/view`, so relationship
 * navigation stays entirely the browser's business — this module reads the
 * hash only on `/d/<id>`, and never writes one.
 *
 * Nothing here reads a global. `worker.ts` imports `parseRoute` so that the
 * server's answer to "is this a page?" is the same function the client uses —
 * a second copy of these rules on the server would eventually 404 a valid
 * share link — and workerd has no `location` or `history`. The helpers that do
 * need them live in `navigation.ts`.
 *
 * The two legal paths are real paths rather than a modal because they have to
 * be linkable and quotable on their own. `/impressum` keeps the German word in
 * every language: it is the term § 5 DDG case law is built around and the one a
 * German visitor scans a footer for. `/privacy` has no such constraint — no law
 * dictates what a privacy policy link is called — so it matches the rest of the
 * English-language UI, and `/datenschutz` is accepted as an alias for anyone
 * who types or is sent the German word.
 */

export type Route =
  | { kind: "paste" }
  | { kind: "view" }
  /**
   * `keyExposed` is set only when the key reached here inside the
   * *pathname*, rather than the fragment where `shareUrl` puts it — see the
   * `%23` branch in `parseRoute` below and DECISIONS.md D7. It means the key
   * has already been sent to a server once (this one, in the request line
   * that produced this very route), so the caller should say so rather than
   * pretend the link was opened the ordinary way.
   */
  | { kind: "share"; id: number; secret: string; keyExposed?: true }
  /**
   * Shaped like a share link, but without a usable key — a truncated paste, a
   * fragment a chat client ate, a link retyped by hand. It is a share link
   * that is broken, not a page that does not exist, and saying so is the
   * whole point of the route: the visitor's next question is "was the link
   * cut short?", and "no page here" sends them away from it.
   */
  | { kind: "share-damaged" }
  | { kind: "legal"; page: LegalRoute }
  | { kind: "unknown"; pathname: string };

/** Which of the two legal pages a `legal` route names. */
export type LegalRoute = "impressum" | "privacy";

export const PASTE_PATH = "/";
export const VIEW_PATH = "/view";
export const IMPRESSUM_PATH = "/impressum";
export const PRIVACY_PATH = "/privacy";

/**
 * Alternative spellings that resolve to the same page.
 *
 * `/datenschutz` is what a German speaker types, and `/legal` and `/imprint`
 * are what an English speaker guesses. Cheap to honour, and the alternative is
 * a "no page here" toast on a page somebody has a legal right to reach.
 *
 * Exported because `public/_redirects` sends the aliases to the canonical path
 * with a 301, so a search engine is never offered four URLs for one page. This
 * table stays the one that decides which alias means what — the redirects are
 * checked against it by `test/seo.test.ts` — and it still resolves them itself,
 * for in-app navigation and for anyone who lands on one before the redirect.
 */
export const LEGAL_PATHS: Record<string, LegalRoute> = {
  "/impressum": "impressum",
  "/imprint": "impressum",
  "/legal": "impressum",
  "/privacy": "privacy",
  "/datenschutz": "privacy",
  "/datenschutzerklaerung": "privacy",
};

/**
 * The legacy in-path form, `/d/<id>:<secret>`, tolerating a trailing slash and
 * a `.` separator. Kept for links minted before the key moved to the fragment;
 * `shareUrl` no longer produces it.
 */
const SHARE_PATTERN = /^\/d\/(\d{1,18})[:.]([A-Za-z0-9_-]{8,64})\/?$/;

/** What a secret may look like, wherever it was carried. Mirrors `crypto.ts`. */
const SECRET_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** `/d/<id>`, the path half of a current share link. */
const SHARE_ID_PATTERN = /^\/d\/(\d{1,18})\/?$/;

export function parseRoute(rawPathname: string, hash = ""): Route {
  // Cloudflare's asset router normalises `/d/1:KEY` to `/d/1%3AKEY` with a 307,
  // so by the time this runs the colon may be percent-encoded. Decode first —
  // and tolerate a pathname that is not valid percent-encoding at all.
  let pathname = rawPathname;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    /* keep the raw pathname */
  }

  if (pathname === "/" || pathname === "") return { kind: "paste" };
  if (pathname === VIEW_PATH || pathname === VIEW_PATH + "/") return { kind: "view" };

  // Tolerate a trailing slash and any casing, because these paths get typed by
  // hand and pasted into address bars far more than the others.
  const legal = LEGAL_PATHS[pathname.replace(/\/+$/, "").toLowerCase() || "/"];
  if (legal) return { kind: "legal", page: legal };

  const match = SHARE_PATTERN.exec(pathname);
  if (match) return { kind: "share", id: Number(match[1]), secret: match[2]! };

  // `/d/<id>#<secret>` — what every link minted since the key left the path
  // looks like, and the reason the origin never receives the key.
  const idOnly = SHARE_ID_PATTERN.exec(pathname);
  if (idOnly) {
    const secret = hash.startsWith("#") ? hash.slice(1) : hash;
    if (SECRET_PATTERN.test(secret)) {
      return { kind: "share", id: Number(idOnly[1]), secret };
    }
  }

  // `/d/<id>#<key>`, found in the *pathname itself* rather than in `hash` —
  // a normal share link whose `#` was rewritten to the percent-encoded
  // `%23` by something between sender and recipient (some URL sanitisers,
  // wiki and Markdown renderers do this). The `decodeURIComponent` above has
  // already turned that `%23` back into a literal `#`, and a literal `#`
  // can reach a decoded pathname no other way: an *unencoded* `#` always
  // starts the fragment before a pathname is ever built, so nothing that
  // went through a browser or a `fetch` could hand this function a genuine
  // `#` here unless it started life percent-encoded. That means the request
  // that produced this very route already carried the key in its request
  // line — the exposure D7 exists to prevent has already happened for this
  // one link, and it cannot be undone by refusing to open the document.
  // `keyExposed` lets the caller say so. A double-encoded key (`%2523…`)
  // decodes to a literal `%23`, not a `#`, so it does not match here and
  // falls through to `share-damaged` below, same as any other malformed key.
  //
  // Review round 1 (N2): a decoded pathname that reads `/d/<id>#` followed by
  // *nothing this regex accepts as a key* (empty, too short, or trailing
  // punctuation before a real `#hash` the browser split off separately —
  // e.g. `/d/42%23#<valid>`, decoded pathname `/d/42#`, real hash `#<valid>`)
  // does not match here and falls all the way to `share-damaged` below, even
  // though a well-formed key is sitting right there in `hash`. Deliberately
  // not special-cased: a link carrying *two* `#`s, one encoded and one real,
  // is a shape nothing in this app or its README ever produces, and no
  // known link-mangling tool produces either — treating it as damaged rather
  // than guessing which of two present keys is the "real" one keeps this
  // function's one job (does the URL alone, unambiguously, name a key?)
  // honest. `test/router.test.ts` pins this exact case down.
  const exposedFragment = /^\/d\/(\d{1,18})#([A-Za-z0-9_-]{8,64})\/?$/.exec(pathname);
  if (exposedFragment) {
    return {
      kind: "share",
      id: Number(exposedFragment[1]),
      secret: exposedFragment[2]!,
      keyExposed: true,
    };
  }

  // Anything else under `/d/<digits>` was a share link once. It is damaged —
  // most often a fragment that something along the way dropped — and it is
  // reported as that rather than as a missing page. `/d/notanumber:secret`
  // deliberately does not land here: that is not a share link at all.
  //
  // No oracle: this is decided from the URL alone, without asking the server
  // whether the id exists, so a damaged link says the same thing whether or
  // not there is a document behind it.
  if (/^\/d\/\d/.test(pathname)) return { kind: "share-damaged" };

  return { kind: "unknown", pathname };
}

/**
 * What a crawler should be told about a path, or `null` for one that may be
 * indexed.
 *
 * This lived in `public/_headers` until the server stopped answering `200` for
 * paths that are not pages. `_headers` matches the *asset* being served, and
 * `/view` and `/d/<id>:<secret>` are not assets — they have no file of their
 * own, so the Worker builds their response from `index.html` and the rules
 * keyed on those paths never matched. It is one table either way; this is the
 * one the server actually reads. `seo.ts` says the same thing in the `<head>`,
 * for a reader that runs the page instead of stopping at the headers.
 *
 * A share link is `noarchive` as well: the URL carries the decryption key, so a
 * cached copy of the page is a copy of the key.
 */
export function robotsTagForRoute(route: Route): string | null {
  switch (route.kind) {
    // A share link reaches the server as `/d/<id>` with no key — the key is
    // in the fragment, which browsers never send — so the server parses every
    // valid link as `share-damaged`. The two kinds are one URL shape here.
    case "share":
    case "share-damaged":
      return "noindex, nofollow, noarchive";
    case "view":
      return "noindex";
    // Not a page. It renders the paste view with a "no page here" notice, which
    // is not something to index under a URL that does not exist.
    case "unknown":
      return "noindex";
    case "paste":
    case "legal":
      return null;
  }
}

/**
 * The `Referrer-Policy` a route's page response must carry in place of the
 * site-wide one, or `null` to leave the site-wide policy
 * (`strict-origin-when-cross-origin`, `public/_headers`) alone (QA4, 2026-09-28).
 *
 * Why share routes are the exception: a legacy `/d/<id>:<key>` link, or one
 * whose `#` was rewritten to `%23`, has its key in the *path*. The page the
 * server sends back then asks for its own module script, stylesheet, icons
 * and manifest before a line of app code has run — and app code is what
 * strips the key from the address bar (`main.ts#loadSharedDocument`), so
 * nothing can beat those requests to it. Under the site-wide policy each of
 * them carries the full path, key included, in `Referer`. `no-referrer`
 * sent in the page's own response header is the only lever that applies at
 * that moment. It covers the ordinary `#` link too, harmlessly: the fragment
 * never reaches a `Referer` under any policy.
 *
 * `share-damaged` is the same URL shape as `share` from the server's side
 * (see `robotsTagForRoute`), so the two are one case here as well.
 *
 * The Worker *replaces* the inherited header with this value (`Headers.set`);
 * two `Referrer-Policy` headers would be combined by browsers into "last
 * valid one wins", which is an accident to avoid rather than to rely on.
 */
export function referrerPolicyForRoute(route: Route): "no-referrer" | null {
  switch (route.kind) {
    case "share":
    case "share-damaged":
      return "no-referrer";
    case "paste":
    case "view":
    case "legal":
    case "unknown":
      return null;
  }
}

/**
 * The HTTP status the Worker serves the single page under, for a path.
 *
 * Only `unknown` is a 404. `share-damaged` is deliberately not: it is how the
 * *server* sees every valid share link, because the key travels in the
 * fragment and never reaches it. Answering 404 there would make every share
 * link look dead to anything that checks the status first — a link unfurler,
 * a chat preview, `curl -f` — while the browser opened it fine.
 */
export function statusForRoute(route: Route): 200 | 404 {
  return route.kind === "unknown" ? 404 : 200;
}

/**
 * The HTTP status the Worker serves the single page under, for a path AND a
 * method (N2, 2026-09-28).
 *
 * Only ever called for a request that already reached `worker.ts`'s page
 * path — `/api/*` has its own method handling and never calls this. Every
 * path with a real asset (`/`, `/impressum`, every file) never reaches here
 * either: the asset router answers a non-GET/HEAD request for those with its
 * own `405` before the Worker script runs at all, which is what makes
 * `unknown` (below) the interesting case rather than the common one.
 *
 * `unknown` stays `404` under every method, not `405`: a path that is not a
 * page does not become "a page that merely disagrees with this verb" by
 * trying a different one on it — there is nothing there to disagree with the
 * method about, under any method. Every other route kind names a page that
 * *does* exist, so GET and HEAD get `statusForRoute`'s ordinary answer and
 * anything else is `405`, because the page exists but does not answer that
 * method.
 */
export function methodStatusForRoute(route: Route, method: string): 200 | 404 | 405 {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD") return statusForRoute(route);
  return route.kind === "unknown" ? 404 : 405;
}
