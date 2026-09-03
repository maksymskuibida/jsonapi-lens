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
