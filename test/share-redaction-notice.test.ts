/**
 * The share dialog states how many values redaction will mask, before the link
 * exists.
 *
 * `mintShareEnvelope` has masked them since the security review of #19, but it
 * did so silently — the one silent mask left in an app whose Copy and Download
 * both report the count (`request.band.copyKindRedacted`/`redactedCount`).
 * Saying it *before* the link is created is the point: the choice not to share
 * is still available at that moment and gone afterwards.
 *
 * jsdom, because this is a real modal built with `document.createElement`. The
 * masking itself is `test/bundle.test.ts`'s job — asserted there against the
 * bytes that come back out of a sealed blob, through the real call chain.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { openShareModal } from "../src/share.js";
import { headerSet } from "../src/headers.js";
import { t } from "../src/i18n/index.js";
import type { Exchange } from "../src/exchange.js";

beforeEach(() => {
  document.body.innerHTML = '<div id="modal-root"></div><div id="toast"></div>';
});

/** An exchange carrying exactly one thing redaction masks. */
const oneSecret: Exchange = {
  request: { headers: headerSet([{ name: "Authorization", value: "Bearer s3cr3t" }]) },
};

/** Two, so the count is asserted rather than merely "non-zero". */
const twoSecrets: Exchange = {
  request: {
    headers: headerSet([{ name: "Authorization", value: "Bearer s3cr3t" }]),
    cookies: { entries: [{ name: "session", value: "s3cr3t-cookie" }] },
  },
};

const notice = () => document.querySelector(".share__note--redacting");

describe("the share dialog says what it will redact", () => {
  it("states the count for a document whose exchange carries a credential", () => {
    openShareModal("{}", "a.json", oneSecret);
    const shown = notice();
    expect(shown).not.toBeNull();
    expect(shown!.textContent).toBe(t().share.redacting(1));
  });

  it("counts every masked value, not just the first", () => {
    openShareModal("{}", "a.json", twoSecrets);
    const shown = notice();
    expect(shown).not.toBeNull();
    // The exact number, because "a notice appeared" would pass just as well
    // with a hardcoded 1 — and the plural form differs, which is the thing
    // three catalogues have to get right.
    expect(shown!.textContent).toBe(t().share.redacting(2));
    expect(shown!.textContent).not.toBe(t().share.redacting(1));
  });

  it("says nothing when there is no exchange at all", () => {
    openShareModal("{}", "a.json");
    expect(notice()).toBeNull();
  });

  it("says nothing when the exchange carries no credential", () => {
    openShareModal("{}", "a.json", {
      request: { headers: headerSet([{ name: "Accept", value: "application/json" }]) },
    });
    // Deliberately silent rather than "0 values redacted": a zero would read as
    // a clean bill of health, which this scan cannot give. `redactionCaveat`
    // in the review band is where the limits of the scan are stated.
    expect(notice()).toBeNull();
  });
});
