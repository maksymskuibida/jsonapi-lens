# Fixtures

**Everything here is synthesised.** No file in this directory, or anywhere under `test/`, may
contain a real log record, a real email address, a real hostname, or any identifier traceable to a
real organisation — this repository is public, and so is its test data.

The synthetic conventions, so a new fixture is obviously synthetic at a glance:

| | |
|---|---|
| Hosts | `api.example.com`, `example.org` |
| Addresses | anything `@example.com` |
| IP literals | the RFC 5737 documentation ranges only — `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` |
| Service, host and instance names | invented, generic (`gateway`, `edge`, `example-provider`) |
| Ids | the right *shape*, invented value |

## GitHub's push protection is a third gate, and it is stricter than ours

Found the hard way during T2a: a test fixture using `sk_test_` with a plausible 24-character suffix
**was rejected by GitHub's own secret scanning on push**, twice, under different labels. Two things
follow that are worth knowing before you write a fixture:

- **It catches a class `test/hygiene.test.ts` cannot.** Ours checks addresses and IP literals only,
  by design — a denylist of provider key formats would be endless and would date. GitHub's scanner
  knows the real prefixes.
- **A rejected push is the good outcome.** The fix is to rewrite the offending commits *before*
  they reach the remote — `git reset --soft` and re-commit — not to add a follow-up "redact"
  commit, which leaves the real-looking value sitting in history forever.

So when a fixture needs a credential-shaped value, use one that is **famously** synthetic rather
than merely invented. T2a settled on `sk_test_4242424242424242`: it satisfies a shape detector while
being unmistakable to any human and to the scanner, because `4242…` is the most published test
number in payments.

**What is mechanical, and what is not.** `test/hygiene.test.ts` fails the build on exactly two
things: an email address whose domain is not one of the reserved example domains, and an IP literal
outside the RFC 5737 documentation ranges. That is all it checks.

Everything else in the table above — a host name, a service name, a flag name, an id that could be
traced to a real organisation — is **reviewer judgement, not a check**. The gate deliberately does
not hold a denylist of names, because a denylist would have to contain the very strings it exists
to keep out of a public repository. So do not read a green build as "this fixture is safe to
publish"; read it as "the two mechanical rules pass".

## `transport-log-started.json` · `transport-log-finished.json`

A pair of JSON transport-log records for the T3 importer: an `info` member in the shape of a
serialised Python `logging` record, with HTTP transport fields written alongside it, and a sibling
`context` member of ambient request metadata with no fixed schema.

The two records describe **one** outbound call and pair on `context.correlation_id` together with
`info.url` and `info.http_method`. `started` carries the request; `finished` carries the status,
the response headers, the elapsed time and the response body — which here is a JSON:API document,
because that is the case the importer exists for.

## `share-v2-compat.json`

Not synthesised in the usual sense — it is the literal output of `src/crypto.ts`'s `seal()`, from
before T5's bundle/exchange work touched that file, run against the synthetic payload and secret
recorded inside the fixture itself. Exists so `test/crypto.test.ts` can prove the current `open()`
still decrypts a share link sealed by the exact code that shipped in commit
`12d01fc4d790c4f10252cc1034d722113cdf891b`, named in the fixture's own comment — a blob sealed by
today's code would only prove today's code agrees with itself. The `secret` field is not a real
share secret; it exists only to open this one fixture and was never used against production.
