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
  | { kind: "share"; id: number; secret: string }
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

export function currentRoute(): Route {
  return parseRoute(location.pathname, location.hash);
}

/**
 * Build the canonical share URL.
 *
 * The key goes after `#`. A fragment is the one part of a URL that browsers
 * do not transmit: it is stripped before the request line is built and never
 * appears in `Referer`, so the key reaches neither this site's origin nor any
 * proxy, CDN or access log in between. The document is end-to-end encrypted
 * either way; the fragment is what keeps the other end of it out of a log
 * file. Changing this back to a path segment would quietly undo that, and
 * make two sentences in `/privacy` false.
 */
export function shareUrl(id: number, secret: string): string {
  return `${location.origin}/d/${id}#${secret}`;
}

interface NavigateOptions {
  replace?: boolean;
  /** Keep the current fragment. Defaults to dropping it. */
  keepHash?: boolean;
}

/**
 * Change the path without reloading.
 *
 * `pushState` for a real navigation the user should be able to go Back from,
 * `replaceState` when the current entry is being corrected — notably after a
 * share link loads, where the secret must not be left in history.
 */
export function navigate(path: string, options: NavigateOptions = {}): void {
  const target = path + (options.keepHash ? location.hash : "");
  if (options.replace) history.replaceState(history.state, "", target);
  else history.pushState(null, "", target);
}
