/**
 * Minimal structural types for the parts of JSON:API this viewer reads —
 * and, since T1, for a plain-JSON document too. `Lens` is the seam: the view
 * layer consumes one or the other, `DocumentIndex` unchanged and `JsonIndex`
 * new. See `docs/task-specs/T1.md` and `docs/DECISIONS.md` D2.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

/** A `{type, id}` pointer, as it appears in `data` and in relationship linkage. */
export interface ResourceIdentifier {
  type: string;
  id: string;
}

export interface RelationshipEntry {
  name: string;
  /** `null` linkage (to-one, explicitly empty) is distinct from no linkage at all. */
  kind: "to-one" | "to-many" | "empty" | "no-linkage";
  targets: ResourceIdentifier[];
  links?: JsonObject;
  meta?: JsonObject;
}

export interface Resource {
  type: string;
  id: string;
  /** Stable `type:id` map key. */
  key: string;
  /** DOM id / URL fragment for this resource's section. */
  domId: string;
  /** Where the resource was found. Primary data is the document's subject. */
  origin: "data" | "included";
  /**
   * The resource object exactly as it appeared in the document. A reference,
   * not a copy — the parsed JSON is retained anyway because `attributes` and
   * friends point into it — so the raw view and "copy object" cost nothing.
   */
  raw: JsonObject;
  /**
   * RFC 6901 pointer to this resource from the document root, e.g. `/data/0`
   * or `/included/12`. Every pointer shown in the UI is built from this, which
   * makes them paste-compatible with JSON:API error `source.pointer` values.
   */
  pointer: string;
  attributes?: JsonObject;
  relationships: RelationshipEntry[];
  links?: JsonObject;
  meta?: JsonObject;
  /** True when a later duplicate `type:id` was folded into this one. */
  duplicated: boolean;
  /**
   * Pointers on this resource that resolve to nothing in this document.
   * Counted during the index pass so the collapsed row can flag it for free.
   */
  danglingCount: number;
}

export interface TypeGroup {
  type: string;
  resources: Resource[];
  /** Index into the curated hue ring, derived from the type name. */
  hue: number;
  sigil: string;
}

export interface JsonApiError {
  id?: string;
  status?: string;
  code?: string;
  title?: string;
  detail?: string;
  source?: JsonObject;
  links?: JsonObject;
  meta?: JsonObject;
}

export interface DocumentIndex {
  /**
   * The parsed document, kept so a JSON Pointer shown in the UI can be resolved
   * back to its value on demand. That is what lets every value row carry only a
   * pointer string instead of a copy of its own value.
   */
  root: JsonObject;
  /** O(1) relationship resolution: `type:id` -> resource. Built once at parse time. */
  byKey: Map<string, Resource>;
  /** Insertion-ordered groups; primary-data types first. */
  groups: TypeGroup[];
  /** Resource identifiers from `data`, in document order. */
  primary: ResourceIdentifier[];
  /** `data` was present and explicitly `null` (a valid empty to-one response). */
  primaryIsNull: boolean;
  errors: JsonApiError[];
  meta?: JsonObject;
  links?: JsonObject;
  jsonapi?: JsonObject;
  counts: {
    total: number;
    fromData: number;
    fromIncluded: number;
    duplicates: number;
    relationships: number;
    danglingPointers: number;
  };
  /** Distinct unresolvable pointers, for the orientation panel. */
  dangling: ResourceIdentifier[];
  /**
   * Reverse index: which resources point *at* a given `type:id`, and through
   * which relationship. JSON:API only encodes pointers one way, so "what
   * references this station?" is otherwise unanswerable without a manual scan.
   *
   * Built on first use rather than at parse time — see `referencesTo` — because
   * on a large document it is a meaningful amount of memory that is wasted if
   * nobody expands a resource.
   */
  reverse: Map<string, Reference[]> | null;
  /** True when the document has too many pointers for the reverse index to be worth building. */
  reverseTooLarge: boolean;
}

export interface Reference {
  from: Resource;
  relationship: string;
}

/* ==================================================================== *
 * Plain JSON — T1. `DocumentIndex` above is untouched by any of this.
 * ==================================================================== */

/**
 * What `detectShape` decided a document is. `jsonapi` is the one shape that
 * skips the paste-view offer and reads straight through, exactly as before
 * T1 existed; every other shape is read through `JsonIndex` below.
 */
export type Shape =
  | "jsonapi"
  | "hal"
  | "odata"
  | "jsonrpc"
  | "envelope"
  | "collection"
  | "ndjson"
  | "plain";

/**
 * Why `detectShape` chose what it chose, as data rather than a sentence —
 * `shape.ts` is pure and carries no English, the same discipline `format.ts`
 * and `ident.ts` already keep. The rendering layer turns one of these into a
 * localised string via `t().shape.evidence`.
 */
