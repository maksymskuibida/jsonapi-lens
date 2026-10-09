# Task specification — QA5: copy, accessibility and docs from the 2026-10-07 gap pass

> The contract the implementer builds to, the reviewer checks against, and QA verifies from.
> Contract level, not line level: say what must be true, never how to write it.

Seven independent items from `docs/qa-reports/wave-gaps-prod.md` (findings 1, 3, 4, 5, 6 and the
specification gaps 7 and 8, plus two README defects). None depends on another. This spec was
written by the implementer (none existed when the task started). QA6 runs in parallel and owns
sharing and secrets (`share.ts`, `render-request.ts`, request-URL parsing, exchange persistence);
this task does not edit those.

## Outcome

1. Every accessible name, tooltip and visible label in the controls the report named is in the
   interface language, and a test fails if one is ever a literal again.
2. The German "copied the exchange" toast is a complete sentence.
3. A JSON syntax error is described in the interface language with an exact line and column; the
   browser's English message and the first characters of the input never appear.
4. `Import selected` announces what it did.
5. Closing a dialog puts focus back where the person was.
6. The README no longer says something false about Share, and no longer links to a file that is not
   in the repository.
7. A size shown by the app says which unit it is in.

## Interface

**1. Catalogue (`en.ts` is the schema, `de.ts` and `uk.ts` match it).** New rows:
`resource.identityType|identityId|identityAt`;
`resource.actions.{raw,rawTitle,copy,copyTitle,path,pathTitle(pointer),link,linkTitle}`;
`value.emptyString`. Existing, now used for the accessible name too: `value.copyPointerTitle`,
`value.copyValueTitle`, `resource.notInDocument`, `resource.absentChipTitle`. `value.*Title` and
`resource.actions.*Title` are both the tooltip and the accessible name, one string.

**2. `request.band.copiedExchange(redacted, chars)` and `copyExchangeFailed`** replace
`copyKind`/`copyKindRedacted`. The message is the whole sentence. `clipboard.ts` gains
`copyWithMessages(text, { done, failed })`; `copyBlob` is unchanged for its other callers.

