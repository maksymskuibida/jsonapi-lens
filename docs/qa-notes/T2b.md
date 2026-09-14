# QA notes — T2b The form and the review

Written for someone who **cannot read the code** and has never seen this change. If a behaviour is
not described here, it will not be tested — so an omission here ships untested.

## What changed, observably

A document pasted into this tool used to be the whole story. Now, next to the existing **Share
link** button on the overview, there is a new button — **Attach request** (or **Edit request**, once
one exists) — that opens a form: the request that produced this response (method, URL, query
parameters, headers, cookies, body) and the response's own status, headers, `Set-Cookie` entries,
elapsed time and body. Every field is optional and independently fillable.

Once something is entered and saved, a new band appears **above the overview card**, collapsed to
one line — the method, the URL, the status, and counts like `6 params · 4 headers · 1 cookie`.
Clicking it opens the full review, with a three-way switch (**Response** / **Request** / **Both**)
when both sides exist. Inside: query parameters (each naming how it was decoded — a comma list, a
bracket list, and so on), headers and cookies (secret-looking ones masked, click to reveal), and
each body rendered — a JSON:API request body gets full clickable resource sections of its own,
separate from the response's.

The band has its own **Copy**, **Download** and **Share** buttons. Copy and Download redact
anything that looks like a credential by default and say how many values they found and hid. A
small note next to the buttons always says what redaction does and does not cover — it is there
whether or not anything was found, on purpose. **Share does not yet include the attached
request/response** — sharing a document behaves exactly as it always has.

With nothing ever entered in the form, the page is unchanged: no button label changes, no band, no
switch — this is worth checking explicitly, since it is the one behaviour a screenshot of "it looks
the same" would not catch on its own if the band were rendering an empty shell.

## Where to exercise it

- **Environment:** `preview_start { name: "jsonapi-lens" }` — the dev server on port 5178.
- **Surface:** the document view (`/view`) after loading any sample or pasted payload. The form
  opens as a modal from the overview card's action row.
- **Note:** `/api/*` is not served by the dev server, so an actual **Share** link cannot be created
  locally — clicking Share still opens the existing share dialog, but do not expect a working link
  outside a real deployment. Do not test share against production with real data.

## How to exercise it

1. Load any sample (e.g. **Article feed**). Confirm the overview card shows **Attach request** —
   not **Edit request** — and there is no band above it.
2. Click **Attach request**. Fill in:
   - Method: `POST`. URL: `https://api.example.com/articles?sort=-created,name&status=open,closed`.
   - Confirm the query table below the URL fills in with two rows (`sort`, `status`) the moment you
     tab out of the URL field, or as you type.
   - Add a header row: name `Authorization`, value `Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZGEiLCJpc3MiOiJhY21lIiwic2NvcGUiOiJyZWFkIiwiZXhwIjoxNzAwMDAwMDAwfQ.abc123signature` (a
     JWT-shaped value — the header/payload segments above decode to `{"sub":"ada","iss":"acme","scope":"read","exp":1700000000}`, an already-expired timestamp).
   - Add a header row named `Cookie` with value `session=abc123; theme=dark`. Tab out of the name
     field. Confirm the row disappears from Headers and two rows (`session`, `theme`) appear under
     Cookies instead.
   - Body: paste `{"data":{"type":"articles","id":"1","attributes":{"title":"Hello"}}}`, content
     type `application/json`.
   - Response section: status `201`, status text `Created`, one header `Date` = `Wed, 21 Oct 2026
     07:28:00 GMT`.
   - Click **Save**.
3. Confirm the band now appears above the overview, collapsed, showing `POST`, the URL, `201`, and a
   counts line. Click it open.
4. Confirm the segmented control shows **Response** / **Request** / **Both**, defaulting to Both.
   Click each in turn and confirm the sections shown change accordingly, and the control itself
   disappears if you re-open the form and clear one side entirely (see step 7).
5. In the open review, under Request → Headers, confirm `Authorization` shows a row of dots with a
   "reveal" control, not the actual token. Click reveal — the real value appears. Click it again (or
   reload) and confirm it re-masks. Directly below that row, confirm a decoded-JWT panel shows `sub:
   ada`, `iss: acme`, `scope: read`, and `exp` marked expired, with a relative time worded against
   the response's own `Date` header (e.g. "before this call") rather than against right now.
