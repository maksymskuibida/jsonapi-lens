/**
 * The form: the one editable way an `Exchange` gets written by hand.
 * `docs/task-specs/T2.md`'s "form" subsection — "each field separated ...
 * nothing bundled into a textarea that has to be re-parsed." T2a's decoders
 * (`decodeParams`, `parseCookieHeader`, `parseSetCookie`) are what turn this
 * form's plain name/value rows into the real model on save; this module never
 * duplicates their logic.
 *
 * ## Why this is a modal, not something inline
 *
 * The **review** (`render-request.ts`) lives inline, above the overview,
 * because it has to participate in the page's own layout and scroll
 * restoration. The **form** does not: while it is open nothing below it is
 * being read, so putting it inline would mean a second, editable copy of the
 * band's layout to keep in sync with the read-only one, and every row added
 * or removed would reflow content the scroll-restoration machinery is
 * tracking. A modal sidesteps both — `ui.ts#openModal` already exists for
 * exactly this (Save, Library, Raw all use it), and it is the surface that
 * gets to change size freely without anything downstream noticing.
 *
 * ## Why the form always submits a complete snapshot
 *
 * `exchange.ts#mergeExchange`'s own header comment says a form group "always
 * submits its current whole value for the fields it owns", not a diff — this
 * form is that submitter. Every save reads every row currently in the DOM
 * (present here, not tracked in a parallel JS array kept in sync by
 * listeners) and builds a full `RequestPart`/`ResponsePart` from it, with a
 * field omitted only when its group was never touched in this session. This
 * makes "come back and extend it later without starting again" simply a
 * matter of pre-filling from `current.exchange` when the modal opens —
 * nothing about the merge has to be re-derived here.
 *
 * ## Why the query table drives the URL string, not the other way round
 *
 * "The table is the truth; the URL is a rendering of it" (spec). So `query`
 * rows are the one piece of state kept in a live array (`QueryRowState[]`)
 * rather than read from the DOM only at save time — the URL field's own
 * `input` listener has to rebuild from it on every keystroke, and reading a
 * live DOM row list on every keystroke of an unrelated field would be far
 * more work than keeping the small array current.
 */

import { el } from "./dom.js";
import { t } from "./i18n/index.js";
import { openModal } from "./ui.js";
import { headerSet } from "./headers.js";
import type { HeaderEntry, HeaderSet } from "./headers.js";
import { parseCookieHeader, parseSetCookie } from "./cookies.js";
import type { Cookie, CookieSet, SetCookie, SetCookieSet } from "./cookies.js";
import { decodeParams } from "./params.js";
import type { BodyPart, Exchange, RequestPart, ResponsePart } from "./exchange.js";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

/* ------------------------------------------------------------ row lists --- */

interface SimpleRow {
  name: string;
  value: string;
  disabled: boolean;
}

/**
 * One editable name/value row, with a disable checkbox and a remove button —
 * "a row may be disabled rather than deleted, so a parameter can be taken out
 * of consideration without losing it." `onNameChange` is how the Cookie/
 * Set-Cookie auto-move (see `wireCookiePromotion` below) hears about an edit.
 */
function nameValueRow(row: SimpleRow, namePlaceholder: string, onNameChange?: (rowEl: HTMLElement) => void): HTMLElement {
  const nameInput = el("input", {
    class: "field xform__name",
    type: "text",
    value: row.name,
    placeholder: namePlaceholder,
    spellcheck: false,
    "aria-label": t().request.form.rowName,
  });
  const valueInput = el("input", {
    class: "field xform__value",
    type: "text",
    value: row.value,
    placeholder: t().request.form.rowValuePlaceholder,
    spellcheck: false,
    "aria-label": t().request.form.rowValue,
  });
  const disableToggle = el("input", { type: "checkbox", checked: row.disabled });
  const remove = el("button", {
    class: "act act--mini",
    type: "button",
    title: t().request.form.removeRow,
    "aria-label": t().request.form.removeRow,
    text: "×",
  });

  const rowEl = el(
    "div",
    { class: "xform-row" },
    nameInput,
    valueInput,
    el("label", { class: "xform-row__disable", title: t().request.form.disableRowTitle }, disableToggle, t().request.form.disableRowLabel),
    remove,
  );
  rowEl.classList.toggle("xform-row--disabled", row.disabled);

  disableToggle.addEventListener("change", () => rowEl.classList.toggle("xform-row--disabled", disableToggle.checked));
  remove.addEventListener("click", () => rowEl.remove());
  if (onNameChange) nameInput.addEventListener("change", () => onNameChange(rowEl));

  return rowEl;
}

