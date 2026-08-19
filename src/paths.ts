/**
 * The paths this site answers on, and nothing else.
 *
 * `src/router.ts` is where routing lives and it re-exports all four, so the app
 * keeps importing them from there. They are declared here because the Worker
 * needs them too — to map `?lang=` onto a prerendered file — and the Worker is
 * typechecked against workerd's globals with no DOM lib, so it cannot import a
 * module that touches `location` or `history`.
 */

export const PASTE_PATH = "/";
export const VIEW_PATH = "/view";
export const IMPRESSUM_PATH = "/impressum";
export const PRIVACY_PATH = "/privacy";
