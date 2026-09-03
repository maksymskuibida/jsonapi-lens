/**
 * Client-side encryption for share links.
 *
 * The secret is generated here, put in the share URL, and never sent to the
 * server in a request body — the Worker only ever receives ciphertext. The
 * document is gzipped first, which typically shrinks a JSON:API payload by an
 * order of magnitude, then sealed with AES-GCM (authenticated, so a tampered
 * blob fails to decrypt rather than decoding to garbage).
 *
 * ## Why the secret is short, and why that is still safe
 *
 * A link has to look like a link, so the secret is 10 base64url characters —
 * 60 bits — rather than a full 256-bit key written out as 43 characters.
 *
 * 60 bits on its own would not be enough. Share ids are sequential, so anyone
 * can enumerate the blobs, and from there the attack is offline: guess a
 * secret, try to decrypt. So the secret is not used as a key. It is stretched
 * into one with PBKDF2-HMAC-SHA256 over `KDF_ITERATIONS`, salted per share.
 * That costs the person opening the link about 200 ms once, and costs an
 * attacker the same per guess. Published PBKDF2-HMAC-SHA256 rates put a current
 * high-end GPU near 5.5 MH/s at 1,000 iterations, so ~5,500 guesses/second at
 * 1,000,000. Half of a 60-bit space is 5.8e17 guesses:
 *
 *   - one GPU:      ~3.3 million years
 *   - 10,000 GPUs:  ~330 years
 *
 * For comparison, using the 60-bit secret directly as a key — no stretching —
 * would put a single GPU at well under a day. The KDF is what makes a short
 * link viable at all.
 *
 * The salt is random per share and stored in the blob, so one table cannot be
 * precomputed against every share at once.
 *
 * If a shorter link ever matters more than that margin, `SECRET_CHARS` is the
 * one number to change; six characters (36 bits) would be breakable in days and
 * is deliberately not offered.
 *
 * A secret does not have to come from `generateSecret()`, though. T7's MCP
 * server lets an AI caller supply its own — a 64-character hex string from
 * `openssl rand -hex 32` — so every path here accepts any secret from
 * `MIN_SECRET_CHARS` to `MAX_SECRET_CHARS`, the same `[A-Za-z0-9_-]{8,64}`
 * range `SHARE_PATTERN` in `router.ts` already parses out of a URL. That
 * range is enforced again here, independently of the router, because a
 * caller like T7 never goes through the router at all — it calls `seal`
 * directly — and a blob this module is willing to produce must always be a
 * blob the app's own `/d/<id>:<secret>` route can open back up. A longer
 * secret is simply a stronger one through the same `deriveKey`; nothing about
 * the KDF changes.
 *
 * ## Wire format
 *
 * Versioned so a blob written by one build stays readable by the next, and so
 * an unrecognised version fails with a readable message instead of being
 * misread:
 *
 *     byte 0        format version (2 or 3)
 *     bytes 1-16    16-byte PBKDF2 salt
 *     bytes 17-28   96-bit AES-GCM IV
 *     bytes 29..    ciphertext with its 128-bit tag appended
 *
 * Versions 2 and 3 share every byte of that framing — salt size, IV size,
 * KDF, cipher — and differ only in what the decrypted, decompressed JSON
 * inside is expected to look like:
 *
 *   - **Version 2** is a `SharePayload`: one document, optionally carrying an
 *     `exchange`. This is what every share link minted before bundles existed
 *     already is, byte for byte, and it stays version 2 forever — a
 *     single-document share never has a reason to move. Read `open`'s branch
 *     for this version and it is unchanged from before bundles existed.
 *   - **Version 3** is a `BundlePayload`: several documents in one link. It is
 *     a new version, rather than an optional field on version 2, specifically
 *     so that a build which only knows version 2 refuses it cleanly (the
 *     existing wrong-version error) instead of misreading a payload with no
 *     `text` as a truncated document.
 *
 * Both shapes decrypt through the same key derivation and the same AES-GCM
 * call; only the JSON validation after decompression branches on the version
 * byte. `open` returns the right one of the two — the decrypted payload
 * declares its own kind, which is what lets `/d/<id>:<secret>` stay a single
 * route for both.
 */