/** Read every row's current state directly off the DOM — see this module's header for why that, not a parallel array. */
function readRows(container: HTMLElement): SimpleRow[] {
  const rows: SimpleRow[] = [];
  for (const rowEl of container.querySelectorAll<HTMLElement>(".xform-row")) {
    const name = rowEl.querySelector<HTMLInputElement>(".xform__name")?.value ?? "";
    const value = rowEl.querySelector<HTMLInputElement>(".xform__value")?.value ?? "";
    const disabled = rowEl.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked ?? false;
    if (name === "" && value === "") continue;
    rows.push({ name, value, disabled });
  }
  return rows;
}

interface RowListHandle {
  root: HTMLElement;
  rows: HTMLElement;
  addRow: (row?: SimpleRow) => void;
}

function buildRowList(
  initial: SimpleRow[],
  namePlaceholder: string,
  onNameChange?: (rowEl: HTMLElement) => void,
): RowListHandle {
  const rows = el("div", { class: "xform-rows" });
  const addButton = el("button", { class: "btn btn--sm", type: "button", text: t().request.form.addRow });
  const root = el("div", { class: "xform-rowlist" }, rows, addButton);

  const addRow = (row: SimpleRow = { name: "", value: "", disabled: false }): void => {
    rows.append(nameValueRow(row, namePlaceholder, onNameChange));
  };

  for (const row of initial) addRow(row);
  addButton.addEventListener("click", () => addRow());

  return { root, rows, addRow };
}

/* A response `Set-Cookie` row is edited as one raw wire string — see this
   module's header note in the review's own cookie table for why parsing it
   into per-attribute fields is a review-time concern, not a form one. */
function buildRawRowList(initial: string[]): { root: HTMLElement; read: () => string[]; addRow: (value?: string) => void } {
  const rows = el("div", { class: "xform-rows" });
  const addButton = el("button", { class: "btn btn--sm", type: "button", text: t().request.form.addRow });
  const root = el("div", { class: "xform-rowlist" }, rows, addButton);

  const addRow = (value = ""): void => {
    const input = el("input", {
      class: "field xform__raw",
      type: "text",
      value,
      placeholder: t().request.form.setCookiePlaceholder,
      spellcheck: false,
      "aria-label": t().request.form.setCookieAria,
    });
    const remove = el("button", {
      class: "act act--mini",
      type: "button",
      title: t().request.form.removeRow,
      "aria-label": t().request.form.removeRow,
      text: "×",
    });
    const rowEl = el("div", { class: "xform-row xform-row--raw" }, input, remove);
    remove.addEventListener("click", () => rowEl.remove());
    rows.append(rowEl);
  };

  for (const value of initial) addRow(value);
  addButton.addEventListener("click", () => addRow());

  const read = (): string[] =>
    [...rows.querySelectorAll<HTMLInputElement>(".xform__raw")].map((i) => i.value).filter((v) => v.trim() !== "");

  return { root, read, addRow };
}

/* ------------------------------------------------------------- promotion --- */

/**
 * "Adding a header called Cookie moves its contents into the cookie rows,
 * and the same for Set-Cookie on the response." Wired on the header name
 * input's `change` event (fires on blur/Enter, not every keystroke — moving
 * a row out from under someone mid-type would be startling). A no-op when
 * the value is still blank — nothing to move yet.
 */
