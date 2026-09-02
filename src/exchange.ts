/**
 * Placeholder for T2's captured-request/response model.
 *
 * T5 (storage and the share envelope) needs a type to hang an optional
 * `exchange` field off of a stored document, a library entry, a share payload
 * and a bundle entry — but the actual shape of a captured HTTP exchange (the
 * request, the response, redactions, everything T2's field-separated form
 * edits) is T2's design, not T5's. T5 must not block on T2 landing first, so
 * this module exists purely to give every T5 type something concrete to name.
 *
 * `Exchange` is declared here as an opaque, structurally-typed payload: it is
 * `unknown` to every reader in this file's sense, in that nothing in T5's code
 * — `store.ts`, `crypto.ts`, `share.ts` — ever looks inside one. Each only
 * stores it, seals it, opens it, or copies it from one shape to another,
 * whole. Because it is a plain index signature, any object literal T2 later
 * constructs satisfies it without a cast, and JSON.parse's output satisfies it
 * too, which is what lets a sealed/opened exchange round-trip with no
 * validation logic to keep in step.
 *
 * T2 replaces the body of this file with its real interface — request, response,
 * masking state, whatever it needs — once its design lands. Every module that
 * only carries the field forward (rather than reading a specific property off
 * it) keeps compiling unchanged when that happens, because the places that
 * assumed a shape beyond "some object" were never here.
 */
export interface Exchange {
  readonly [key: string]: unknown;
}
