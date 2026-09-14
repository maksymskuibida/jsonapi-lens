import { describe, expect, it } from "vitest";
import { detectTransportLog, parseTransportLog, transportLogImporter } from "../../src/importers/transport-log.js";
import { ImportError } from "../../src/importers/types.js";
import { getHeader } from "../../src/headers.js";
import startedFixture from "../fixtures/transport-log-started.json?raw";
import finishedFixture from "../fixtures/transport-log-finished.json?raw";

const STARTED = JSON.parse(startedFixture);
const FINISHED = JSON.parse(finishedFixture);

describe("transport log — detection", () => {
  it("recognises the started fixture and the finished fixture independently", () => {
    expect(detectTransportLog(startedFixture)).not.toBeNull();
    expect(detectTransportLog(finishedFixture)).not.toBeNull();
  });

  it("falls through on an ordinary log line with no HTTP fields at all", () => {
    const ordinary = JSON.stringify({
      context: { correlation_id: "x" },
      info: { message: "worker heartbeat", levelname: "DEBUG", created: "2026-09-02 00:00:00.000" },
    });
    expect(detectTransportLog(ordinary)).toBeNull();
  });

  it("does not recognise unrelated JSON, HAR, or plain text", () => {
    expect(detectTransportLog('{"data":{"type":"widgets","id":"1"}}')).toBeNull();
    expect(detectTransportLog("not json")).toBeNull();
    expect(detectTransportLog("")).toBeNull();
  });

  it("names the record and call count in its summary", () => {
    const detection = detectTransportLog(startedFixture);
    expect(detection?.summary).toContain("1");
  });
});

describe("transport log — started record maps every field in the table", () => {
  it("method, url, headers, absent query/body, and origin", () => {
    const result = parseTransportLog(startedFixture);
    expect(result.exchanges).toHaveLength(1);
    const { request, response, origin } = result.exchanges[0]!;

    expect(request?.method).toBe("GET");
    expect(request?.url).toBe("https://api.example.com/v2/cancellations/conditions");
    expect("query" in request!).toBe(false); // request_params: null
    expect(request?.body).toBeUndefined(); // request_data: null
    expect(getHeader(request!.headers!, "api-key")).toMatch(/^x+$/);

    expect(response).toBeUndefined(); // no finished record in this paste

    expect(origin).toMatchObject({
      kind: "transport-log",
      provider: "example-provider",
      providerMethod: "/v2/cancellations/conditions",
      levelname: "INFO",
      instanceName: "gateway-5684d86c57-rncmj",
      applevel: "staging",
    });
    expect(origin?.context).toBeDefined();
    expect((origin?.context as Record<string, unknown>)?.correlation_id).toBe("8ZrTn4WqLpB2vKxMd6HcJs");
  });
});

describe("transport log — finished record maps every field, elapsed_time converts to ms", () => {
  it("status, headers, body, and elapsedMs — with method/url still filled from info", () => {
    const result = parseTransportLog(finishedFixture);
    const { request, response } = result.exchanges[0]!;

    // "a finished record still fills method and URL from info"
    expect(request?.method).toBe("GET");
    expect(request?.url).toBe("https://api.example.com/v2/cancellations/conditions");
    expect(request?.headers).toBeUndefined();
    expect("query" in request!).toBe(false);

    expect(response?.status).toBe(200);
    expect(response?.elapsedMs).toBeCloseTo(478.5615630025859, 6);
    expect(getHeader(response!.headers!, "content-type")).toBe("application/vnd.api+json");
    expect(getHeader(response!.headers!, "x-request-id")).toBe("488a2f4a4598fe2021fe3a506b68bad1");
    expect(response?.body?.raw).toContain('"type": "refund_offers"');
    expect(response?.body?.contentType).toBe("application/vnd.api+json");
  });
});