function moveHeaderRowInto(headerRowEl: HTMLElement, moveInto: (rawValue: string) => void): void {
  const value = headerRowEl.querySelector<HTMLInputElement>(".xform__value")?.value ?? "";
  if (value === "") return;
  moveInto(value);
  headerRowEl.remove();
}

/* ---------------------------------------------------------------- query --- */

export interface QueryRowState {
  name: string;
  value: string;
  disabled: boolean;
}

/** Encode the enabled rows to a wire query string — `?` not included. */
export function encodeQueryRows(rows: QueryRowState[]): string {
  return rows
    .filter((r) => !r.disabled && r.name !== "")
    .map((r) => `${encodeURIComponent(r.name)}=${encodeURIComponent(r.value)}`)
    .join("&");
}

/** Split a `?query` string (already stripped of `?`) into editable rows, decoded for display. */
export function decodeQueryRows(query: string): QueryRowState[] {
  if (query === "") return [];
  return query.split("&").map((pair) => {
    const eq = pair.indexOf("=");
    const rawName = eq < 0 ? pair : pair.slice(0, eq);
    const rawValue = eq < 0 ? "" : pair.slice(eq + 1);
    const decode = (s: string): string => {
      try {
        return decodeURIComponent(s.replace(/\+/g, " "));
      } catch {
        return s;
      }
    };
    return { name: decode(rawName), value: decode(rawValue), disabled: false };
  });
}

/** Split a URL string into everything before `?`/`#` and the query text itself (without `?`). */
export function splitUrlQuery(url: string): { base: string; query: string; hash: string } {
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const withoutHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const queryAt = withoutHash.indexOf("?");
  if (queryAt < 0) return { base: withoutHash, query: "", hash };
  return { base: withoutHash.slice(0, queryAt), query: withoutHash.slice(queryAt + 1), hash };
}

/* ------------------------------------------------------------------ body --- */

function bodyFields(initial: BodyPart | undefined): {
  root: HTMLElement;
  touched: () => boolean;
  /**
   * `force`: return a defined `BodyPart` (`{raw: ""}` when both fields are
   * blank) rather than `undefined`. `mergeExchange#pick` treats `undefined`
   * as "not touched, keep the old value" — the one field on `RequestPart`/
   * `ResponsePart` with no "present but empty" state of its own, per
   * `exchange.ts`'s own test ("a base body survives when incoming touches
   * other fields but not body"). So clearing a body the user has emptied
   * out needs an *explicit* empty `BodyPart`, not an absent one — `main.ts`
   * asks for `force` exactly when the surrounding group is being submitted
   * at all, so deleting the last character of a body and saving actually
   * clears it instead of leaving the old body in place.
   */
  read: (force?: boolean) => BodyPart | undefined;
} {
  const contentType = el("input", {
    class: "field",
    type: "text",
    value: initial?.contentType ?? "",
    placeholder: t().request.form.contentTypePlaceholder,
    spellcheck: false,
    "aria-label": t().request.form.contentTypeLabel,
  });
  const raw = el("textarea", {
    class: "field xform__body",
    rows: 6,
    spellcheck: false,
    "aria-label": t().request.form.bodyLabel,
    text: initial?.raw ?? "",
  });
  // `el()`'s `text` sets `textContent`, which a `<textarea>` also accepts as
  // its initial value — but only before any user edit, so this is safe here
  // and nowhere else in this form (every other field uses `value`).
  const root = el(
    "div",
    { class: "xform-body" },
    el("label", { class: "xform__label", text: t().request.form.contentTypeLabel }, contentType),
    el("label", { class: "xform__label", text: t().request.form.bodyLabel }, raw),
  );

  const touched = (): boolean => raw.value !== "" || contentType.value !== "";

  const read = (force = false): BodyPart | undefined => {
    if (!force && !touched()) return undefined;
    const part: BodyPart = { raw: raw.value };
    if (contentType.value !== "") part.contentType = contentType.value;
    return part;
  };

  return { root, touched, read };
}

/* --------------------------------------------------------------- fields --- */

function labeled(label: string, field: HTMLElement): HTMLElement {
  return el("label", { class: "xform__label", text: label }, field);
}

