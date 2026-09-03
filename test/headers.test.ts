import { describe, expect, it } from "vitest";
import {
  addHeader,
  countHeader,
  EMPTY_HEADERS,
  getHeader,
  getHeaderAll,
  hasHeader,
  headerSet,
} from "../src/headers.js";

describe("headerSet / addHeader", () => {
  it("copies the entries it is given, rather than aliasing the caller's array", () => {
    const source = [{ name: "X-A", value: "1" }];
    const set = headerSet(source);
    source.push({ name: "X-B", value: "2" });
    expect(set.entries).toHaveLength(1);
  });

  it("defaults to an empty set", () => {
    expect(headerSet().entries).toEqual([]);
    expect(EMPTY_HEADERS.entries).toEqual([]);
  });

  it("appends without disturbing what was already there", () => {
    const a = headerSet([{ name: "Accept", value: "application/json" }]);
    const b = addHeader(a, "X-Trace", "abc");
    expect(a.entries).toHaveLength(1); // addHeader does not mutate its input
    expect(b.entries).toEqual([
      { name: "Accept", value: "application/json" },
      { name: "X-Trace", value: "abc" },
    ]);
  });
});

describe("getHeader / getHeaderAll / hasHeader — case-insensitive lookup with duplicates ordered", () => {
  const set = headerSet([
    { name: "Content-Type", value: "application/json" },
    { name: "Set-Cookie", value: "a=1" },
    { name: "Set-Cookie", value: "b=2" },
    { name: "set-cookie", value: "c=3" },
  ]);

  it("finds a header regardless of the case it is asked about in", () => {
    expect(getHeader(set, "content-type")).toBe("application/json");
    expect(getHeader(set, "CONTENT-TYPE")).toBe("application/json");
    expect(getHeader(set, "Content-Type")).toBe("application/json");
  });

  it("returns the first match for a name that repeats", () => {
    expect(getHeader(set, "Set-Cookie")).toBe("a=1");
  });

  it("returns every match, in the order the headers arrived, regardless of casing", () => {
    expect(getHeaderAll(set, "SET-COOKIE")).toEqual(["a=1", "b=2", "c=3"]);
  });

  it("hasHeader and countHeader agree with getHeaderAll's length", () => {
    expect(hasHeader(set, "set-cookie")).toBe(true);
    expect(countHeader(set, "set-cookie")).toBe(3);
    expect(hasHeader(set, "authorization")).toBe(false);
    expect(countHeader(set, "authorization")).toBe(0);
  });

  it("a name with no match is undefined/empty, not an error", () => {
    expect(getHeader(set, "missing")).toBeUndefined();
    expect(getHeaderAll(set, "missing")).toEqual([]);
  });
});

describe("hostile values are preserved exactly, never sanitised", () => {
  // This module produces no DOM and no HTML string, so it has no injection
  // surface of its own — but T2b will render whatever it hands back, so the
  // one thing this module must never do is mangle a hostile value on the way
  // through. Escaping happens exactly once, downstream.
  const hostileName = '<img src=x onerror=alert(1)>';
  const hostileValue = '"><script>alert(1)</script>';

  it("keeps a hostile header name and value untouched, byte for byte", () => {
    const set = headerSet([{ name: hostileName, value: hostileValue }]);
    expect(getHeader(set, hostileName)).toBe(hostileValue);
    expect(set.entries[0]).toEqual({ name: hostileName, value: hostileValue });
  });
});