describe("transport log — started + finished merge to one complete exchange, order-independent", () => {
  it("started then finished", () => {
    const pasted = JSON.stringify([STARTED, FINISHED]);
    const result = parseTransportLog(pasted);
    expect(result.exchanges).toHaveLength(1);
    const exchange = result.exchanges[0]!;
    expect(exchange.request?.method).toBe("GET");
    expect(exchange.request?.headers).toBeDefined(); // from started
    expect(exchange.response?.status).toBe(200); // from finished
    expect(exchange.response?.elapsedMs).toBeCloseTo(478.5615630025859, 6);
  });

  it("finished then started produces the identical exchange", () => {
    const forwardResult = parseTransportLog(JSON.stringify([STARTED, FINISHED]));
    const reversedResult = parseTransportLog(JSON.stringify([FINISHED, STARTED]));
    expect(reversedResult.exchanges).toEqual(forwardResult.exchanges);
  });
});

describe("transport log — request_params null is absent, distinguishable from {}", () => {
  it("null yields no query property at all", () => {
    const result = parseTransportLog(startedFixture);
    expect("query" in result.exchanges[0]!.request!).toBe(false);
  });

  it("{} yields a present, empty query", () => {
    const withEmptyParams = { ...STARTED, info: { ...STARTED.info, request_params: {} } };
    const result = parseTransportLog(JSON.stringify(withEmptyParams));
    const { request } = result.exchanges[0]!;
    expect("query" in request!).toBe(true);
    expect(request?.query?.entries).toEqual([]);
  });

  it("a non-empty object decodes as plain, unambiguous entries", () => {
    const withParams = { ...STARTED, info: { ...STARTED.info, request_params: { status: "active", page: 2 } } };
    const result = parseTransportLog(JSON.stringify(withParams));
    const { query } = result.exchanges[0]!.request!;
    expect(query?.entries.find((e) => e.name === "status")).toMatchObject({ value: "active", convention: "plain" });
    expect(query?.entries.find((e) => e.name === "page")).toMatchObject({ value: 2, convention: "plain" });
  });

  it("a wire query string decodes through the real decoder", () => {
    const withParams = { ...STARTED, info: { ...STARTED.info, request_params: "status=active&status=held" } };
    const result = parseTransportLog(JSON.stringify(withParams));
    const entry = result.exchanges[0]!.request!.query!.entries.find((e) => e.name === "status");
    expect(entry?.value).toEqual(["active", "held"]);
  });
});

describe("transport log — correlation groups by (correlation_id, method, url)", () => {
  it("three records across two URLs group into two exchanges", () => {
    const base = { context: { correlation_id: "abc" } };
    const records = [
      { ...base, info: { message_type: "transport_logging", funcName: "log_start", http_method: "GET", url: "https://api.example.com/a", request_headers: {} } },
      { ...base, info: { message_type: "transport_logging", funcName: "_log_response", http_method: "GET", url: "https://api.example.com/a", response_status_code: 200 } },
      { ...base, info: { message_type: "transport_logging", funcName: "_log_response", http_method: "GET", url: "https://api.example.com/b", response_status_code: 500 } },
    ];
    const result = parseTransportLog(JSON.stringify(records));
    expect(result.exchanges).toHaveLength(2);
    const byUrl = new Map(result.exchanges.map((e) => [e.request?.url, e]));
    expect(byUrl.get("https://api.example.com/a")?.response?.status).toBe(200);
    expect(byUrl.get("https://api.example.com/b")?.response?.status).toBe(500);
  });

  it("the same url and method with different correlation ids stay separate calls", () => {
    const records = [
      { context: { correlation_id: "one" }, info: { message_type: "transport_logging", http_method: "GET", url: "https://api.example.com/x", response_status_code: 200 } },
      { context: { correlation_id: "two" }, info: { message_type: "transport_logging", http_method: "GET", url: "https://api.example.com/x", response_status_code: 500 } },
    ];
    const result = parseTransportLog(JSON.stringify(records));
    expect(result.exchanges).toHaveLength(2);
  });
});

