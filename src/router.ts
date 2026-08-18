/**
 * Path handling, done by hand.
 *
 * There are five paths and they never nest, so a router library would be more
 * machinery than the problem needs:
 *
 *   /                       the paste view
 *   /view                   the document view
 *   /d/<id>:<secret>        a share link, which loads and then becomes /view
 *   /impressum              provider information (§ 5 DDG)
 *   /privacy                the privacy policy
 *
 * Anchors inside the document view are fragments on `/view`, so relationship
 * navigation stays entirely the browser's business — this module never touches
 * the hash.
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
 */
const LEGAL_PATHS: Record<string, LegalRoute> = {
  "/impressum": "impressum",
  "/imprint": "impressum",
  "/legal": "impressum",
  "/privacy": "privacy",
  "/datenschutz": "privacy",
  "/datenschutzerklaerung": "privacy",
};

/** `/d/<id>:<secret>`, tolerating a trailing slash and a `#` separator. */
const SHARE_PATTERN = /^\/d\/(\d{1,18})[:.]([A-Za-z0-9_-]{8,64})\/?$/;

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

  // Also accept `/d/<id>#<secret>`, which keeps the key out of the request the
  // browser sends. Links are not minted in this form, but honouring it means a
  // hand-edited link still works.
  const idOnly = /^\/d\/(\d{1,18})\/?$/.exec(pathname);
  if (idOnly && hash.length > 8) {
    const secret = hash.startsWith("#") ? hash.slice(1) : hash;
    if (/^[A-Za-z0-9_-]{8,64}$/.test(secret)) {
      return { kind: "share", id: Number(idOnly[1]), secret };
    }
  }

  return { kind: "unknown", pathname };
}

export function currentRoute(): Route {
  return parseRoute(location.pathname, location.hash);
}

/** Build the canonical share URL. */
export function shareUrl(id: number, secret: string): string {
  return `${location.origin}/d/${id}:${secret}`;
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
