/**
 * Path handling, done by hand.
 *
 * There are three paths and they never nest, so a router library would be more
 * machinery than the problem needs:
 *
 *   /                       the paste view
 *   /view                   the document view
 *   /d/<id>:<secret>        a share link, which loads and then becomes /view
 *
 * Anchors inside the document view are fragments on `/view`, so relationship
 * navigation stays entirely the browser's business — this module never touches
 * the hash.
 */

export type Route =
  | { kind: "paste" }
  | { kind: "view" }
  | { kind: "share"; id: number; secret: string }
  | { kind: "unknown"; pathname: string };

export const PASTE_PATH = "/";
export const VIEW_PATH = "/view";

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
