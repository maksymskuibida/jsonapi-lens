/**
 * Building the index for a plain-JSON (non-JSON:API) document: the inferred
 * collections the rail reads, and the identity graph — a repeated identifier
 * becomes a link, the way a `{type, id}` pointer already does in a JSON:API
 * document. See `docs/task-specs/T1.md` and `docs/DECISIONS.md` D2.
 *
 * Pure — no DOM, like `parse.ts#buildIndex`, which this is the plain-JSON
 * sibling of. One iterative (not recursive — a 200-level-deep document must
 * not blow the stack) walk over the whole tree does both jobs at once:
 * finding collections and collecting identity candidates share the same
 * traversal, so a 50 MB document is not walked twice.
 *
 * ## Collections
 *
 * An array of two or more objects "sharing a majority of their key names"
 * (`looksLikeCollection` below) is one collection, named by its JSON Pointer.
 * The spec does not give an exact algorithm for "majority", so this one is
 * documented rather than assumed: at least half the array's elements must be
 * objects, there must be at least one key held by more than half of those
 * objects, and at least half of the objects must draw at least half of their
 * *own* keys from that common set. A bare top-level array is always the
 * document's one collection regardless of content — "a bare array of
 * scalars" reads as shape `collection` with no key-sharing to check.
 *
 * A collection nested inside another collection's member (`topLevel: false`)
 * still gets anchored members — a reference inside it can still resolve —
 * but is not promoted to its own rail entry or group section, so the rail
 * shows one row per collection a person would recognise rather than one per
 * array in the document.
 *
 * ## Identity — the rule that matters most
 *
 * A candidate identifier is a scalar at a bare id-like key (`id`, `uuid`,
 * `guid`, `key`, `code`, `ref`, `slug` — matched after lower-casing and
 * stripping `_`/`-`, so `_id` and `ID` both count as bare `id`), a scalar at a
 * compound reference key (`user_id`, `fooId`), each scalar element of an
 * array at a *plural* compound key (`tag_ids: [1, 2]` — the plural form names
 * the array, so every element inherits its scope), or any string anywhere
 * shaped like a UUID, ULID or 24-hex-character ObjectId.
 *
 * A bare-key occurrence is a **definition**, scoped to the container name of
 * the object it sits on (the last non-index segment of *that object's*
 * pointer — its enclosing collection or property name, not the id field's own
 * pointer). A compound-key occurrence is a **reference**, scoped to the name
 * the key implies (`user_id` → `user`). Both sides are reduced to the same
 * canonical (roughly singular) form before comparison, which is what lets
 * `user_id` find a `users` collection. A global (UUID/ULID/ObjectId) value
 * ignores scope entirely and matches on value alone, because those formats
 * are unique by construction — this takes priority even when the key would
 * otherwise imply a scope, since a wrong link is worse than none.
 *
 * `canonicalScope` only strips a trailing `s`/`es`/`ies` (see its own comment
 * for how it tells `pages` → `page` apart from `boxes` → `box`). It does not
 * know `person`/`people` or any other irregular plural, so a reference
 * naming an irregular collection will not find it — it renders dangling
 * instead of linking. That is the safe direction to be wrong in: this module
 * would rather miss a link than mint one that lands on the wrong object.
 *
 * A definition with nothing referencing it is not treated as an identity at
 * all (an ordinary value — it still gets an anchor, but only because it is a
 * collection member, not because of this pass). A reference with no matching
 * definition is dangling regardless of how many times it occurs. Two or more
 * definitions sharing a scope and value make every reference to them
 * ambiguous, never resolved by picking one.
 */

import { nodeDomId, typeHue, typeSigil } from "./ident.js";
import { join as pointerJoin, parse as parsePointer } from "./pointer.js";
import type {
  IdentityCluster,
  IdentityDefinitionInfo,
  IdentityReferenceInfo,
  JsonCollection,
  JsonCounts,
  JsonDanglingEntry,
  JsonIndex,
  JsonValue,
  Shape,
  ShapeEvidence,
} from "./types.js";