import { t } from "./i18n/index.js";
import { formatBytes } from "./format.js";
import type { Exchange } from "./exchange.js";

const DOCUMENT_VERSION = 2;
const BUNDLE_VERSION = 3;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** Secret length in base64url characters. 10 chars = 60 bits. */
export const SECRET_CHARS = 10;

/**
 * The accepted range for a secret supplied to `seal`/`sealBundle`/`open`,
 * matching `SHARE_PATTERN` in `router.ts` exactly. `generateSecret()` always
 * produces `SECRET_CHARS` (10), well inside this range; the range itself
 * exists for secrets that arrive from outside this module, e.g. T7's
 * `openssl rand -hex 32` (64 characters — the exact upper bound).
 */
export const MIN_SECRET_CHARS = 8;
export const MAX_SECRET_CHARS = 64;

/**
 * PBKDF2 rounds. Measured at ~200 ms on a current desktop browser (600k took
 * 110-137 ms, so this is roughly double), and perhaps a second or two on an old
 * phone — a one-time cost when a link is created or opened, which the UI names
 * while it happens.
 */
const KDF_ITERATIONS = 1_000_000;

const SECRET_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Ciphertext size cap for a bundle, mirroring `MAX_BYTES` in `src/worker.ts`.
 *
 * Duplicated rather than imported because `worker.ts` runs on workerd and is
 * typechecked separately (`tsconfig.worker.json`) — it is not something client
 * code can import. The duplication is deliberate for a second reason, not just
 * a build boundary: the Worker enforces its cap on an opaque blob it can never
 * attribute to individual documents, so if a bundle's cap were enforced only
 * there, the failure could only ever say "too big", never "too big because of
 * these". Checking it here, before upload, is what lets the error name which
 * documents to drop. If `MAX_BYTES` in `worker.ts` ever changes, this must
 * change with it.
 */
export const MAX_BUNDLE_BYTES = 12 * 1024 * 1024;

/**
 * A `Uint8Array` explicitly backed by an `ArrayBuffer`.
 *
 * The default `Uint8Array` is generic over `ArrayBufferLike`, which includes
 * `SharedArrayBuffer` and so is not assignable to `BufferSource`. Pinning the
 * backing store here lets these buffers go straight into WebCrypto without a
 * defensive copy — which matters, because they hold whole documents.
 */
type Bytes = Uint8Array<ArrayBuffer>;

/**
 * What actually gets encrypted for a single document. Keeping the label
 * inside means the server never learns it.
 *
 * No `kind` field, deliberately: every version-2 blob ever sealed — including
 * every share link already in someone's chat history — was JSON.stringify'd
 * from an object shaped exactly like this, with no such property. Adding one
 * now would not change what those existing blobs decrypt to, but it would be
 * a wart applied only to the newer half of them, so `open` tells the two
 * payload shapes apart by the version byte instead, and `isBundlePayload`
 * below is how a caller holding the result of `open` tells them apart too.
 */
export interface SharePayload {
  text: string;
  label: string;
  savedAt: number;
  exchange?: Exchange;
}

/** One document inside a bundle. */
export interface BundleEntry {
  label: string;
  text: string;
  exchange?: Exchange;
  /**
   * Best-effort display summary, exactly as on `LibraryEntry` in `store.ts` —
   * absent when the lens that read the document (a plain-JSON reading, say)
   * has no such concept. Nothing in this module reads these fields; they ride
   * along for whichever view renders the bundle's contents.
   */
  resources?: number;
  types?: number;
  shape?: string;
}

/**
 * What actually gets encrypted for several documents at once, sealed at
 * envelope version 3. See the module header for why this is a new version
 * rather than a new field on `SharePayload`.
 */
export interface BundlePayload {
  kind: "bundle";
  savedAt: number;
  documents: BundleEntry[];
}

/** Does an opened payload carry several documents rather than one? */
export function isBundlePayload(payload: SharePayload | BundlePayload): payload is BundlePayload {
  return (payload as BundlePayload).kind === "bundle";
}

export class ShareError extends Error {
  readonly headline: string;
  readonly hint: string;