describe("transport log — response_data double-encoding", () => {
  it("an object response_data is used as-is, no warning", () => {
    const result = parseTransportLog(finishedFixture);
    expect(result.warnings.some((w) => /double/i.test(w))).toBe(false);
  });

  it("a string response_data that is itself JSON is unwrapped, with the double encoding named", () => {
    const inner = { data: { type: "widgets", id: "1" } };
    const doubled = { ...FINISHED, info: { ...FINISHED.info, response_data: JSON.stringify(inner) } };
    const result = parseTransportLog(JSON.stringify(doubled));
    const body = result.exchanges[0]!.response?.body;
    expect(body?.raw).toContain('"type": "widgets"');
    expect(JSON.parse(body!.raw)).toEqual(inner);
    expect(result.warnings.some((w) => /double/i.test(w))).toBe(true);
  });

  it("a plain string response_data (not JSON) is kept verbatim, no double-encoding warning", () => {
    const plain = { ...FINISHED, info: { ...FINISHED.info, response_data: "Service Unavailable" } };
    const result = parseTransportLog(JSON.stringify(plain));
    expect(result.exchanges[0]!.response?.body?.raw).toBe("Service Unavailable");
    expect(result.warnings.some((w) => /double/i.test(w))).toBe(false);
  });
});

describe("transport log — exc_text is surfaced", () => {
  it("a non-null exc_text lands on origin, not folded away", () => {
    const failed = {
      ...FINISHED,
      info: {
        ...FINISHED.info,
        response_status_code: 502,
        exc_text: "Traceback (most recent call last):\nProviderTimeoutError: upstream did not respond",
      },
    };
    const result = parseTransportLog(JSON.stringify(failed));
    expect(result.exchanges[0]!.origin?.excText).toContain("ProviderTimeoutError");
  });

  it("exc_text: null is not surfaced at all", () => {
    const result = parseTransportLog(finishedFixture);
    expect(result.exchanges[0]!.origin?.excText).toBeUndefined();
  });
});

describe("transport log — an ambiguous record contributes what it plainly stated", () => {
  it("a message_type: transport_logging record with neither started nor finished signals still fills method/url", () => {
    const ambiguous = JSON.stringify({
      context: { correlation_id: "z" },
      info: { message_type: "transport_logging", http_method: "GET", url: "https://api.example.com/mystery" },
    });
    const result = parseTransportLog(ambiguous);
    expect(result.exchanges[0]!.request?.url).toBe("https://api.example.com/mystery");
    expect(result.warnings.some((w) => /kind/i.test(w))).toBe(true);
  });
});

describe("transport log — NDJSON of records", () => {
  it("one record per line groups exactly like a JSON array of the same records", () => {
    const ndjson = `${JSON.stringify(STARTED)}\n${JSON.stringify(FINISHED)}\n`;
    const result = parseTransportLog(ndjson);
    expect(result.exchanges).toHaveLength(1);
    expect(result.exchanges[0]!.response?.status).toBe(200);
  });

  it("a malformed line among valid ones is skipped and reported, not fatal", () => {
    const ndjson = `${JSON.stringify(STARTED)}\nnot even json\n`;
    const result = parseTransportLog(ndjson);
    expect(result.exchanges).toHaveLength(1);
    expect(result.warnings.some((w) => /line/i.test(w))).toBe(true);
  });

  it("a non-transport-log JSON line mixed in is skipped and counted", () => {
    const ndjson = `${JSON.stringify(STARTED)}\n${JSON.stringify({ some: "other log line" })}\n`;
    const result = parseTransportLog(ndjson);
    expect(result.exchanges).toHaveLength(1);
    expect(result.warnings.some((w) => /not recognised|skipped/i.test(w))).toBe(true);
  });
});

describe("transport log — origin.kind and not-a-transport-log", () => {
  it("origin.kind is always set", () => {
    expect(transportLogImporter.parse(startedFixture).exchanges[0]!.origin?.kind).toBe("transport-log");
  });

  it("parse throws ImportError when detect would have said no", () => {
    expect(() => parseTransportLog("not a transport log")).toThrow(ImportError);
  });
});

describe("transport log — context is kept as real structured data, not a string", () => {
  it("feature_flags stays an array, not a stringified blob", () => {
    const result = parseTransportLog(finishedFixture);
    const context = result.exchanges[0]!.origin?.context as Record<string, unknown>;
    expect(Array.isArray(context.feature_flags)).toBe(true);
    expect((context.feature_flags as unknown[]).length).toBeGreaterThan(0);
    expect(typeof context.actor).toBe("object");
  });
});
