/**
 * The tool descriptions, kept in their own module because they are the one
 * part of this server a calling model actually reads.
 *
 * `docs/task-specs/T7.md` requires the URL-building instruction to live *in
 * the registered `share` description*, not only in `mcp/README.md` — a model
 * never reads the README. A test asserts this by reading the registered
 * schema (`client.listTools()`), not these source comments, so the wording
 * below is the wording that ships, not a paraphrase of it.
 */

import { GENERATE_SECRET_COMMAND } from "./validate.js";

export const SHARE_DESCRIPTION = [
  "Seal one or more documents into an encrypted jsonapi-lens share link and upload the ciphertext. " +
    "One document becomes a single-document link; several become a bundle link that opens all of " +
    "them together. The server stores only ciphertext, a byte count and an expiry — it never sees " +
    "the plaintext or the secret.",
  `Generate the secret yourself before calling this, with \`${GENERATE_SECRET_COMMAND}\`. Keep it — ` +
    "it is not recoverable from the id, and the server cannot decrypt without it. The link is " +
    "`<origin>/d/<id>:<secret>`, for example `https://jsonapi.mstool.dev/d/412:a1b2…`. Anyone " +
    "with that link can read the document; anyone with only the id cannot.",
].join("\n\n");

export const READ_DESCRIPTION = [
  "Fetch and decrypt a jsonapi-lens share link given its id and secret, and return the document " +
    "text exactly as it was shared — or, for a link that carries several documents (a bundle), " +
    "every document in it. No parsing, indexing or reshaping happens here.",
  "Use the secret exactly as it appears in the link — `<origin>/d/<id>:<secret>` — whatever its " +
    "shape. Most links were minted by jsonapi-lens's own Share button, whose secret is 10 " +
    "mixed-case letters and digits; never generate a secret to call this tool, and never assume a " +
    "fixed length or alphabet — it is not recoverable from the id alone, only from the link " +
    "itself. A wrong secret and a corrupted or tampered blob fail identically and deliberately — " +
    "this tool cannot tell you which one happened, because telling them apart would help someone " +
    "guess the secret.",
].join("\n\n");