  constructor(headline: string, hint: string) {
    super(`${headline} ${hint}`);
    this.name = "ShareError";
    this.headline = headline;
    this.hint = hint;
  }
}

/* ------------------------------------------------------------ base64url --- */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  // Chunked so a large array cannot blow the argument limit on String.fromCharCode.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Bytes {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(binary.length)) as Bytes;
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------ secret ----- */

/**
 * A fresh share secret.
 *
 * The alphabet is exactly 64 characters, so masking a random byte to its low 6
 * bits maps uniformly onto it — no modulo bias, and no rejection loop.
 */
export function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SECRET_CHARS));
  let out = "";
  for (const byte of bytes) out += SECRET_ALPHABET[byte & 0x3f];
  return out;
}

/**
 * Refuse a secret outside `[MIN_SECRET_CHARS, MAX_SECRET_CHARS]`, before any
 * key derivation runs. Called from `deriveKey` so every seal and open path
 * gets it for free, and so an out-of-range secret fails in milliseconds
 * rather than after paying for 1,000,000 PBKDF2 iterations.
 */
function assertSecretLength(secret: string): void {
  if (secret.length < MIN_SECRET_CHARS || secret.length > MAX_SECRET_CHARS) {
    throw new ShareError(
      t().bundle.errors.secretLength.headline,
      t().bundle.errors.secretLength.hint(secret.length, MIN_SECRET_CHARS, MAX_SECRET_CHARS),
    );
  }
}

/* ------------------------------------------------------------ gzip ------- */

async function streamToBytes(stream: ReadableStream<Uint8Array>): Promise<Bytes> {
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer) as Bytes;
}

async function gzip(bytes: Bytes): Promise<Bytes> {
  const input = new Blob([bytes]).stream();
  return streamToBytes(input.pipeThrough(new CompressionStream("gzip")));
}

async function gunzip(bytes: Bytes): Promise<Bytes> {
  const input = new Blob([bytes]).stream();
  return streamToBytes(input.pipeThrough(new DecompressionStream("gzip")));
}

/* ------------------------------------------------------------ derive ----- */

/** Stretch a short secret into a real AES-256 key. */
async function deriveKey(secret: string, salt: Bytes): Promise<CryptoKey> {
  assertSecretLength(secret);

  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as Bytes,
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: KDF_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/* ------------------------------------------------------------ seal ------- */

/** The framing every version shares: version byte, salt, IV, then ciphertext. */
async function sealEnvelope(payload: unknown, version: number, secret: string): Promise<Bytes> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES)) as Bytes;
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES)) as Bytes;
  const key = await deriveKey(secret, salt);

  const encoded = new TextEncoder().encode(JSON.stringify(payload)) as Bytes;
  const compressed = await gzip(encoded);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, compressed),
  );

  const out = new Uint8Array(1 + SALT_BYTES + IV_BYTES + ciphertext.length) as Bytes;
  out[0] = version;
  out.set(salt, 1);
  out.set(iv, 1 + SALT_BYTES);
  out.set(ciphertext, 1 + SALT_BYTES + IV_BYTES);
  return out;
}

export async function seal(payload: SharePayload, secret: string): Promise<Bytes> {
  return sealEnvelope(payload, DOCUMENT_VERSION, secret);
}

/**
 * Seal several documents into one version-3 link.
 *
 * Refuses an empty bundle or an empty document before doing any crypto work —
 * discovering either after upload would be a worse failure than refusing to
 * mint the link at all. The size cap, by contrast, can only be checked after
 * sealing, because compression ratio is not knowable in advance: the common
 * case (under the cap) pays for one seal; the rare oversize case pays for a
 * second, cheaper pass — gzip alone, no key derivation — over each document
 * individually, purely to attribute blame in the error message.
 */