6. Under Request → Body, confirm the JSON:API body rendered as a resource section — a chip reading
   `articles 1`, with `title: Hello` inside it — not raw JSON text. Under Request → Query, confirm
   `sort` shows `[created (desc), name (asc)]`-equivalent content and names the convention it read
   (comma list); confirm `status` similarly.
7. Re-open the form (**Edit request** now). Confirm every field you entered is still there. Clear
   the Method, URL, and every row in every table, and clear the body — leave the Response section
   untouched — then Save. Confirm the band now shows Response-only content and the segmented control
   is gone.
8. Click **Copy** on the band. Confirm a toast appears mentioning a redacted count greater than zero
   (the JWT and the cookie both look secret-shaped). Paste the clipboard contents somewhere and
   confirm the JWT and cookie values do **not** appear — `[REDACTED]` appears in their place instead.
9. Click **Download**. Open the downloaded file and confirm the same: no secret value present,
   `[REDACTED]` in its place, and the file is otherwise valid JSON.
10. With DevTools' Network tab open, repeat steps 8–9 and confirm neither produces any network
    request — both are local (clipboard/file), matching "nothing leaves your browser" for these two.
11. Reload the page. Confirm the band and its contents come back exactly as they were (the exchange
    is restored from IndexedDB along with the document).
12. **Save** the document to the library (the existing Save button), reload, open it from **Saved
    documents**. Confirm the exchange comes back with it.
13. Paste a document that is itself a **request body** sharing a resource with the response (e.g.
    load the Article feed sample, then attach a request whose body is
    `{"data":{"type":"articles","id":"<the first article's real id from the loaded sample>"}}`).
    Confirm both the response's own `articles` section (in the main document) and the request body's
    `articles` chip (in the review) are independently clickable, land on different sections, and
    neither "steals" the browser's `:target` highlight from the other.

## Test data needed

Any built-in sample works as the response body — **Article feed** is used above because it has
resources with real ids to reuse in step 13. The request body/header values above are inline in
these notes; nothing else needs to be pasted separately.

## What should NOT have changed

- Back and Forward return the content you were looking at to the same place on screen — try this
  with the band both open and closed: open a sample, expand a resource, follow a relationship,
  press Back, and confirm you land where you left, whether or not the band above is open.
- A row that was expanded is still expanded, and still expands when clicked, after the above.
- Nothing in the network log carries document content, except the existing, unchanged opt-in Share
  upload (which — see above — does not yet include the attached exchange either).
- Every other existing button (Save, Export, Raw, Copy, the existing Share) behaves exactly as
  before.
- Switching language (the selector in the top bar) shows every new label in that language, with no
  English text left over anywhere in the form or the review.

## Known limitations

- **Share does not yet carry the attached request/response into the encrypted link.** This is a
  deliberate, disclosed gap — see the PR body — not a defect to file. Clicking Share still works
  exactly as it did before this task.
- **Disabling a row in the form, then saving, drops that row** — the same as deleting it. "Disabled"
  only survives while the form modal is open in one sitting; the underlying data model (T2a's
  `ParamEntry`/`HeaderEntry`/`Cookie` types) has no place to remember "disabled" once saved. If this
  looks wrong when testing step 2's kind of flow (toggle a row off and on before saving, confirm the
  data is not lost *within that one session* — it is not), that is the limitation, not a new bug.
- **The URL↔query table sync, the Cookie/Set-Cookie auto-move, and the reveal click are not covered
  by automated tests** — they are pure DOM event wiring, exercised by this document's steps and
  recorded in `docs/evidence/T2b.md`, not by `npm test`. See `docs/test-plans/T2b.md`'s "What this
  task does not attempt" for the reasoning.
- A request body larger than a handful of resources has no lazy-loading/eager-body-limit treatment
  the way the main response document does — this is intentional (request bodies are expected to be
  small; see `render-request.ts`'s header) but has not been tested against a large one.
