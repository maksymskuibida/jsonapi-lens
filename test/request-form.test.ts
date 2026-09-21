import { beforeEach, describe, expect, it } from "vitest";
import { decodeQueryRows, encodeQueryRows, openRequestForm, splitUrlQuery } from "../src/request-form.js";
import { decodeParams } from "../src/params.js";

describe("splitUrlQuery", () => {
  it("splits base, query and hash apart", () => {
    expect(splitUrlQuery("https://api.example.com/x?a=1&b=2#frag")).toEqual({
      base: "https://api.example.com/x",
      query: "a=1&b=2",
      hash: "#frag",
    });
  });

  it("tolerates a URL with none of the three", () => {
    expect(splitUrlQuery("https://api.example.com/x")).toEqual({
      base: "https://api.example.com/x",
      query: "",
      hash: "",
    });
  });

  it("tolerates an empty string", () => {
    expect(splitUrlQuery("")).toEqual({ base: "", query: "", hash: "" });
  });
});

describe("decodeQueryRows / encodeQueryRows — the URL <-> table sync", () => {
  it("decodes a query string into rows, percent- and +-decoded for display", () => {
    const rows = decodeQueryRows("a=1&b=hello%20world&c=x+y");
    expect(rows).toEqual([
      { name: "a", value: "1", disabled: false, raw: { key: "a", value: "1" } },
      { name: "b", value: "hello world", disabled: false, raw: { key: "b", value: "hello%20world" } },
      { name: "c", value: "x y", disabled: false, raw: { key: "c", value: "x+y" } },
    ]);
  });

  /*
   * Opening the request dialog and pressing Save, changing nothing, used to
   * re-encode every parameter — because a row is populated with the *decoded*
   * text a person edits, and saving encoded that text again over bytes that
   * were already encoded. `%5B` became `%255B`, and again on the next round
   * trip, taking the bracket-object reading with it. The corrupted values are
   * what Copy, Download and a share then carried.
   *
   * Asserted as an identity on the wire, which is the property that actually
   * matters, rather than on the row shape.
   */
  it("writes an untouched row back byte-for-byte, however it was encoded", () => {
    for (const query of [
      "filter%5Btag%5D=a%20b",
      "q=%D1%82%D0%B5%D1%81%D1%82",
      "a%5B%5D=1&a%5B%5D=2",
      "include=comments",
      "c=x+y",
    ]) {
      expect(encodeQueryRows(decodeQueryRows(query)), query).toBe(query);
      // Twice, because the defect compounded — one round trip looked survivable.
      expect(encodeQueryRows(decodeQueryRows(encodeQueryRows(decodeQueryRows(query)))), query).toBe(query);
    }
  });

  it("keeps an escape it cannot decode, rather than escaping the escape", () => {
    // `%ZZ` is not valid percent-encoding, so it decodes to itself; encoding
    // that gave `%25ZZ` on the *first* save, with no round trip needed.
    expect(encodeQueryRows(decodeQueryRows("a=%ZZ"))).toBe("a=%ZZ");
  });

  it("keeps a valueless parameter valueless", () => {
    // `?flag` is not `?flag=`, and `params.ts` keeps the two distinguishable.
    expect(encodeQueryRows(decodeQueryRows("flag"))).toBe("flag");
    expect(encodeQueryRows(decodeQueryRows("flag=")), "empty value is not valueless").toBe("flag=");
  });

  it("re-encodes a row that was actually edited", () => {
    // The other half: preserving bytes must not mean ignoring an edit.
    const rows = decodeQueryRows("filter%5Btag%5D=a%20b");
    rows[0]!.value = "changed value";
    expect(encodeQueryRows(rows)).toBe("filter%5Btag%5D=changed%20value");

    const renamed = decodeQueryRows("filter%5Btag%5D=a%20b");
    renamed[0]!.name = "other[k]";
    expect(encodeQueryRows(renamed)).toBe("other%5Bk%5D=a%20b");
  });

  it("re-encodes rows to a query string decodeParams reads back to an equivalent value", () => {
    // "Ada Lovelace" contains a space, and `decodeParams` reads *any* space-
    // containing value as a space-delimited list by default (D5) — that is
    // not a round-trip failure, it is the documented ambiguity this decoder
    // is built to surface. The plain string survives too, as the named
    // alternative — which is the actual property worth asserting here.
    const rows = decodeQueryRows("name=Ada%20Lovelace&tag=x%2Fy");
    const encoded = encodeQueryRows(rows);
    expect(encoded).toBe("name=Ada%20Lovelace&tag=x%2Fy");
    const decoded = decodeParams(encoded);
    expect(decoded.entries[0]?.value).toEqual(["Ada", "Lovelace"]);
    expect(decoded.entries[0]?.alternatives).toContainEqual({ path: [], convention: "plain", value: "Ada Lovelace" });
    expect(decoded.entries[1]).toEqual(
      expect.objectContaining({ name: "tag", value: "x/y", convention: "plain" }),
    );
  });

  it("drops disabled rows and blank-named rows from the encoded URL, without throwing", () => {
    const encoded = encodeQueryRows([
      { name: "a", value: "1", disabled: false },
      { name: "b", value: "2", disabled: true },
      { name: "", value: "orphaned", disabled: false },
    ]);
    expect(encoded).toBe("a=1");
  });

  it("round-trips a wire key carrying bracket syntax, so the form can emulate any convention", () => {
    const rows = [
      { name: "a[]", value: "1", disabled: false },
      { name: "a[]", value: "2", disabled: false },
    ];
    const decoded = decodeParams(encodeQueryRows(rows));
    expect(decoded.entries[0]?.value).toEqual(["1", "2"]);
    expect(decoded.entries[0]?.convention).toBe("bracket-list");
  });

  it("survives hostile row names and values — never thrown, never silently dropped", () => {
    const hostile = ["<script>alert(1)</script>", "__proto__", "constructor", "a&b=c"];
    for (const value of hostile) {
      const encoded = encodeQueryRows([{ name: value, value, disabled: false }]);
      const decoded = decodeParams(encoded);
      expect(decoded.entries).toHaveLength(1);
      expect(decoded.entries[0]?.name).toBe(value);
      // Never written through a hostile key onto a plain object anywhere in
      // this round trip.
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
    }
  });

  it("returns an empty row list for an empty query string", () => {
    expect(decodeQueryRows("")).toEqual([]);
  });
});

