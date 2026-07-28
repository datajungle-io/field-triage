import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for the Salesforce access token at rest.
 *
 * The token has to survive between tick invocations, so it can't live in a cookie
 * or in memory — it goes in the scans row. Encrypting it means a database dump
 * alone doesn't yield working org credentials. It is wiped and revoked upstream
 * at Salesforce as soon as the scan finishes (or the reaper gives up on it), so
 * the window in which this ciphertext means anything is minutes.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32",
    );
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length}. Generate one with: openssl rand -base64 32`,
    );
  }
  return buf;
}

/** Returns `iv.ciphertext.authTag`, all base64url. */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    iv.toString("base64url"),
    enc.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function decryptToken(payload: string): string {
  const [ivB64, dataB64, tagB64] = payload.split(".");
  if (!ivB64 || !dataB64 || !tagB64) {
    throw new Error("Malformed encrypted token payload");
  }
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Report permalink segment. 32 bytes of entropy — this token is the only thing
 * standing between a URL and someone's org metadata, so it must never be derived
 * from anything guessable (a uuid, a timestamp, the org id).
 */
export function newScanToken(): string {
  return randomBytes(32).toString("base64url");
}
