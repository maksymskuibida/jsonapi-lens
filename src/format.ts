import type { JsonValue } from "./types.js";

export type ValueKind =
  | "null"
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "url"
  | "uuid"
  | "empty-string"
  | "array"
  | "object";

/** ISO 8601 date or date-time, which is what JSON:API attributes carry in practice. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function classify(value: JsonValue): ValueKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (value === "") return "empty-string";
  if (ISO_DATE.test(value)) return "date";
  if (UUID.test(value)) return "uuid";
  if (/^https?:\/\/\S+$/.test(value)) return "url";
  return "string";
}

const NUMBER_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

/**
 * Render a date-ish string as both the local reading and the raw value.
 *
 * Timezone bugs are a big share of what the user is looking for in these
 * payloads, so the original string is never replaced — only annotated.
 */
export function formatDate(raw: string): { display: string; title: string } | null {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const display = dateOnly
    ? parsed.toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" })
    : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });

  return { display, title: `${raw}${dateOnly ? "" : `  ·  ${parsed.toISOString()}`}` };
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return NUMBER_FORMAT.format(value);
}

/** One-line preview of a nested value, for a collapsed row. */
export function previewValue(value: JsonValue, budget = 72): string {
  const text = previewInner(value, budget);
  return text.length > budget ? text.slice(0, budget - 1) + "…" : text;
}

function previewInner(value: JsonValue, budget: number): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const parts: string[] = [];
    let used = 2;
    for (const item of value) {
      const part = previewInner(item, Math.max(8, budget - used));
      parts.push(part);
      used += part.length + 2;
      if (used > budget) break;
    }
    return `[${parts.join(", ")}${parts.length < value.length ? ", …" : ""}]`;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) return "{}";
  const parts: string[] = [];
  let used = 2;
  for (const key of keys) {
    const part = `${key}: ${previewInner(value[key]!, Math.max(8, budget - used))}`;
    parts.push(part);
    used += part.length + 2;
    if (used > budget) break;
  }
  return `{${parts.join(", ")}${parts.length < keys.length ? ", …" : ""}}`;
}

/**
 * Pick the attribute that best identifies a resource in a collapsed row.
 *
 * Ordered by how much they tend to mean to a human scanning a list. Falls back
 * to the first short scalar so there is almost always something useful shown.
 */
const SUMMARY_KEYS = [
  "name",
  "title",
  "label",
  "display_name",
  "displayName",
  "code",
  "slug",
  "reference",
  "description",
  "email",
  "status",
  "state",
  "kind",
  "category",
];

export function summaryAttribute(
  attributes: Record<string, JsonValue> | undefined,
): { key: string; value: JsonValue } | null {
  if (!attributes) return null;

  for (const candidate of SUMMARY_KEYS) {
    if (candidate in attributes) {
      const value = attributes[candidate]!;
      const kind = classify(value);
      if (kind !== "null" && kind !== "empty-string" && kind !== "object" && kind !== "array") {
        return { key: candidate, value };
      }
    }
  }

  // Fall back in two passes rather than one. A single pass returns whatever
  // comes first in key order, which lets a dull number win on position alone —
  // a comment would be summarised as "score 2" when it also carries a body.
  // Short strings are far more identifying, so they get the first pass.
  for (const key of Object.keys(attributes)) {
    const value = attributes[key]!;
    if (classify(value) === "string" && String(value).length <= 60) return { key, value };
  }

  for (const key of Object.keys(attributes)) {
    const value = attributes[key]!;
    const kind = classify(value);
    if (kind === "date" || kind === "number" || kind === "boolean" || kind === "uuid") {
      return { key, value };
    }
  }

  return null;
}

/** Human-readable byte size for the document meta line. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** `snake_case` / `camelCase` attribute key to something readable. */
export function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .trim();
}
