/**
 * The whole serialised payload, not a parsed field (QA6 blind QA 2, N1 and N2).
 *
 * Three leaks in a row had one shape: the model holds a datum several ways and a
 * credential survived in the representation redaction did not touch (a JWT used
 * as a parameter *name* stayed in `form.entries[].raw[].key` while the parsed
 * value was masked, and every DOM check passed). So these tests type each repro
 * into the REAL request form and assert on `JSON.stringify` of what Copy,
 * Download and the share send — keys, derived structures and all.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { typeIntoForm, resetModalRoot } from "./helpers/type-into-form.js";
import { redactForExport, canonicalExchange } from "../src/secrets.js";
import type { Exchange } from "../src/exchange.js";
import { inspectExchangeForShare } from "../src/share.js";

beforeEach(resetModalRoot);

const FORM = "application/x-www-form-urlencoded";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.qafakesigAAAA1111";
const AWS = ["AK", "IA", "IOSFODNN7EXAMPLE"].join("");

interface Probe {
  name: string;
  typed: Parameters<typeof typeIntoForm>[0];
  fakes: string[];
  /** Not a clean form, so the body is left as typed and the dialog warns instead (the fail-closed rule). */
  warnsInstead?: boolean;
}

const probes: Probe[] = [
  // N1: a credential, or a credential-bearing segment, used as a NAME
  { name: "password=x&<jwt>", typed: { contentType: FORM, body: `password=x&${JWT}` }, fakes: [JWT, "qafakesig"] },
  { name: "a lone jwt body", typed: { contentType: FORM, body: JWT }, fakes: [JWT] },
  { name: "a=1&<jwt>", typed: { contentType: FORM, body: `a=1&${JWT}` }, fakes: [JWT] },
  { name: "a=1&<jwt> with an empty content type (a bare name needs the form type, so this is not a clean form)", typed: { contentType: "", body: `a=1&${JWT}` }, fakes: [JWT], warnsInstead: true },
  { name: "url ?<jwt>", typed: { url: `https://api.example.com/x?${JWT}` }, fakes: [JWT] },
  { name: "url ?a=1&<jwt>", typed: { url: `https://api.example.com/x?a=1&${JWT}` }, fakes: [JWT] },
  { name: "Referer ?token.K", typed: { headers: [["Referer", "https://r.example.com/p?token.qa-fake-k10-nr"]] }, fakes: ["qa-fake-k10-nr"] },
  { name: "token.K", typed: { contentType: FORM, body: "a=1&token.qa-fake-k1-nr" }, fakes: ["qa-fake-k1-nr"] },
  { name: "password.K", typed: { contentType: FORM, body: "a=1&password.qa-fake-k2-nr" }, fakes: ["qa-fake-k2-nr"] },
  { name: "auth[K]", typed: { contentType: FORM, body: "a=1&auth[qa-fake-k3-nr]" }, fakes: ["qa-fake-k3-nr"] },
  { name: "session.K.x", typed: { contentType: FORM, body: "a=1&session.qa-fake-k4-nr.x" }, fakes: ["qa-fake-k4-nr"] },
  { name: "user.K.password=y", typed: { contentType: FORM, body: "a=1&user.qa-fake-k5-nr.password=qa-fake-y5" }, fakes: ["qa-fake-k5-nr", "qa-fake-y5"] },
  { name: "user[K][password]=y", typed: { contentType: FORM, body: "a=1&user[qa-fake-k6-nr][password]=qa-fake-y6" }, fakes: ["qa-fake-k6-nr", "qa-fake-y6"] },
  { name: "url ?token.K", typed: { url: "https://api.example.com/x?token.qa-fake-k7-nr" }, fakes: ["qa-fake-k7-nr"] },
  { name: "url ?a=1&password.K=1", typed: { url: "https://api.example.com/x?a=1&password.qa-fake-k8-nr=1" }, fakes: ["qa-fake-k8-nr"] },
  { name: "url ?user[K][pass]=y", typed: { url: "https://api.example.com/x?user[qa-fake-k9-nr][pass]=qa-fake-y9" }, fakes: ["qa-fake-k9-nr", "qa-fake-y9"] },
  // N2: shapes the detector now knows
  { name: "userinfo URL as a value", typed: { contentType: FORM, body: "u=https://admin:qa-fake-SECRETu@h.example.com/" }, fakes: ["qa-fake-SECRETu"] },
  { name: "redirect= userinfo URL", typed: { contentType: FORM, body: "redirect=https://admin:qa-fake-SECRETr@h.example.com/" }, fakes: ["qa-fake-SECRETr"] },
  { name: "h=Bearer+SECRET", typed: { contentType: FORM, body: "h=Bearer+qa-fake-SECRETb" }, fakes: ["qa-fake-SECRETb"] },
  { name: "h=AKIA…", typed: { contentType: FORM, body: `h=${AWS}` }, fakes: [AWS] },
  { name: "AKIA… in a header value and a query value", typed: { headers: [["X-Note", `id ${AWS}`]], url: `https://a.example.com/x?m=${AWS}` }, fakes: [AWS] },
  { name: "Bearer in a free header", typed: { headers: [["X-Forwarded", "Bearer qa-fake-SECRETh"]] }, fakes: ["qa-fake-SECRETh"] },
];