export type ShapeEvidence =
  | { kind: "jsonapi-member"; member: "data" | "errors" | "meta" }
  | { kind: "hal-links" }
  | { kind: "hal-embedded" }
  | { kind: "odata-context" }
  | { kind: "jsonrpc-member" }
  | { kind: "envelope-shape" }
  | { kind: "envelope-conflict" }
  | { kind: "collection-array"; length: number }
  | { kind: "ndjson-lines"; records: number; malformedLine: number | null }
  | { kind: "plain-empty-object" }
  | { kind: "plain-scalar" }
  | { kind: "plain-object" }
  | { kind: "plain-unparseable" };

export interface ShapeDetection {
  shape: Shape;
  evidence: ShapeEvidence;
  /**
   * The value to index: the parsed document for every shape but `ndjson`, an
   * array of records for `ndjson`. `undefined` — not `null` — only when
   * nothing at all could be read as JSON or as JSON Lines: `null` is itself a
   * legitimate parsed value (a bare `null` document), so it cannot also mean
   * "nothing parsed" without conflating the two. `detectShape` never throws,
   * so the caller that wants a message for the `undefined` case re-runs
   * `parseJson` for its own error.
   */
  value: JsonValue | undefined;
}

/**
 * An inferred collection: an array of two or more objects sharing a majority
 * of their key names (`json-index.ts` has the exact heuristic), or the one
 * bare top-level array a `collection`-shaped document is. Anchored, and so is
 * each of its members — see `docs/task-specs/T1.md`.
 */
export interface JsonCollection {
  /** JSON Pointer to the array itself — `/data/users`, or `""` for a bare top-level array. */
  pointer: string;
  /** Last non-index path segment, e.g. `users` — the display name and the string a `user_id`-style key is matched against. */
  label: string;
  /** Pointers to each member, in document order. */
  memberPointers: string[];
  domId: string;
  hue: number;
  sigil: string;
  /**
   * False when this collection is itself a member of another detected
   * collection. It still gets anchors — a nested collection's members are
   * addressable identity definitions — but not its own rail entry or group
   * section, so the rail lists one row per collection a person would
   * recognise rather than one per array in the document.
   */
  topLevel: boolean;
}

export type IdentityResolution = "resolved" | "ambiguous" | "dangling";

/** What a reference occurrence resolves to. Looked up per pointer at render time. */
export type IdentityReferenceInfo =
  | { resolution: "resolved"; targetPointer: string; targetDomId: string }
  | { resolution: "ambiguous"; candidates: number }
  | { resolution: "dangling" };

/**
 * What a definition occurrence is, keyed by the pointer of the object whose
 * identity it defines — not by the pointer of the `id`-like key itself, since
 * "clicking `user_id: 42` lands on the object that defines `id: 42`" means
 * the object, not the one attribute.
 */
export interface IdentityDefinitionInfo {
  domId: string;
  /** How many reference occurrences resolve here. Zero is normal — most ids are never referenced back. */
  referenceCount: number;
  /** True when this definition shares its scope and value with another — the ambiguous case. */
  ambiguous: boolean;
}

/** One (scope, value) identity — for the overview counts and for tests; not itself walked at render time. */
export interface IdentityCluster {
  scope: string;
  value: string;
  resolution: IdentityResolution;
  definitionPointers: string[];
  referencePointers: string[];
}

/** A referenced-but-never-defined (scope, value) pair — feeds the panel `renderDangling` already draws. */
export interface JsonDanglingEntry {
  scope: string;
  value: string;
  /** How many places reference it. */
  count: number;
}

export interface JsonCounts {
  /** Total collection members across every detected collection. */
  total: number;
  /** How many collections were found, at any depth. */
  collections: number;
  /** Distinct identities that resolved to exactly one definition. */
  resolved: number;
  /** Distinct identities with two or more definitions sharing a scope and value. */
  ambiguous: number;
  /** Distinct dangling (scope, value) pairs. */
  danglingDistinct: number;
  /** Every dangling reference occurrence, not de-duplicated. */
  danglingTotal: number;
}

/**
 * The index a plain-JSON (non-JSON:API) document builds to. Carries the
 * parsed root, the detected shape, the collections the rail reads, and the
 * inferred identity graph — value to where it is defined and where it is
 * referenced, resolved ahead of render time the same way `byKey` resolves
 * `DocumentIndex` relationships ahead of time.
 */
export interface JsonIndex {
  root: JsonValue;
  shape: Shape;
  shapeEvidence: ShapeEvidence;
  collections: JsonCollection[];
  identities: IdentityCluster[];
  referenceAt: Map<string, IdentityReferenceInfo>;
  definitionAt: Map<string, IdentityDefinitionInfo>;
  dangling: JsonDanglingEntry[];
  counts: JsonCounts;
  /**
   * True when the document exceeded the identity pass's node budget (see
   * `IDENTITY_NODE_LIMIT` in `json-index.ts`) — inference was skipped rather
   * than stalling, and the overview says so.
   */
  identitySkipped: boolean;
}

/**
 * What the view layer consumes. `jsonapi` is `DocumentIndex`, unchanged; the
 * JSON:API path is not touched by any of this. `json` is everything else,
 * from a bare scalar to a HAL document — see `docs/task-specs/T1.md`.
 */
export type Lens = { kind: "jsonapi"; index: DocumentIndex } | { kind: "json"; index: JsonIndex };