export async function sealBundle(payload: BundlePayload, secret: string): Promise<Bytes> {
  if (payload.documents.length === 0) {
    throw new ShareError(t().bundle.errors.empty.headline, t().bundle.errors.empty.hint);
  }
  for (const doc of payload.documents) {
    if (doc.text.length === 0) {
      throw new ShareError(
        t().bundle.errors.emptyDocument.headline,
        t().bundle.errors.emptyDocument.hint(doc.label),
      );
    }
  }

  const blob = await sealEnvelope(payload, BUNDLE_VERSION, secret);

  if (blob.byteLength > MAX_BUNDLE_BYTES) {
    const sizes = await Promise.all(
      payload.documents.map(async (doc) => ({
        label: doc.label,
        bytes: (await gzip(new TextEncoder().encode(doc.text) as Bytes)).byteLength,
      })),
    );
    sizes.sort((a, b) => b.bytes - a.bytes);
    const offenders = sizes.map((s) => `${s.label} (${formatBytes(s.bytes)})`).join(", ");
    throw new ShareError(
      t().bundle.errors.tooLarge.headline,
      t().bundle.errors.tooLarge.hint(
        formatBytes(MAX_BUNDLE_BYTES),
        formatBytes(blob.byteLength - MAX_BUNDLE_BYTES),
        offenders,
      ),
    );
  }

  return blob;
}

/* ------------------------------------------------------------ open ------- */

const HEADER_BYTES = 1 + SALT_BYTES + IV_BYTES;

/** Structural check that decrypted, decompressed JSON is actually a bundle. */
function isBundleShape(value: unknown): value is BundlePayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<BundlePayload>;
  return (
    candidate.kind === "bundle" &&
    typeof candidate.savedAt === "number" &&
    Array.isArray(candidate.documents) &&
    candidate.documents.every(
      (doc) => typeof doc === "object" && doc !== null && typeof doc.label === "string" && typeof doc.text === "string",
    )
  );
}

export async function open(blob: Bytes, secret: string): Promise<SharePayload | BundlePayload> {
  if (blob.length < HEADER_BYTES + 16) {
    throw new ShareError(t().shareErrors.corruptShort.headline, t().shareErrors.corruptShort.hint);
  }

  const version = blob[0];
  // Checked before any key derivation, deliberately: an unrecognised version —
  // 3 fed to a build that only ever knew 2, or anything neither of us knows —
  // fails with the same readable message either way, and fails before paying
  // for a KDF that could not have helped.
  if (version !== DOCUMENT_VERSION && version !== BUNDLE_VERSION) {
    throw new ShareError(
      t().shareErrors.wrongVersion.headline,
      t().shareErrors.wrongVersion.hint(version ?? 0, BUNDLE_VERSION),
    );
  }

  const salt = blob.subarray(1, 1 + SALT_BYTES);
  const iv = blob.subarray(1 + SALT_BYTES, HEADER_BYTES);
  const ciphertext = blob.subarray(HEADER_BYTES);

  const key = await deriveKey(secret, salt as Bytes);

  let compressed: Bytes;
  try {
    compressed = new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext),
    ) as Bytes;
  } catch {
    // AES-GCM is authenticated, so this is either the wrong secret or a
    // tampered blob — there is no way to tell them apart, and no need to.
    throw new ShareError(
      t().shareErrors.undecryptable.headline,
      t().shareErrors.undecryptable.hint,
    );
  }

  let text: string;
  try {
    text = new TextDecoder().decode(await gunzip(compressed));
  } catch {
    throw new ShareError(
      t().shareErrors.corruptDeflate.headline,
      t().shareErrors.corruptDeflate.hint,
    );
  }

  if (version === BUNDLE_VERSION) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ShareError(t().bundle.errors.corrupt.headline, t().bundle.errors.corrupt.hint);
    }
    if (!isBundleShape(parsed)) {
      throw new ShareError(t().bundle.errors.corrupt.headline, t().bundle.errors.corrupt.hint);
    }
    return parsed;
  }

  // Version 2, unchanged from before bundles existed: a bundle has no `text`
  // field, which is exactly why it is a different version rather than a
  // shape this same check would have to also accept.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ShareError(t().shareErrors.corruptPayload.headline, t().shareErrors.corruptPayload.hint);
  }
  if (typeof (parsed as Partial<SharePayload> | null)?.text !== "string") {
    throw new ShareError(
      t().shareErrors.corruptPayload.headline,
      t().shareErrors.corruptPayload.hint,
    );
  }
  return parsed as SharePayload;
}

/** Is the browser capable of the share feature at all? */
export function shareSupported(): boolean {
  return (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof CompressionStream !== "undefined"
  );
}