describe("N1/N2: the whole serialised payload carries none of the fakes, typed into the real form", () => {
  for (const probe of probes) {
    it(probe.name, () => {
      const exchange = typeIntoForm(probe.typed);
      const result = redactForExport(exchange);
      const whole = JSON.stringify(result.exchange);
      if (probe.warnsInstead) {
        expect(result.bodyMayContainSecret, probe.name).toBe(true);
        return;
      }
      for (const fake of probe.fakes) expect(whole, `${probe.name}: ${fake}`).not.toContain(fake);
      // never silent: a masked value is counted
      expect(result.count, probe.name).toBeGreaterThanOrEqual(1);
      // and the dialog agrees
      expect(inspectExchangeForShare([{ label: "a", text: "{}", exchange }]).redacting).toBe(result.count);
    });
  }
});

describe("the export is canonical: no derived structure leaves the browser", () => {
  it("carries url, headers, cookies, body {contentType, raw} and the response status — and no query, form, or entries[].raw", () => {
    const exchange = typeIntoForm({
      url: "https://api.example.com/x?a=1&b=2",
      headers: [["Accept", "application/json"]],
      cookies: [["s", "qa-fake-cookie"]],
      contentType: FORM,
      body: "a=1&password=qa-fake-pw",
    });
    const out = redactForExport(exchange).exchange;
    expect(Object.keys(out.request!).sort()).toEqual(["body", "cookies", "headers", "method", "url"]);
    expect(Object.keys(out.request!.body!).sort()).toEqual(["contentType", "raw"]);
    const whole = JSON.stringify(out);
    expect(whole).not.toContain('"form"');
    expect(whole).not.toContain('"query"');
    expect(whole).not.toContain('"conventions"');
    expect(canonicalExchange(exchange).request?.url).toBe("https://api.example.com/x?a=1&b=2");
  });
});

describe("property-style: a corpus of fakes placed in every field of a typed request", () => {
  const corpus = {
    userinfo: "qa-fake-prop-userinfo",
    queryValue: "qa-fake-prop-qv-0123456789abcdef",
    fragment: "qa-fake-prop-frag-0123456789abcdef",
    headerAuth: "qa-fake-prop-auth",
    cookie: "qa-fake-prop-cookie",
    formValue: "qa-fake-prop-fv",
    nameSegment: "qa-fake-prop-name",
    jwtName: JWT,
    aws: AWS,
    bearerPlus: "qa-fake-prop-bearer",
  };
  const typed = () => ({
    url: `https://admin:${corpus.userinfo}@api.example.com/v2/x?api_key=${corpus.queryValue}&token.${corpus.nameSegment}&${corpus.jwtName}#access_token=${corpus.fragment}`,
    headers: [
      ["Authorization", `Bearer ${corpus.headerAuth}`],
      ["Origin", `https://u:${corpus.userinfo}@o.example.com`],
      ["Referer", `https://r.example.com/p?access_token=${corpus.queryValue}`],
      ["X-Free", `Bearer ${corpus.bearerPlus}`],
    ] as Array<[string, string]>,
    cookies: [["session", corpus.cookie]] as Array<[string, string]>,
    contentType: FORM,
    body: `password=${corpus.formValue}&user[${corpus.nameSegment}][password]=y&${corpus.jwtName}&k=${corpus.aws}&h=Bearer+${corpus.bearerPlus}`,
  });

  it("the whole serialised export contains none of them", () => {
    const exchange = typeIntoForm(typed());
    const whole = JSON.stringify(redactForExport(exchange).exchange);
    for (const [field, fake] of Object.entries(corpus)) expect(whole, field).not.toContain(fake);
  });

  it("holds for a response built the same way, and for Copy's input (the same function)", () => {
    const base = typeIntoForm(typed());
    const exchange: Exchange = { ...base, response: { status: 200, headers: base.request!.headers, body: base.request!.body } };
    const whole = JSON.stringify(redactForExport(exchange).exchange);
    for (const [field, fake] of Object.entries(corpus)) expect(whole, field).not.toContain(fake);
  });
});