function textField(value: string, placeholder: string, ariaLabel: string, type = "text"): HTMLInputElement {
  return el("input", { class: "field", type, value, placeholder, spellcheck: false, "aria-label": ariaLabel });
}

/* ----------------------------------------------------------------- form --- */

export interface RequestFormResult {
  request: RequestPart | undefined;
  response: ResponsePart | undefined;
}

/**
 * Build a `HeaderSet` from a row list — always defined, disabled/blank-name
 * rows excluded. Whether this is worth *submitting at all* is decided once,
 * for the whole request or response group, by the `hasRequest`/`hasResponse`
 * checks in `openRequestForm`'s save handler — this function only ever reads
 * the rows currently in the DOM.
 */
function headersFromRows(rows: SimpleRow[]): HeaderSet {
  const entries: HeaderEntry[] = rows.filter((r) => !r.disabled && r.name !== "").map((r) => ({ name: r.name, value: r.value }));
  return headerSet(entries);
}

function cookiesFromRows(rows: SimpleRow[]): CookieSet {
  const entries: Cookie[] = rows.filter((r) => !r.disabled && r.name !== "").map((r) => ({ name: r.name, value: r.value }));
  return { entries };
}

function setCookiesFromRaw(raw: string[]): SetCookieSet {
  return { entries: raw.map((value) => parseSetCookie(value)) as SetCookie[] };
}

/**
 * Open the form, pre-filled from `existing` (the exchange already saved, if
 * any — "come back and extend it later without starting again"). `onSave`
 * receives a full snapshot of both parts; the caller (`main.ts`) folds it
 * into `current.exchange` via `mergeExchange` and persists.
 */
