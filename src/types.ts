/** Minimal structural types for the parts of JSON:API this viewer reads. */

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
