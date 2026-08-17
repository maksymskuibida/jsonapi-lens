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
}