export function openRequestForm(existing: Exchange, onSave: (result: RequestFormResult) => void): void {
  const m = t().request.form;
  const req = existing.request;
  const res = existing.response;

  /* ------------------------------------------------------------- request -- */

  const knownMethod = req?.method !== undefined && (METHODS as readonly string[]).includes(req.method);
  // A leading blank option is the true "untouched" state — defaulting the
  // select to e.g. `GET` would make `hasRequest` (below) true the moment the
  // form opens, even for someone who touched nothing, which breaks "the form
  // is never a required step."
  const methodSelect = el(
    "select",
    { class: "field xform__method", "aria-label": m.methodLabel },
    el("option", { value: "", text: m.methodUnset }),
    ...METHODS.map((value) => el("option", { value, text: value })),
    el("option", { value: m.methodOther, text: m.methodOther }),
  );
  methodSelect.value = knownMethod ? req!.method! : req?.method !== undefined ? m.methodOther : "";
  const customMethod = textField(!knownMethod && req?.method !== undefined ? req.method : "", "", m.methodOtherLabel);
  customMethod.hidden = methodSelect.value !== m.methodOther;
  methodSelect.addEventListener("change", () => {
    customMethod.hidden = methodSelect.value !== m.methodOther;
  });

  // `xform__url-input` is a locale-independent hook — every visible label on
  // this form is translated, so `test/browser/nav-scenarios.js` cannot find
  // fields by their `aria-label` text the way an English-only script could.
  const urlInput = textField(req?.url ?? "", m.urlPlaceholder, m.urlLabel);
  urlInput.classList.add("xform__url-input");

  /**
   * Pre-fill from the *raw wire pairs*, not the decoded value — a decoded
   * `ParamEntry` can have lost no information (`raw` is kept for exactly
   * this), but a form row is one wire pair, so reconstructing rows from
   * `entry.value` would silently collapse a repeated key (`a=1&a=2`) or a
   * bracket list down to whatever the first pair happened to be. Percent-
   * decoding is deliberately *not* applied here, unlike the URL-typed path
   * below: a row's "name" carries the wire key verbatim (`a[]`, `filter[status]`),
   * which is what lets re-encoding it reproduce the same convention on save.
   */
  const initialQueryRows: QueryRowState[] = req?.query
    ? req.query.entries.flatMap((entry) =>
        entry.raw.map((pair) => ({ name: pair.key, value: pair.value ?? "", disabled: false })),
      )
    : decodeQueryRows(splitUrlQuery(req?.url ?? "").query);

  let syncingUrl = false;

  const queryList = buildRowList(initialQueryRows, m.paramName);
  const rebuildUrlFromQuery = (): void => {
    if (syncingUrl) return;
    syncingUrl = true;
    const rows = readRows(queryList.root).map((r) => ({ name: r.name, value: r.value, disabled: r.disabled }));
    const split = splitUrlQuery(urlInput.value);
    const query = encodeQueryRows(rows);
    urlInput.value = split.base + (query ? `?${query}` : "") + split.hash;
    syncingUrl = false;
  };
  queryList.root.addEventListener("input", rebuildUrlFromQuery);
  queryList.root.addEventListener("change", rebuildUrlFromQuery);

  urlInput.addEventListener("input", () => {
    if (syncingUrl) return;
    syncingUrl = true;
    const split = splitUrlQuery(urlInput.value);
    queryList.rows.replaceChildren();
    for (const row of decodeQueryRows(split.query)) queryList.addRow(row);
    syncingUrl = false;
  });

  const reqHeaderRows: SimpleRow[] = req?.headers
    ? req.headers.entries.map((h) => ({ name: h.name, value: h.value, disabled: false }))
    : [];
  const reqCookieRows: SimpleRow[] = req?.cookies
    ? req.cookies.entries.map((c) => ({ name: c.name, value: c.value, disabled: false }))
    : [];
  const reqCookieList = buildRowList(reqCookieRows, m.cookieName);

  const reqHeaderList = buildRowList(reqHeaderRows, m.headerName, (rowEl) => {
    const name = rowEl.querySelector<HTMLInputElement>(".xform__name")?.value.trim().toLowerCase();
    if (name === "cookie") {
      moveHeaderRowInto(rowEl, (raw) => {
        for (const cookie of parseCookieHeader(raw)) reqCookieList.addRow({ ...cookie, disabled: false });
      });
    }
  });

  const reqBody = bodyFields(req?.body);

  /* ------------------------------------------------------------ response -- */

  const statusInput = textField(res?.status !== undefined ? String(res.status) : "", m.statusPlaceholder, m.statusLabel, "number");
  statusInput.classList.add("xform__status-input");
  const statusTextInput = textField(res?.statusText ?? "", m.statusTextPlaceholder, m.statusTextLabel);
  const elapsedInput = textField(
    res?.elapsedMs !== undefined ? String(res.elapsedMs) : "",
    m.elapsedPlaceholder,
    m.elapsedLabel,
    "number",
  );

  const resSetCookieList = buildRawRowList(
    res?.cookies?.entries.map((c) => {
      const attrs: string[] = [`${c.name}=${c.value}`];
      if (c.domain !== undefined) attrs.push(`Domain=${c.domain}`);
      if (c.path !== undefined) attrs.push(`Path=${c.path}`);
      if (c.expires !== undefined) attrs.push(`Expires=${c.expires}`);
      if (c.maxAge !== undefined) attrs.push(`Max-Age=${c.maxAge}`);
      if (c.secure) attrs.push("Secure");
      if (c.httpOnly) attrs.push("HttpOnly");
      if (c.sameSite !== undefined) attrs.push(`SameSite=${c.sameSite}`);
      for (const u of c.unrecognized ?? []) attrs.push(u.value !== undefined ? `${u.name}=${u.value}` : u.name);
      return attrs.join("; ");
    }) ?? [],
  );

  const resHeaderRows: SimpleRow[] = res?.headers
    ? res.headers.entries.map((h) => ({ name: h.name, value: h.value, disabled: false }))
    : [];
  const resHeaderList = buildRowList(resHeaderRows, m.headerName, (rowEl) => {
    const name = rowEl.querySelector<HTMLInputElement>(".xform__name")?.value.trim().toLowerCase();
    if (name === "set-cookie") moveHeaderRowInto(rowEl, (raw) => resSetCookieList.addRow(raw));
  });

  const resBody = bodyFields(res?.body);

  /* --------------------------------------------------------------- body --- */

  const body = el(
    "div",
    { class: "xform" },
    el("h3", { class: "xform__section-title", text: m.requestTitle }),
    el("div", { class: "xform__row-pair" }, labeled(m.methodLabel, methodSelect), labeled(m.methodOtherLabel, customMethod)),
    labeled(m.urlLabel, urlInput),
    el("p", { class: "xform__hint", text: m.urlSyncHint }),
    labeled(m.queryLabel, queryList.root),
    labeled(m.headersLabel, reqHeaderList.root),
    labeled(m.cookiesLabel, reqCookieList.root),
    reqBody.root,

    el("h3", { class: "xform__section-title", text: m.responseTitle }),
    el(
      "div",
      { class: "xform__row-pair" },
      labeled(m.statusLabel, statusInput),
      labeled(m.statusTextLabel, statusTextInput),
      labeled(m.elapsedLabel, elapsedInput),
    ),
    labeled(m.headersLabel, resHeaderList.root),
    el("p", { class: "xform__hint", text: m.setCookieHint }),
    labeled(m.cookiesLabel, resSetCookieList.root),
    resBody.root,
  );

  const save = el("button", { class: "btn btn--primary", type: "button", text: m.save });

  openModal({
    title: m.title,
    subtitle: m.subtitle,
    body,
    variant: "tall",
    footer: (handle) => {
      save.addEventListener("click", () => {
        const method = methodSelect.value === m.methodOther ? customMethod.value.trim() : methodSelect.value;
        const url = urlInput.value.trim();
        const status = statusInput.value.trim();
        const statusText = statusTextInput.value.trim();
        const elapsed = elapsedInput.value.trim();

        /**
         * Whether a group is touched at all — checked on signals a save
         * cannot itself have produced (a row *added*, not a row's content),
         * so that opening the form and saving without touching anything
         * submits neither part. Once a group is touched, every field it owns
         * is submitted as a complete, current snapshot — including an empty
         * one where the group has nothing left — per `mergeExchange`'s "a
         * form group always submits its whole current value" contract; see
         * `bodyFields`'s own comment for why the body specifically needs
         * `read(true)` to make that true for a body that was just cleared.
         */
        const hasRequest =
          method !== "" ||
          url !== "" ||
          queryList.rows.children.length > 0 ||
          reqHeaderList.rows.children.length > 0 ||
          reqCookieList.rows.children.length > 0 ||
          reqBody.touched();

        const hasResponse =
          status !== "" ||
          statusText !== "" ||
          elapsed !== "" ||
          resHeaderList.rows.children.length > 0 ||
          resSetCookieList.read().length > 0 ||
          resBody.touched();

        let requestPart: RequestPart | undefined;
        if (hasRequest) {
          requestPart = {
            method,
            url,
            query: decodeParams(encodeQueryRows(readRows(queryList.root))),
            headers: headersFromRows(readRows(reqHeaderList.root)),
            cookies: cookiesFromRows(readRows(reqCookieList.root)),
          };
          const reqBodyPart = reqBody.read(true);
          if (reqBodyPart !== undefined) requestPart.body = reqBodyPart;
        }

        let responsePart: ResponsePart | undefined;
        if (hasResponse) {
          responsePart = {
            headers: headersFromRows(readRows(resHeaderList.root)),
            cookies: setCookiesFromRaw(resSetCookieList.read()),
          };
          if (status !== "" && Number.isFinite(Number(status))) responsePart.status = Number(status);
          if (statusText !== "") responsePart.statusText = statusText;
          if (elapsed !== "" && Number.isFinite(Number(elapsed))) responsePart.elapsedMs = Number(elapsed);
          const resBodyPart = resBody.read(true);
          if (resBodyPart !== undefined) responsePart.body = resBodyPart;
        }

        handle.close();
        onSave({ request: requestPart, response: responsePart });
      });
      return el("div", { class: "modal__actions" }, save);
    },
  });
}
