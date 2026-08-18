/**
 * The provider's own details — the only place they appear.
 *
 * § 5 DDG wants a real name and a *ladungsfähige Anschrift*: an address where
 * post can actually be served. A P.O. box does not satisfy it. These values are
 * interpolated into all three languages, so they are written once here rather
 * than three times in prose that would drift apart.
 *
 * Everything language-dependent stays out: the country name is translated in
 * each catalogue, and the supervisory authority keeps its official German name
 * in every language because that is what it is called.
 *
 * ⚠️  The bracketed values below are placeholders. While any of them remain,
 *     every legal page renders a visible warning — see `hasPlaceholders`. An
 *     Impressum with a placeholder in it is worse than none, because it looks
 *     like compliance without being it.
 */

export interface Identity {
  /** Full legal name of the natural person providing the service. */
  name: string;
  /** Street and house number. */
  street: string;
  postalCode: string;
  city: string;
  /** Written out, e.g. `you@example.com`. Required by § 5 DDG. */
  email: string;
  /**
   * A second channel for fast, direct, efficient contact.
   *
   * The ECJ (C-298/07) read § 5's "fast electronic communication" as email
   * *plus* one more route that gets a real answer quickly. A phone number is
   * the usual second channel; `null` is only safe if something equivalent is
   * offered instead.
   */
  phone: string | null;
  /**
   * VAT identification number under § 27a UStG, or `null`.
   *
   * Only the USt-IdNr belongs here. A Kleinunternehmer without one omits the
   * line entirely — never substitute the Steuernummer, which is not required
   * and identifies far more than it needs to.
   */
  vatId: string | null;
  /**
   * The data protection authority of the provider's federal state, which is
   * where a complaint under Art. 77 GDPR would go.
   */
  authority: {
    name: string;
    url: string;
  };
}

export const IDENTITY: Identity = {
  name: "Maksym Skuibida",
  street: "Fleischwangerstr. 12",
  postalCode: "88370",
  city: "Ebenweiler",
  email: "info@mskuibida.com",
  phone: "+49 151 20444673",
  vatId: "DE364688059",
  authority: {
    // Baden-Württemberg, where the provider is established.
    name: "Der Landesbeauftragte für den Datenschutz und die Informationsfreiheit Baden-Württemberg",
    url: "https://www.baden-wuerttemberg.datenschutz.de/",
  },
};

/** `[like this]` — the shape every unfilled value above has. */
const PLACEHOLDER = /\[[^\]]*\]/;

/**
 * Is anything above still unfilled?
 *
 * Used to put a warning on the page itself rather than to fail a build. A build
 * that refuses to compile until the address is filled in would block every
 * unrelated change; a banner is impossible to miss and disappears on its own
 * the moment the real values land.
 */
export function hasPlaceholders(identity: Identity = IDENTITY): boolean {
  const values = [
    identity.name,
    identity.street,
    identity.postalCode,
    identity.city,
    identity.email,
    identity.phone ?? "",
    identity.vatId ?? "",
    identity.authority.name,
    identity.authority.url,
  ];
  return values.some((value) => PLACEHOLDER.test(value));
}