**3. `src/json-syntax.ts`** (new, pure): `locateSyntaxError(text): { problem, offset } | null` and
`lineColumnAt(text, offset): { line, column }`. `SyntaxProblem` is one of `unexpected-char {char}`,
`unexpected-end`, `trailing-comma`, `control-in-string`, `bad-escape`, `extra-content {char}`.
`DocumentError` gains an optional `column`. Catalogue: `parseErrors.invalidJson.hint(problem)`,
`parseErrors.invalidJson.hintUnlocated`, `paste.errorWhereColumn(line, column)`,
`parseErrors.wrongType.headline(kind)` where `kind` is `"null" | "boolean" | "number"` (it used to
take `typeof`'s English word and put it inside the German/Ukrainian sentence).

**4. `bundleUi.importedToast(n)`, `bundleUi.importedPartialToast(saved, total)`.** `bundle.ts` shows
them with `toast()`; the "nothing saved" case reuses `bundleUi.importFailed`.

**5. `ui.ts#openModal`** owns focus restoration. No dialog implements it separately.

**6. `README.md`.** **7. `format.ts#formatBytes`** prints `B`, `KiB`, `MiB`.

## Behaviour

**1. Names.** Per-value row buttons, per-resource buttons (`raw`, `copy`, `path`, `link`), the
resource identity strip (`type`, `id`, `at`), the "not in document" chip text and tooltip and the
"empty string" scalar come from the catalogue at render time. `aria-label` equals `title` for these
buttons. A repository test scans `src/` (excluding `src/i18n/` and `src/legal/`) and fails on a
string literal in `aria-label`/`title`/`placeholder`/`alt`/`text:`/`textContent`/`toast(`/an error
constructor/the copy arguments of a button helper. Any helper whose name looks like a button
(`\w*Button`, `btn`) that the scan has not been told about fails it. It also reads the whole value
expression (`x ?? "…"`, ternaries), computed keys, string children of `el()`/`append()`, and words
between tags in markup. Not caught, and said so in the test's header: a literal assigned to a
variable first, concatenation, literals inside `${}` holes or a nested call's arguments. Exemptions are listed in the test with a reason and are checked to still match.

**2. German toast.** `Request und Response wurden kopiert (535 Zeichen).`, and with redaction
`…(535 Zeichen); 2 Werte wurden geschwärzt.` / `1 Wert wurde geschwärzt.` Ukrainian
`Запит і відповідь скопійовано (535 символів); приховано 2 значення.` with the plural forms for the
character count and the redacted count at 1, 2, 5 and 21. English is unchanged in wording.

**3. Parse errors.** The headline is unchanged. The hint is one sentence per kind, in the interface
language. The position is shown in the error card's "where" line as `at line L, column C` /
`in Zeile L, Spalte C` / `у рядку L, стовпці C`, counted against **what was pasted** (leading blank
lines count; CRLF and a lone CR each end one line; columns count characters, not UTF-16 units). The
only fragment of the input in the hint is the single offending character, shown as a value (never
parsed as markup); an invisible one (a no-break space, a zero-width character, a control character)
is shown as `U+00A0`. The python-dict and not-JSON-start errors carry the same line and column. The
scanner runs only after `JSON.parse` has failed; if it finds nothing to point at, `hintUnlocated`
is shown and no position.

**4. Import toast.** All saved → `Imported N documents into your saved documents.` (info). Some →
`Imported K of N documents; the rest could not be saved.` (error tone). None → the existing
`importFailed` sentence (error tone), never "Imported 0". The existing done view is unchanged.

**5. Focus.** When any dialog closes, by Escape, ✕, a click on the backdrop, `closeModal`,
`closeAllModals` or another dialog replacing it, focus goes to the first of:
(a) the control that opened it, if it is still in the document, not disabled and not inside a
`[hidden]`/`[inert]` subtree; (b) the control that opened the dialog this one replaced, under the
same conditions; (c) the first focusable control of a dialog still open underneath, so a nested
question never leaves focus outside the dialog it was asked in; (d) `#view` (made focusable with
`tabindex="-1"`).
Never `<body>`. "The control that opened it" is the last clicked control when the most recent
interaction was a click (any key press makes the click stale), else `document.activeElement`.
Focus is moved without scrolling. The saved-documents list's own refocus after a rename or delete
(`refocusList`) still runs after the nested dialog closes and wins; when the list is empty it goes
to the dialog's ✕.

**6. README.** The Share sentence is replaced by one that is true **after QA5 and QA6 have both
landed**: Share carries the attached request and response into the encrypted link, redacted, with
the count shown before the link is created, from the document's own Share button and from Saved
documents → Share. (Until QA6 lands, the document's own Share does not yet do this; the Saved
documents path does and is the only path QA5's author could observe.) The `docs/STATUS.md` link is
removed. No other README link points at a gitignored path (checked: the only others are
`docs/DECISIONS.md` and files under `src/`, `public/`, `test/`, `scripts/`, `.github/`).

**7. Size unit.** **KiB/MiB, 1024-based.** Justification: the limits the app states are binary
(`MAX_BUNDLE_BYTES` and the Worker's `MAX_BYTES` are 12 × 1024 × 1024); on a 1000 base the share
limit would read "12.58 MB" and every dialog would disagree with the number a user is told. The
label is what was wrong. Applies to every `formatBytes` call (raw view, library rows, share dialogs,
bundle import rows, request body line, over-limit messages) and to the Worker's 413 message. Unit
symbols are not translated, so the three catalogues need no row. Documented in the README and D9.

## Error and edge cases

| Case | Expected |
|---|---|
| `QA synthetic payload` | `unexpected-char` `Q` at line 1, column 1; no engine text, no echo of `QA synthet` |
| Truncated at end of input | `unexpected-end`, position is the end of the text |
| `{"a":1,}` / `[1,]` | `trailing-comma`, at the closing bracket |
| Raw newline inside a string | `control-in-string`, at the newline |
| `"\x"`, `"\u12G4"` | `bad-escape` |
| `{"a":1} {"b":2}` | `extra-content`, `{`, at the second document |
| Blank lines before the JSON | line counts them |
| CRLF, lone CR | one break each |
| Emoji earlier on the same line | column counts it as one character |
| Invisible character at the error | `U+XXXX`, never an empty quote |
| Input `<img src=x onerror=…>` | the `<` is shown as text; nothing parses as markup |
| 200,000-deep nesting, malformed | an error is reported; no stack overflow |
| Scanner finds nothing but `JSON.parse` failed | `hintUnlocated`, no position |
| Top-level `42`, `true`, `null` | worded in the interface language (`JSON-Zahl`, `JSON-Boolean`, `JSON-null`) |
| Opener removed before the dialog closes | focus falls to the next rule, never `<body>` |
| Opener disabled before close | skipped |
| Dialog opened by a shortcut with nothing focused | focus goes to `#view` |
| Dialog opened from inside another dialog that it replaces | the first dialog's opener |
| Rename/Delete cancelled | focus returns to that row's button |
| Rename/Delete confirmed | the list's own refocus wins; empty list → ✕ |
| Safari/Firefox-mac click that does not focus the button | still returns to that button |
| Import: 1 saved / many / partial / none / storage blocked | the four copies above; never "Imported 0" |
| uk counts 1, 2, 5, 21, 22 | `документ`, `документи`, `документів`, `документ`, `документи`; "з 21 документа" |
| Size 1023 / 1024 / 12 MiB | `1023 B` / `1.0 KiB` / `12.00 MiB` |
| Hostile `type`/`id` through the chip title and the resource body | appear as text, in all three languages |

## Out of scope

- The document's own Share carrying the request; masked secrets leaving the DOM; request-URL
  parsing; persisting an exchange on a saved document — **QA6**.
- Rewording copy that is already in the catalogue and correct. Prose quoting a measured file size
  from outside the app ("25.7 MB" in the FAQ, `llms.txt`, `og.svg`, the README performance table)
  and `mcp/`'s "12 MB" text: not changed; the first are claims about a file, the second is a
  separate program.
- The server's English `{ "error": … }` JSON bodies other than the 413 unit. **Correction (review
  S2):** these are not only API responses — `share.ts` forwards `body.error` as the error hint
  (`:65-71`, rendered at `:273`) and shows `String(error)` for a network failure (`:267`), so the
  Worker's English text, including the 413 line edited here, reaches a German or Ukrainian user.
  That is a `share.ts` fix (QA6's file): ignore `body.error` and key a catalogue row on the status.
  Tracked outside QA5.
- A done-view redesign for the bundle import.

## Acceptance criteria

- [ ] No `aria-label`, `title`, `text:` etc. in `src/` (outside the catalogues and legal pages) is a
      letter-bearing literal, apart from the two documented exemptions (`null`, the product name); `test/copy-hygiene.test.ts`
      passes and is shown to fail when a literal is reintroduced.
- [ ] In `de` and `uk`, every button the report named has a translated accessible name equal to its
      tooltip.
- [ ] The German toast reads as a complete sentence for 0, 1 and 2 redacted values; uk agrees in
      number at 1, 2, 5 and 21.
- [ ] No parse error in any language contains `Unexpected`, `is not valid JSON`, `JSON.parse`,
      `position N`, or any prefix of the input.
- [ ] Each parse-error state in REGRESSION §2 shows a readable headline and hint, and the
      truncated-JSON one names a line (and a column).
- [ ] `Import selected` raises the right toast in all three languages for all, some and none saved.
- [ ] Escape on save / raw / jump / library / share / request form returns focus to the control that
      opened it; Rename and Delete return to their own row buttons.
- [ ] README: no sentence says Share does not carry the request; no link to `docs/STATUS.md`.
- [ ] No size shown anywhere reads `kB` or `MB`.

## Tests that must exist

- [ ] `test/copy-hygiene.test.ts` — the scan, its self-tests (it flags the shapes that shipped; it
      passes catalogue lookups, symbols, comments; an unknown helper fails it), and the run over `src/`.
- [ ] `test/copy-a11y.test.ts` — per-value and per-resource buttons in en/de/uk against the
      catalogue and against English; hostile type/id as text through the row HTML and the chip.
- [ ] `test/json-syntax.test.ts` — every kind and position; agreement with `JSON.parse` over valid
      documents and every one-edit mutation of them; deep nesting; line/column rules; per-language
      parse errors with no engine text; hostile character carried as a value.
- [ ] `test/toast-copy.test.ts` — the exchange toast and import toast plurals; `formatBytes`.
- [ ] `test/bundle-view.test.ts` — the import toast: one, several, only-ticked, partial, none.
- [ ] `test/dialog-focus.test.ts` — every rule of the focus fallback, including the click-without-focus
      case and the nested Rename/Delete cases.
- [ ] Browser: focus after Escape for each top-level dialog and the nested ones, and the translated
      names in de/uk, observed in headless Chrome (evidence file).