/**
 * Above this many nodes, the identity pass stops rather than stalling — the
 * "50 MB / 200k nodes" budget the spec names, analogous to
 * `parse.ts#REVERSE_POINTER_LIMIT`. Collections found before the cutoff are
 * kept; the identity graph is discarded rather than left half-built, since a
 * partial graph could report a value as dangling only because the walk gave
 * up before reaching its definition.
 */
export const IDENTITY_NODE_LIMIT = 200_000;

function isPlainObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Crockford base32: `0-9`, `A-Z` minus `I`, `L`, `O`, `U`. */
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

function isGlobalIdShaped(value: string): boolean {
  return UUID_RE.test(value) || ULID_RE.test(value) || OBJECT_ID_RE.test(value);
}

const BARE_ID_KEYS = new Set(["id", "uuid", "guid", "key", "code", "ref", "slug"]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]+/g, "");
}

function isBareIdKey(key: string): boolean {
  return BARE_ID_KEYS.has(normalizeKey(key));
}

/** The container name a compound `*_id`/`*Id`/`*_ids`/`*Ids` key implies, or `null` if it is not that shape. */
function referenceContainerName(key: string): string | null {
  if (isBareIdKey(key)) return null;
  const normalized = normalizeKey(key);
  if (normalized.length > 3 && normalized.endsWith("ids")) return normalized.slice(0, -3);
  if (normalized.length > 2 && normalized.endsWith("id")) return normalized.slice(0, -2);
  return null;
}

function endsWithSibilant(word: string): boolean {
  return /(?:[sxz]|ch|sh)$/.test(word);
}

/**
 * Basic English singularisation — see the header for what this deliberately
 * does not handle.
 *
 * The `-es` case needs a choice a plain suffix strip cannot make blindly:
 * `pages` → `page` strips only the `s` (the singular already ends in a
 * silent `e`), but `boxes` → `box` has to strip both letters, because the
 * `e` there is not part of the stem at all — it is only there so `-s` is
 * pronounceable after a sibilant. The two cannot be told apart from the
 * plural's spelling alone, so this checks what stripping `es` *would* leave:
 * if that still ends in a sibilant (`box`, `class`, `watch`, `wish`), the
 * `e` was inserted and both letters go; otherwise (`pag`, `articl`, `nam`)
 * only the `s` was added and the `e` stays.
 *
 * That heuristic still gets one narrower class wrong: a singular that
 * itself ends in `-se` (`house`, `response`, `license`) strips its `e` and
 * still ends in `s`, so it reads as the inserted-`e` case and loses a
 * letter it should have kept (`houses` → `hous`, not `house`). Rare enough
 * among collection names that this is left as a known gap rather than
 * chased with a dictionary — a miss here still just means a reference that
 * comes out dangling rather than a wrong link, since scope names that fail
 * to match do not resolve to anything at all.
 */
function canonicalScope(name: string): string {
  const normalized = normalizeKey(name);
  if (normalized.length > 3 && normalized.endsWith("ies")) return normalized.slice(0, -3) + "y";
  if (normalized.length > 2 && normalized.endsWith("es")) {
    const stripBoth = normalized.slice(0, -2);
    return endsWithSibilant(stripBoth) ? stripBoth : normalized.slice(0, -1);
  }
  if (normalized.length > 1 && normalized.endsWith("s")) return normalized.slice(0, -1);
  return normalized;
}

/** The last non-array-index path segment — what an object is "called" by whatever holds it. */
function containerNameFromPointer(pointer: string): string {
  const segments = parsePointer(pointer);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!/^(?:0|[1-9]\d*)$/.test(segments[i]!)) return segments[i]!;
  }
  return "";
}