/*
 * The URL field's live preview, driven through the real dialog.
 *
 * Review of #23 found `rebuildUrlFromQuery` stripping each row's origin before
 * re-encoding, so editing any one row re-encoded *all* of them in the field on
 * screen — an untouched `a=%ZZ` previewing as `a=%25ZZ`, which is F2's own
 * failure shown back to the person as they decide whether the value is right.
 *
 * Driven through `openRequestForm` rather than `encodeQueryRows`, because the
 * first version of this test called that helper directly — and the helper was
 * never the broken part. It passed with the defect reinstated.
 */
describe("the URL field's preview keeps untouched rows byte-identical", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="modal-root"></div><div id="toast"></div>';
  });

  it("re-encodes only the row that changed", () => {
    openRequestForm(
      { request: { url: "https://api.example.com/x?a=%ZZ&keep=x%20y&edit=old" } },
      () => {},
    );

    const urlInput = document.querySelector<HTMLInputElement>(".xform__url-input");
    expect(urlInput, "the form rendered").not.toBeNull();

    const rows = [...document.querySelectorAll<HTMLElement>(".xform-rowlist")][0]!.querySelectorAll<HTMLElement>(
      ".xform-row",
    );
    expect(rows.length, "three query rows").toBe(3);

    const editValue = rows[2]!.querySelector<HTMLInputElement>(".xform__value")!;
    editValue.value = "new";
    editValue.dispatchEvent(new Event("input", { bubbles: true }));

    expect(urlInput!.value).toBe("https://api.example.com/x?a=%ZZ&keep=x%20y&edit=new");
  });
});

/*
 * Each row's disable checkbox names the row it belongs to.
 *
 * Every one of them announced the same single word before this — "disabled",
 * with nothing to say which field it would disable — so a screen-reader user
 * hearing a column of them had no way to tell them apart.
 */
describe("the per-row disable checkbox has a name of its own", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="modal-root"></div><div id="toast"></div>';
  });

  const labels = (): (string | null)[] =>
    [
      ...[...document.querySelectorAll<HTMLElement>(".xform-rowlist")][0]!.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]',
      ),
    ].map((box) => box.getAttribute("aria-label"));

  it("names each row by its field, and they differ", () => {
    openRequestForm({ request: { url: "https://api.example.com/x?alpha=1&beta=2" } }, () => {});
    const found = labels();
    expect(found).toHaveLength(2);
    expect(found[0]).toContain("alpha");
    expect(found[1]).toContain("beta");
    // The point of the fix: two rows must not announce the same thing.
    expect(found[0]).not.toBe(found[1]);
  });

  it("follows the field as it is renamed, and says something when it is empty", () => {
    openRequestForm({ request: { url: "https://api.example.com/x?alpha=1" } }, () => {});
    const list = [...document.querySelectorAll<HTMLElement>(".xform-rowlist")][0]!;
    const name = list.querySelector<HTMLInputElement>(".xform__name")!;

    name.value = "renamed";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    expect(labels()[0]).toContain("renamed");

    name.value = "";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    // Still named — an empty field is not an excuse for an empty label.
    expect(labels()[0]).toBeTruthy();
    expect(labels()[0]).not.toContain("renamed");
  });
});
