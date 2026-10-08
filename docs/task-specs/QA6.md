# Task specification — QA6: sharing and secrets, from the 2026-10-07 production gap pass

> The contract the implementer builds to, the reviewer checks against, and QA verifies from.
> Source: `docs/qa-reports/wave-gaps-prod.md` (findings 2 and addendum gap 9, plus the README/Share
> gap and the `not a url` observation). The repository owner said "fix all" on 2026-10-08. **This
> spec was written by the implementer** (none existed). Four items; none depends on another.

## Decisions this task records

Three of the items were open owner decisions. They are resolved toward the safer behaviour, and
that is a decision, not an accident of implementation:

1. **The document's own Share carries the attached request, redacted** (not "keep omitting it
   silently", not "omit it and say so"). Why: the request is most of what a recipient needs to
   understand a payload, the library path already carries it, and two Share buttons that disagree
   about what they send is a worse state than either choice. It is only acceptable *because* the
   redaction is one code path (`mintShareEnvelope`) and the count is stated before the link exists.
2. **A masked value is not in the DOM until revealed** (not "hidden by CSS"). Why: a node hidden
   with `display:none` is still readable by any extension or injected script, and the codebase's own
   rule (PROCESS §6) is that values are resolved on demand, not copied into the DOM.
3. **A saved document's library copy follows its request** (not "a save is a snapshot"). Why: the
   alternative makes Library → Share silently disagree with what is on screen, which is how the QA
   pass met it.

## Outcome

1. Overview/header **Create an encrypted share link** seals the open document *with* its attached
   request, through the same redaction path Library → Share uses, and says "N values in the attached
   request look like credentials and will be removed before this link is created." before the link
   exists. A received link shows the exchange band with `[REDACTED]` where credentials were.
2. In the exchange band a masked header/cookie value is a mask only. The real text is placed in the
   DOM when the user reveals it and removed when they hide it.
3. Attaching, editing or removing the request on an open document that is saved in the library
   updates that library entry as well.
4. A scheme-less request URL that cannot be a host is no longer linked under an assumed `https://`;
   it gets the existing "This does not parse as a URL. Kept as text." note.

## Interface

**1.** `main.ts#shareDocument` passes `current.exchange` to `openShareModal(text, label, exchange)`
(signature already exists). No new redaction code: `share.ts#countRedactions` and
`bundle.ts#mintShareEnvelope` are the only places that count and mask, for both Share entry points.
The shared dialog additionally states, only when it is true, that an attached body "may contain
credentials and is shared as it is" (new `share.bodyNotRedacted`), because bodies other than
form-urlencoded are detected but not rewritten (`secrets.ts` header). `share.ts` exposes
`inspectExchangeForShare(entries)` returning `{ redacting, bodyUnredacted }`.

**2.** `render-request.ts`: a masked value renders `.xmask[data-x-reveal="false"]` containing
`.xmask__dots` and a `<button class="xmask__toggle" data-x-action="reveal">`, plus a
`data-x-secret="<side>.<kind>.<index>"` locator (`req|res`, `header|cookie`, position in the
entries array). No `.xmask__value` element exists and no attribute carries the value. New exports:
`secretRef(side, kind, index)`, `resolveSecret(exchange, ref)` (pure) and
`toggleMaskedValue(button, exchange)` (DOM). `main.ts#toggleReveal` calls it with `current.exchange`.
An unmasked value (an ordinary header) still renders its text directly — it is not a secret.
The button's accessible name is `request.review.revealLabel` when hidden and the new
`request.review.hideLabel` when revealed (visible text `reveal` / new `hide`); the button is a real
`<button>`, so Enter and Space work.

**3.** `store.ts`: new `setExchangeInLibrary(id, exchange | null): Promise<boolean>` (read and `put` in
**one** `readwrite` transaction). **`DB_VERSION` and the object stores are unchanged.** `main.ts`: `Loaded` gains
`libraryId?: number`, set when the document is saved (`saveCurrent`) or opened from the library;
`persistCurrentExchange` also calls `setExchangeInLibrary`. `StoredDocument` (the current-document
record) gains an optional `libraryId`, so the link survives a reload; a record without it is valid.
A document follows into the library **only when it was saved or opened as that entry**
(`libraryId`). There is **no** "same text" fallback: an opened share link, a fresh paste, a sample or a
file can have text identical to a saved entry without being it, and writing its (possibly redacted)
request over the saved one destroys the saved request (review B1).

**4.** `render-request.ts#parseRequestUrl`: before assuming `https://`, the text must pass
`canBeHost`.

**5. (review B2)** `secrets.ts#redactUrl` also masks the credential in a URL's `user[:password]@`
prefix: with a password the **password** is masked and the user name kept (a name identifies the
account and is not the secret); with no colon the whole userinfo is masked (it is the token). One
count. `mailto:` addresses, an `@` in a path or query, and `host:port` are not userinfo.

## Behaviour

**"Can be a host", precisely.** Take the *authority*: the text up to the first `/`, `?` or `#`,
without any `user[:pass]@` prefix. It can be a host when all of:
- it is not empty and contains no whitespace or control character;
- either an IPv6 literal `[hex:.]+` (square brackets, hex digits, colons, dots) optionally followed
  by `:<digits>` (a port may be empty), or a hostname followed by optionally `:<digits>`;
- a hostname is one or more dot-separated labels of Unicode letters, digits, `-` or `_`, with at
  most one trailing dot, and no empty label (`a..b`, a leading dot).
