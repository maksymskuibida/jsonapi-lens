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
 * ## Wire format
 *
 * Versioned so a blob written by one build stays readable by the next:
 *
 *     byte 0        format version (2)
 *     bytes 1-16    16-byte PBKDF2 salt
 *     bytes 17-28   96-bit AES-GCM IV
 *     bytes 29..    ciphertext with its 128-bit tag appended
 */

import { t } from "./i18n/index.js";

const VERSION = 2;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** Secret length in base64url characters. 10 chars = 60 bits. */
export const SECRET_CHARS = 10;

/**
 * PBKDF2 rounds. Measured at ~200 ms on a current desktop browser (600k took
 * 110-137 ms, so this is roughly double), and perhaps a second or two on an old
 * phone — a one-time cost when a link is created or opened, which the UI names
 * while it happens.
 */
const KDF_ITERATIONS = 1_000_000;

const SECRET_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * A `Uint8Array` explicitly backed by an `ArrayBuffer`.
 *
 * The default `Uint8Array` is generic over `ArrayBufferLike`, which includes
 * `SharedArrayBuffer` and so is not assignable to `BufferSource`. Pinning the
 * backing store here lets these buffers go straight into WebCrypto without a
 * defensive copy — which matters, because they hold whole documents.
 */
type Bytes = Uint8Array<ArrayBuffer>;

/** What actually gets encrypted. Keeping the label inside means the server never learns it. */
export interface SharePayload {
  text: string;
  label: string;
  savedAt: number;
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

export async function seal(payload: SharePayload, secret: string): Promise<Bytes> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES)) as Bytes;
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES)) as Bytes;
  const key = await deriveKey(secret, salt);

  const encoded = new TextEncoder().encode(JSON.stringify(payload)) as Bytes;
  const compressed = await gzip(encoded);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, compressed),
  );

  const out = new Uint8Array(1 + SALT_BYTES + IV_BYTES + ciphertext.length) as Bytes;
  out[0] = VERSION;
  out.set(salt, 1);
  out.set(iv, 1 + SALT_BYTES);
  out.set(ciphertext, 1 + SALT_BYTES + IV_BYTES);
  return out;
}

const HEADER_BYTES = 1 + SALT_BYTES + IV_BYTES;

export async function open(blob: Bytes, secret: string): Promise<SharePayload> {
  if (blob.length < HEADER_BYTES + 16) {
    throw new ShareError(t().shareErrors.corruptShort.headline, t().shareErrors.corruptShort.hint);
  }
  if (blob[0] !== VERSION) {
    throw new ShareError(
      t().shareErrors.wrongVersion.headline,
      t().shareErrors.wrongVersion.hint(blob[0] ?? 0, VERSION),
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

  const parsed = JSON.parse(text) as SharePayload;
  if (typeof parsed?.text !== "string") {
    throw new ShareError(
      t().shareErrors.corruptPayload.headline,
      t().shareErrors.corruptPayload.hint,
    );
  }
  return parsed;
}

/** Is the browser capable of the share feature at all? */
export function shareSupported(): boolean {
  return (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof CompressionStream !== "undefined"
  );
}