/**
 * The scope a UUID/ULID/ObjectId-shaped value matches under, regardless of
 * key. Built with a leading control character at runtime — `String.fromCharCode(0)`
 * rather than a literal one in this source file — because
 * `normalizeKey`/`canonicalScope` only ever *remove* characters (lower-casing
 * and stripping `_`/`-`), never introduce one, so no real container name,
 * however spelled, can ever produce it. A plain word like `"global"` would
 * not have that guarantee: a collection literally named `globals` would
 * canonicalise to exactly that.
 */
export const GLOBAL_IDENTITY_SCOPE = String.fromCharCode(0) + "global";

interface Occurrence {
  /** Pointer to the id-like key's value, or to the array element itself. */
  pointer: string;
  scope: string;
  valueKind: "string" | "number";
  value: string;
  isDefinition: boolean;
  /** For a definition: the enclosing object's pointer — what a reference to it should land on. Also carried on a reference, for building the dangling/ambiguous entries without a second lookup. */
  definitionTargetPointer: string;
}

function bucketKey(o: Pick<Occurrence, "scope" | "valueKind" | "value">): string {
  return `${o.scope}${o.valueKind === "number" ? "n" : "s"}${o.value}`;
}

/**
 * Whether an array of `items` "shares a majority of its key names" — see the
 * header for why this heuristic and not another. `looksLikeCollection([])`
 * and single-element arrays are `false`; the caller handles the special case
 * of a bare top-level array separately.
 */
function looksLikeCollection(items: readonly JsonValue[]): boolean {
  if (items.length < 2) return false;
  const objects = items.filter(isPlainObject);
  if (objects.length < 2 || objects.length < items.length / 2) return false;

  const keyCounts = new Map<string, number>();
  for (const obj of objects) {
    for (const key of Object.keys(obj)) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
  }
  const threshold = objects.length / 2;
  const commonKeys = new Set(
    [...keyCounts.entries()].filter(([, count]) => count > threshold).map(([key]) => key),
  );
  if (commonKeys.size === 0) return false;

  let qualifying = 0;
  for (const obj of objects) {
    const keys = Object.keys(obj);
    if (keys.length === 0) continue;
    const shared = keys.filter((key) => commonKeys.has(key)).length;
    if (shared / keys.length >= 0.5) qualifying++;
  }
  return qualifying >= objects.length / 2;
}

interface CollectionDraft {
  pointer: string;
  label: string;
  memberPointers: string[];
}

/** Ancestor-of relationship between two JSON Pointers, in the path sense. */
function isAncestorPointer(ancestor: string, pointer: string): boolean {
  if (ancestor === pointer) return false;
  return pointer.startsWith(ancestor === "" ? "/" : ancestor + "/");
}

function candidatesForScalar(
  key: string | null,
  value: string | number,
  childPointer: string,
  enclosingPointer: string,
): Occurrence[] {
  const isString = typeof value === "string";
  const globalMatch = isString && isGlobalIdShaped(value);
  const bare = key !== null && isBareIdKey(key);
  const refContainer = key !== null && !bare ? referenceContainerName(key) : null;

  if (!globalMatch && !bare && refContainer === null) return [];

  const stringValue = String(value);
  const valueKind = isString ? "string" : "number";

  if (globalMatch) {
    return [
      {
        pointer: childPointer,
        scope: GLOBAL_IDENTITY_SCOPE,
        valueKind,
        value: stringValue,
        isDefinition: bare,
        definitionTargetPointer: enclosingPointer,
      },
    ];
  }
  if (bare) {
    return [
      {
        pointer: childPointer,
        scope: canonicalScope(containerNameFromPointer(enclosingPointer)),
        valueKind,
        value: stringValue,
        isDefinition: true,
        definitionTargetPointer: enclosingPointer,
      },
    ];
  }
  return [
    {
      pointer: childPointer,
      scope: canonicalScope(refContainer!),
      valueKind,
      value: stringValue,
      isDefinition: false,
      definitionTargetPointer: enclosingPointer,
    },
  ];
}

interface WalkResult {
  collections: CollectionDraft[];
  occurrences: Occurrence[];
  budgetExceeded: boolean;
}