Everything else ("not a url", `:8080/x`, `user@`, `a b.com`, `%20.com`) is unparseable. The URL
parser's own verdict still applies afterwards (a port above 65535 still fails). Existing behaviour
kept: a leading `/` is a path (unparseable); a claimed-but-invalid scheme (`ht!tp://`, F5) is
unparseable; IPv6 with or without a port (#23) is accepted.
**One existing behaviour changes, deliberately:** `host:8080` (a colon followed only by digits, then
the end or `/ ? #`) used to be read by the URL parser as the *scheme* `host:` — origin `null`, shown
as `null`, nothing to link — and a test pinned that as "not something this fix changes". It is now
a host and a port, and gets the assumed `https://`. A colon followed by anything else (`host:notaport`,
`a.b:80:80`) stays a given scheme, as before: not linked, no scheme assumed. Cost: `tel:555` would now
be read as host `tel`, port 555 (`https://tel:555/`); `tel:5551234` has a port above 65535 and stays text.
This tool reviews HTTP requests. A single-label host (`localhost`,
`intranet`) is accepted — hosts without a dot are real.

**1, redaction coverage.** Everything `redactExchange` covers is masked on every share path:
request/response header and cookie values, the URL and `query` parameters, a form-urlencoded body
(including its `raw` text), and `origin`. Non-form bodies are not rewritten; that is disclosed in the
dialog, not hidden (see Out of scope).

**3, link.** The library write happens in the same step as the existing
`persistCurrentExchange` (fire-and-forget; a failure changes nothing on screen, as with the current
document's own save). It stores the **unredacted** exchange, exactly as `saveCurrent` always has —
the library is local storage, and redaction applies on the way out (Copy, Download, Share).

## Error and edge cases

| Case | Expected |
|---|---|
| Share a document with no request | Dialog unchanged: no redaction line, no body line; sealed bytes as before |
| Share a request with no credentials | No redaction line (a "0" would read as a clean bill of health) |
| Share with 1 / 2 credentials | The exact count, singular and plural, in all three languages |
| Credential in header, cookie, URL query, form body, `origin` | Absent from the sealed payload; `[REDACTED]` after opening |
| JSON body containing a credential-shaped value | Not rewritten; dialog says so before the link exists |
| Reveal, hide, reveal again | Text appears, disappears, appears; at no point more than one copy in the DOM |
| Reveal one of two masked values | Only that one's text is in the DOM |
| Value is `<img src=x onerror=…>` | Appears as text on reveal, never as markup |
| Band re-rendered (mode switch, edit) while revealed | Back to masked; no stale text |
| Request edited so the revealed row no longer exists | Nothing resolves; nothing is shown |
| Attach request on a saved doc, then reload and open it from Library | Entry carries the request |
| Remove the request on a saved doc | Entry's `exchange` field is removed |
| Two library entries with the same text, doc opened from one | Only that entry changes |
| Document with identical text to a saved entry, but not that entry (an opened share link, a fresh paste) | The saved entry is never written: not on edit, not on remove |
| Reload, then edit the request of a saved document | The entry still follows (`libraryId` was stored) |
| `https://admin:PASS@host/`, `https://TOKEN@host/`, `admin:PASS@host/x` | Password (or token) masked, user name kept, counted once; absent from the sealed payload |
| Doc never saved | No library write |
| Library entry deleted while its doc is open, then request edited | No error, no resurrected entry |
| `api.example.com/v2/x`, `localhost:8080`, `intranet`, `[::1]:8080/x`, `münchen.de/x`, `a.b./x` | Link under assumed `https://`, with the assumed-scheme note |
| `not a url`, `a b.com`, `:8080/x`, `user@`, `host:notaport`, `a..b`, `.example.com` | "This does not parse as a URL. Kept as text." and no link |
| `ht!tp://x`, `/just/a/path`, empty | Unchanged: unparseable / `noUrl` |

## Out of scope

- Credentials the detector cannot recognise: a custom-named header with a short value
  (`X-Session: s3cr3t`), a token in a URL **path** segment, and the inside of a non-form body (JSON, text). The detector is deliberately coarse (24
  base64-alphabet characters anywhere flags a body), so dropping flagged bodies from shares would
  drop most response bodies. Raised for the owner in the PR body.
- The decoded JWT claims panel under a masked `Authorization` header: it shows `sub`/`iss`/`scope`/
  `exp`, never the token, and is a deliberate feature.
- Request query parameters and body values in the review (they are not masked cells today).
- IndexedDB schema, `crypto.ts`, the Worker, the README (QA5 owns it).

## Acceptance criteria

- [ ] The document's Share dialog shows the redaction count for an attached request; a decrypted
      share made from it contains `[REDACTED]` and none of the fake secrets.
- [ ] Library → Share and the document's Share both reach `mintShareEnvelope`; there is one
      redaction implementation.
- [ ] With a request attached, `document.body.textContent`, its serialised markup and every attribute value
      contain none of the masked values until revealed, and none again after hiding.
- [ ] A saved document's library entry gains, changes and loses its `exchange` with the open
      document; `DB_VERSION` is still 3.
- [ ] Every URL in the table above behaves as stated.
- [ ] New strings exist in `en`, `de`, `uk`.

## Tests that must exist

- [ ] `test/render-request.test.ts`: masked value absent from DOM, reveal, hide, hostile value,
      two values, accessible names; `parseRequestUrl` boundary table incl. F5 and #23 cases.
- [ ] `test/share-redaction-notice.test.ts`: dialog count for the document path; body notice.
- [ ] `test/bundle.test.ts` (or a new file): decrypt a sealed single share and assert no secret in
      any serialisation of the payload; same for a bundle.
- [ ] `test/store.test.ts`: `setExchangeInLibrary` set/clear/missing id, schema version.
- [ ] Browser scenario: the DOM contains no masked value in a real page (`test/browser`).
