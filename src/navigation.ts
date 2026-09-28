/**
 * The parts of path handling that need a browser.
 *
 * `router.ts` answers "what does this path mean", and deliberately touches no
 * globals: `worker.ts` imports it so the server and the client can never
 * disagree about which paths this app has, and the Worker runs on workerd,
 * where `location` and `history` do not exist. Everything that reads or writes
 * the address bar lives here instead, where only the browser build sees it.
 */

import { parseRoute } from "./router.js";
import type { Route } from "./router.js";

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
