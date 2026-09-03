/**
 * Builds the `McpServer` and registers `share`/`read` on it.
 *
 * Kept separate from `server.ts` (the stdio entry point) so a test can build
 * one of these, connect it to an `InMemoryTransport`, and drive it with a
 * real `Client` — the mechanism `docs/task-specs/T7.md` requires for reading
 * back the *registered* tool descriptions, rather than trusting these source
 * comments.
 *
 * `fetchImpl` is required, with no default — see `mcp/transport.ts`'s header
 * comment for why. Every network call this server makes goes through it.
 *
 * `./locale.js` is imported first, for its side effect, rather than trusting
 * `server.ts` to have done it already: this module is the thing
 * `docs/test-plans/T7.md` documents building directly (`createMcpServer`),
 * and a test or a future caller that does so without going through
 * `server.ts` must not silently fall back to whatever locale the host
 * happens to negotiate. Importing it here too costs nothing — the module
 * itself is idempotent — and means the pin travels with the code that
 * depends on it, not with one particular entry point into that code.
 */
import "./locale.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { isBundlePayload, MAX_BUNDLE_BYTES, open, seal, sealBundle } from "../src/crypto.js";
import type { BundleEntry, BundlePayload, SharePayload } from "../src/crypto.js";

import { READ_DESCRIPTION, SHARE_DESCRIPTION } from "./descriptions.js";
import { fetchShareBlob, uploadShare } from "./transport.js";
import type { FetchLike } from "./transport.js";
import {
  assertReadSecret,
  assertShareableDocuments,
  assertShareSecret,
  assertSingleDocumentWithinCap,
  assertValidLifetime,
  assertValidOrigin,
  DEFAULT_LIFETIME,
  DEFAULT_ORIGIN,
  GENERATE_SECRET_COMMAND,
  LIFETIME_KEYS,
} from "./validate.js";

/** See `src/crypto.ts`'s own `Bytes` — not exported, so restated here rather
 * than widened at the import boundary. Pins the backing store to a real
 * `ArrayBuffer`, which is what `seal`/`sealBundle`/`open` require. */
type Bytes = Uint8Array<ArrayBuffer>;

export interface McpServerDeps {
  /** The only thing this server ever calls to reach the network. */
  fetchImpl: FetchLike;
  /** Used when a call omits `origin`. Defaults to the production deployment. */
  defaultOrigin?: string;
}

const exchangeShape = z.record(z.string(), z.unknown());

const documentInputSchema = z.object({
  label: z.string().describe("A short display name for this document, e.g. a filename."),
  text: z.string().describe("The document's raw text, returned verbatim by `read`."),
  exchange: exchangeShape
    .optional()
    .describe("Optional captured HTTP exchange to attach to this document."),
});

/** Every field below carries the actual business rule in `mcp/validate.ts`
 * rather than in the schema — a caller gets one uniform, precisely-worded
 * refusal for `documents: []`, a bad secret, an unknown lifetime or a path-
 * carrying origin, instead of zod's generic "invalid enum value" for some of
 * those and a hand-written message for the rest. */
const shareInputShape = {
  documents: z
    .array(documentInputSchema)
    .describe(
      "One or more documents to share. One document seals a single-document link; several seal a bundle.",
    ),
  secret: z
    .string()
    .describe(
      `64-character lowercase hex, generated with \`${GENERATE_SECRET_COMMAND}\` — never by this tool.`,
    ),
  lifetime: z
    .string()
    .optional()
    .describe(`One of: ${LIFETIME_KEYS.join(", ")}. Defaults to "${DEFAULT_LIFETIME}".`),
  origin: z
    .string()
    .optional()
    .describe("Which jsonapi-lens deployment to upload to. An origin only — no path or query."),
};

const shareOutputShape = {
  id: z.number().describe("The share's numeric id."),
  url: z.string().describe("The full link: `<origin>/d/<id>:<secret>`."),
  expiresAt: z.union([z.number(), z.null()]).describe("Epoch milliseconds, or null for no expiry."),
  bytes: z.number().describe("The ciphertext size actually uploaded."),
  kind: z.enum(["document", "bundle"]),
};

const readInputShape = {
  // .int().positive() refuses "1.5" or "1e21" locally, with a readable zod
  // message, instead of interpolating it into a path and reporting whatever
  // came back ("gone or never existed") for a value that was never going to
  // exist in the first place.
  id: z.number().int().positive().describe("The numeric id from a share link's `<origin>/d/<id>:<secret>`."),
  secret: z.string().describe("The secret half of the same link."),
  origin: z.string().optional().describe("Which jsonapi-lens deployment to read from."),
};

/**
 * Deliberately one flat object rather than a `kind`-discriminated union.
 * (`label`/`text` populated for `kind: "document"`; `documents` populated for
 * `kind: "bundle"`.) The SDK's output-schema validator normalises a plain
 * object schema directly but does not fall back to validating a union
 * schema as-is the way tool *input* validation does — passing a union here
 * would make every successful `read` call fail output validation with a
 * confusing internal error instead of returning the document. Filed as a
 * limitation of `@modelcontextprotocol/sdk`, not worked around by weakening
 * validation: this shape is fully and correctly validated, just not typed as
 * a union.
 */