interface Frame {
  pointer: string;
  value: JsonValue;
  /**
   * Set when this array is itself the value of a compound `*_ids`/`*Ids` key
   * (`tag_ids: [1, 2]`) — the plural form names the *array*, not one of its
   * elements, so each scalar element inherits this as its reference scope.
   * A global (UUID/ULID/ObjectId) element still wins over this, same as the
   * singular form — see `candidatesForScalar`.
   */
  arrayRefScope?: string;
}

/** The iterative walk. A stack, not the call stack — see the header. */
function walk(root: JsonValue): WalkResult {
  const collectionsByPointer = new Map<string, CollectionDraft>();
  const occurrences: Occurrence[] = [];
  let budgetExceeded = false;
  let nodeCount = 1; // the root itself

  if (Array.isArray(root)) {
    collectionsByPointer.set("", {
      pointer: "",
      label: "",
      memberPointers: root.map((_, i) => pointerJoin("", i)),
    });
  }

  const stack: Frame[] = [{ pointer: "", value: root }];

  walkLoop: while (stack.length > 0) {
    const frame = stack.pop()!;

    if (Array.isArray(frame.value)) {
      if (!collectionsByPointer.has(frame.pointer) && looksLikeCollection(frame.value)) {
        collectionsByPointer.set(frame.pointer, {
          pointer: frame.pointer,
          label: containerNameFromPointer(frame.pointer),
          memberPointers: frame.value.map((_, i) => pointerJoin(frame.pointer, i)),
        });
      }

      for (let i = 0; i < frame.value.length; i++) {
        const child = frame.value[i]!;
        const childPointer = pointerJoin(frame.pointer, i);
        nodeCount++;
        if (nodeCount > IDENTITY_NODE_LIMIT) {
          budgetExceeded = true;
          break walkLoop;
        }
        if (typeof child === "string" || typeof child === "number") {
          occurrences.push(...candidatesForScalar(null, child, childPointer, frame.pointer));
          const globallyShaped = typeof child === "string" && isGlobalIdShaped(child);
          if (frame.arrayRefScope !== undefined && !globallyShaped) {
            occurrences.push({
              pointer: childPointer,
              scope: frame.arrayRefScope,
              valueKind: typeof child === "number" ? "number" : "string",
              value: String(child),
              isDefinition: false,
              definitionTargetPointer: frame.pointer,
            });
          }
        } else if (child !== null) {
          stack.push({ pointer: childPointer, value: child });
        }
      }
    } else if (isPlainObject(frame.value)) {
      for (const key of Object.keys(frame.value)) {
        const child = frame.value[key]!;
        const childPointer = pointerJoin(frame.pointer, key);
        nodeCount++;
        if (nodeCount > IDENTITY_NODE_LIMIT) {
          budgetExceeded = true;
          break walkLoop;
        }
        if (typeof child === "string" || typeof child === "number") {
          occurrences.push(...candidatesForScalar(key, child, childPointer, frame.pointer));
        } else if (Array.isArray(child)) {
          const refContainer = referenceContainerName(key);
          stack.push({
            pointer: childPointer,
            value: child,
            arrayRefScope: refContainer !== null ? canonicalScope(refContainer) : undefined,
          });
        } else if (child !== null) {
          stack.push({ pointer: childPointer, value: child });
        }
      }
    }
  }

  return { collections: [...collectionsByPointer.values()], occurrences, budgetExceeded };
}

function buildCollections(drafts: CollectionDraft[]): JsonCollection[] {
  return drafts.map((draft) => {
    const topLevel = !drafts.some((other) => isAncestorPointer(other.pointer, draft.pointer));
    return {
      pointer: draft.pointer,
      label: draft.label,
      memberPointers: draft.memberPointers,
      domId: nodeDomId(draft.pointer),
      hue: typeHue(draft.label),
      sigil: typeSigil(draft.label || "?"),
      topLevel,
    };
  });
}

