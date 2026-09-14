/**
 * Redaction of imported data — `docs/task-specs/T3.md`'s acceptance
 * criterion: "Redaction covers the actor email and the customer IP as well
 * as credentials, with a count, on Copy, Download and Share."
 *
 * This branch has no Copy/Download/Share UI (T2b/T6's half of the feature),
 * so "on Copy, Download and Share" is tested here at the layer every one of
 * those three is documented to call before writing an `Exchange` anywhere
 * that leaves the browser: `secrets.ts#redactExchange`. Asserting against
 * `JSON.stringify(redactExchange(exchange).exchange)` — the actual bytes a
 * serialised payload would carry — is the same check the task spec asks for,
 * one layer below the UI that does not exist yet on this branch.
 *
 * **What this file finds, honestly, and why**: as of this branch's merge
 * base (`origin/feat/T2a-exchange-model`, commit `7160cb8`), `redactExchange`
 * fully covers headers, cookies, a request URL's query string, and a
 * form-urlencoded body — T2a's own header comment in `src/secrets.ts` says so
 * precisely. It does **not** walk `Exchange.origin` at all, by that same
 * comment's silence on it. `src/secrets.ts` is T2a's file and this task's
 * brief is explicit that T3 does not touch it — this task's job is to make
 * origin-level data *reachable* by a future redactor (real nested objects,
 * never a stringified blob), not to write the redactor. See this task's PR
 * body for the open ask this leaves on `secrets.ts`.
 */
import { describe, expect, it } from "vitest";
import { redactExchange } from "../../src/secrets.js";
import { parseTransportLog } from "../../src/importers/transport-log.js";
import { parseCurl } from "../../src/importers/curl.js";
import { parseHar } from "../../src/importers/har.js";
import startedFixture from "../fixtures/transport-log-started.json?raw";
import finishedFixture from "../fixtures/transport-log-finished.json?raw";

/** The fixtures' one synthetic actor email and one synthetic customer IP — see `test/fixtures/README.md`. */
const ACTOR_EMAIL = "agent@example.com";
const CUSTOMER_IP = "192.0.2.24";

function bytesOf(exchange: unknown): string {
  // Stands in for "the Copy payload, the Download payload, the sealed share
  // blob" — all three are, ultimately, a serialisation of an `Exchange`.
  return JSON.stringify(exchange);
}

describe("redaction — what redactExchange covers today, exercised on imported data", () => {
  it("a transport-log record's api-key request header is redacted, with a count", () => {
    const result = parseTransportLog(startedFixture);
    const { exchange, count } = redactExchange(result.exchanges[0]!);
    expect(count).toBeGreaterThan(0);
    expect(bytesOf(exchange)).not.toContain("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");
  });

  it("a cURL import's Authorization header and query-string token are both redacted", () => {
    const result = parseCurl(
      "curl 'https://api.example.com/x?access_token=s3cr3t-token-value-please-hide-me' " +
        "-H 'authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'",
    );
    const { exchange, count } = redactExchange(result.exchanges[0]!);
    const serialised = bytesOf(exchange);
    expect(serialised).not.toContain("dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U");
    expect(serialised).not.toContain("s3cr3t-token-value-please-hide-me");
    // The URL itself is rewritten, not left sitting beside a scrubbed copy.
    expect(exchange.request?.url).not.toContain("s3cr3t-token-value-please-hide-me");
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("a HAR import's Set-Cookie response cookie is redacted", () => {
    const har = {
      log: {
        entries: [
          {
            request: { method: "GET", url: "https://api.example.com/x", headers: [] },
            response: {
              status: 200,
              headers: [{ name: "Set-Cookie", value: "session=deadbeefdeadbeefdeadbeefdeadbeef; Path=/" }],
              cookies: [],
            },
          },
        ],
      },
    };
    const result = parseHar(JSON.stringify(har));
    const { exchange } = redactExchange(result.exchanges[0]!);
    expect(bytesOf(exchange)).not.toContain("deadbeefdeadbeefdeadbeefdeadbeef");
  });
});

describe("redaction — the known, tracked gap: origin-level PII", () => {
  it("KNOWN GAP — an imported record's actor email and customer IP still survive redactExchange today", () => {
    const merged = parseTransportLog(JSON.stringify([JSON.parse(startedFixture), JSON.parse(finishedFixture)]));
    const exchange = merged.exchanges[0]!;

    // Reachable, structured data going in — this importer's actual job.
    const context = exchange.origin?.context as { entrypoint?: { customer_ip?: string } };
    expect(context.entrypoint?.customer_ip).toBe(CUSTOMER_IP);

    const { exchange: redacted } = redactExchange(exchange);
    const serialised = bytesOf(redacted);

    // This assertion documents current behaviour, not desired behaviour: it
    // will (happily) start failing the day `secrets.ts#redactExchange` walks
    // `origin`, at which point this whole describe block should be deleted
    // and replaced with a positive assertion that the email/IP are gone.
    expect(serialised).toContain(ACTOR_EMAIL);
    expect(serialised).toContain(CUSTOMER_IP);
  });

  it("the data shape that makes future redaction possible: context is real structured data, not a stringified blob", () => {
    const result = parseTransportLog(finishedFixture);
    const context = result.exchanges[0]!.origin?.context;
    // A future redactor can only walk what is actually structured. If this
    // were a JSON string instead of an object, no recursive scan could ever
    // reach the values inside it without this importer changing.
    expect(typeof context).toBe("object");
    expect(context).not.toBeNull();
    expect(Array.isArray(context)).toBe(false);
  });
});