const readOutputShape = {
  kind: z.enum(["document", "bundle"]),
  savedAt: z.number().describe("When the share was sealed, epoch milliseconds."),
  label: z.string().optional().describe('Present when kind is "document".'),
  text: z.string().optional().describe('Present when kind is "document".'),
  exchange: exchangeShape.optional().describe('Present when kind is "document" and one was attached.'),
  documents: z
    .array(
      z.object({
        label: z.string(),
        text: z.string(),
        exchange: exchangeShape.optional(),
      }),
    )
    .optional()
    .describe('Present when kind is "bundle" — every document in it, never just the first.'),
};

export function createMcpServer(deps: McpServerDeps): McpServer {
  const { fetchImpl } = deps;
  const configuredOrigin = deps.defaultOrigin ?? DEFAULT_ORIGIN;

  const server = new McpServer({ name: "jsonapi-lens", version: "1.0.0" });

  server.registerTool(
    "share",
    {
      title: "Share documents via jsonapi-lens",
      description: SHARE_DESCRIPTION,
      inputSchema: shareInputShape,
      outputSchema: shareOutputShape,
    },
    async ({ documents, secret, lifetime, origin }) => {
      const resolvedOrigin = assertValidOrigin(origin ?? configuredOrigin);
      const resolvedLifetime = lifetime ?? DEFAULT_LIFETIME;
      assertValidLifetime(resolvedLifetime);
      assertShareSecret(secret);
      assertShareableDocuments(documents);

      const savedAt = Date.now();
      let blob: Bytes;
      let kind: "document" | "bundle";

      if (documents.length === 1) {
        const [doc] = documents as [(typeof documents)[number]];
        const payload: SharePayload = {
          text: doc.text,
          label: doc.label,
          savedAt,
          ...(doc.exchange !== undefined ? { exchange: doc.exchange } : {}),
        };
        blob = await seal(payload, secret);
        assertSingleDocumentWithinCap(blob, doc.label);
        kind = "document";
      } else {
        const entries: BundleEntry[] = documents.map((doc) => ({
          label: doc.label,
          text: doc.text,
          ...(doc.exchange !== undefined ? { exchange: doc.exchange } : {}),
        }));
        const payload: BundlePayload = { kind: "bundle", savedAt, documents: entries };
        // sealBundle refuses an empty bundle/empty document itself too, but
        // assertShareableDocuments above already ran, before any crypto work.
        blob = await sealBundle(payload, secret);
        kind = "bundle";
      }

      const created = await uploadShare(fetchImpl, resolvedOrigin, blob, resolvedLifetime);
      const url = `${resolvedOrigin}/d/${created.id}:${secret}`;

      const structuredContent = {
        id: created.id,
        url,
        expiresAt: created.expiresAt,
        bytes: blob.byteLength,
        kind,
      };

      return {
        structuredContent,
        // Deliberately does not repeat `url` (or the secret it carries) here
        // — "no result field other than `url` contains the secret" means
        // this text field too. `structuredContent.url` is the one place to
        // read it back from.
        content: [
          {
            type: "text" as const,
            text:
              `Shared ${documents.length === 1 ? "1 document" : `${documents.length} documents`} ` +
              `as a ${kind} link (id ${created.id}, ${blob.byteLength} bytes). ` +
              "The link, with the secret, is in this result's `url` field.",
          },
        ],
      };
    },
  );

  server.registerTool(
    "read",
    {
      title: "Read a jsonapi-lens share link",
      description: READ_DESCRIPTION,
      inputSchema: readInputShape,
      outputSchema: readOutputShape,
    },
    async ({ id, secret, origin }) => {
      const resolvedOrigin = assertValidOrigin(origin ?? configuredOrigin);
      assertReadSecret(secret);

      const blob = await fetchShareBlob(fetchImpl, resolvedOrigin, id);
      const payload = await open(blob, secret);

      if (isBundlePayload(payload)) {
        const structuredContent = {
          kind: "bundle" as const,
          savedAt: payload.savedAt,
          documents: payload.documents.map((doc) => ({
            label: doc.label,
            text: doc.text,
            ...(doc.exchange !== undefined ? { exchange: doc.exchange } : {}),
          })),
        };
        return {
          structuredContent,
          content: [
            {
              type: "text" as const,
              text: `Bundle of ${payload.documents.length} document(s).`,
            },
          ],
        };
      }

      const structuredContent = {
        kind: "document" as const,
        label: payload.label,
        savedAt: payload.savedAt,
        text: payload.text,
        ...(payload.exchange !== undefined ? { exchange: payload.exchange } : {}),
      };
      return {
        structuredContent,
        content: [{ type: "text" as const, text: `Document "${payload.label}".` }],
      };
    },
  );

  return server;
}

/** Re-exported for callers (and tests) that want the cap without importing
 * `src/crypto.ts` directly. */
export { MAX_BUNDLE_BYTES };