function buildIdentities(occurrences: Occurrence[]): {
  identities: IdentityCluster[];
  referenceAt: Map<string, IdentityReferenceInfo>;
  definitionAt: Map<string, IdentityDefinitionInfo>;
  dangling: JsonDanglingEntry[];
} {
  const buckets = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const key = bucketKey(occurrence);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(occurrence);
    else buckets.set(key, [occurrence]);
  }

  const identities: IdentityCluster[] = [];
  const referenceAt = new Map<string, IdentityReferenceInfo>();
  const definitionAt = new Map<string, IdentityDefinitionInfo>();
  const dangling: JsonDanglingEntry[] = [];

  for (const bucket of buckets.values()) {
    const definitionOccurrences = bucket.filter((o) => o.isDefinition);
    const referenceOccurrences = bucket.filter((o) => !o.isDefinition);
    // The same object can carry two id-like keys with the same value (`id`
    // and `code` both `42`) — that is one definition, not two, so a
    // reference to it must not read as ambiguous.
    const definitionTargets = [...new Set(definitionOccurrences.map((o) => o.definitionTargetPointer))];
    const { scope, value } = bucket[0]!;

    if (definitionTargets.length === 0) {
      dangling.push({ scope, value, count: referenceOccurrences.length });
      for (const ref of referenceOccurrences) referenceAt.set(ref.pointer, { resolution: "dangling" });
      identities.push({
        scope,
        value,
        resolution: "dangling",
        definitionPointers: [],
        referencePointers: referenceOccurrences.map((r) => r.pointer),
      });
      continue;
    }

    if (definitionTargets.length === 1 && referenceOccurrences.length === 0) {
      // A lone, unreferenced id. Not an identity — an ordinary value.
      continue;
    }

    const ambiguous = definitionTargets.length > 1;
    for (const target of definitionTargets) {
      definitionAt.set(target, {
        domId: nodeDomId(target),
        referenceCount: referenceOccurrences.length,
        ambiguous,
      });
    }

    if (ambiguous) {
      for (const ref of referenceOccurrences) {
        referenceAt.set(ref.pointer, { resolution: "ambiguous", candidates: definitionTargets.length });
      }
    } else {
      const target = definitionTargets[0]!;
      const targetDomId = nodeDomId(target);
      for (const ref of referenceOccurrences) {
        referenceAt.set(ref.pointer, { resolution: "resolved", targetPointer: target, targetDomId });
      }
    }

    identities.push({
      scope,
      value,
      resolution: ambiguous ? "ambiguous" : "resolved",
      definitionPointers: definitionTargets,
      referencePointers: referenceOccurrences.map((r) => r.pointer),
    });
  }

  return { identities, referenceAt, definitionAt, dangling };
}

/** Build the index for a document `detectShape` classified as anything other than `jsonapi`. */
export function buildJsonIndex(value: JsonValue, shape: Shape, evidence: ShapeEvidence): JsonIndex {
  const walked = walk(value);
  const collections = buildCollections(walked.collections);

  const { identities, referenceAt, definitionAt, dangling } = walked.budgetExceeded
    ? { identities: [], referenceAt: new Map(), definitionAt: new Map(), dangling: [] }
    : buildIdentities(walked.occurrences);

  const topLevelCollections = collections.filter((c) => c.topLevel);
  const danglingTotal = dangling.reduce((sum, d) => sum + d.count, 0);

  const counts: JsonCounts = {
    total: topLevelCollections.reduce((sum, c) => sum + c.memberPointers.length, 0),
    collections: topLevelCollections.length,
    resolved: identities.filter((i) => i.resolution === "resolved").length,
    ambiguous: identities.filter((i) => i.resolution === "ambiguous").length,
    danglingDistinct: dangling.length,
    danglingTotal,
  };

  return {
    root: value,
    shape,
    shapeEvidence: evidence,
    collections,
    identities,
    referenceAt,
    definitionAt,
    dangling,
    counts,
    identitySkipped: walked.budgetExceeded,
  };
}
