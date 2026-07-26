// Secret cipher for API keys at rest (Fase 5-A).
//
// The OpenRouter API key was stored in PLAINTEXT in the Settings row. On the
// desktop build the SQLite file lives in %APPDATA%\AIzea, so anyone who opens
// db.sqlite reads the key verbatim. This module encrypts it at rest with
// AES-256-GCM and a self-describing, versioned envelope.
//
// THREAT MODEL (be honest): this protects against casual inspection of the DB
// file and accidental leakage (backups, support bundles, screen shares). It is
// NOT a defense against an attacker who already has BOTH the app binary and
// the machine — a local desktop app must be able to decrypt its own secret to
// use it, so the key-derivation material ships with/near the app. True secret
// isolation would need an OS keychain (future work). Encryption-at-rest here
// is a real, proportionate improvement over plaintext.
//
// Envelope format (self-describing, so decrypt is backward-compatible with
// legacy plaintext rows — lazy migration, no data-loss risk):
//   enc:v1:<base64url(iv)>:<base64url(authTag)>:<base64url(ciphertext)>
// Any value NOT starting with "enc:v1:" is treated as legacy plaintext and
// returned as-is by `decryptSecret` (and re-encrypted next time it is saved).

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
// Static, non-secret salt: the derivation secret is the actual protection.
// A per-install random salt would need its own at-rest storage (chicken/egg),
// so a fixed salt is the pragmatic choice for a local desktop app.
const SCRYPT_SALT = "aizea.secret.cipher.v1";

/**
 * Resolve the master secret used to derive the encryption key. Precedence:
 *   1. `AIZEA_SECRET_KEY` env var (set by the Tauri supervisor / deployment).
 *   2. A stable fallback constant so the app still encrypts (better than
 *      plaintext) even when no env secret is configured. Documented as weak.
 */
export function resolveMasterSecret(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.AIZEA_SECRET_KEY;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  // Fallback: constant tied to the app identifier. Weaker (ships with the
  // binary) but still removes plaintext keys from the DB file.
  return "com.aizea.app::default-at-rest-secret";
}

function deriveKey(masterSecret: string): Buffer {
  return scryptSync(masterSecret, SCRYPT_SALT, KEY_BYTES);
}

/** True when a stored value is in the encrypted envelope format. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Encrypt a plaintext secret into the versioned envelope. Returns the input
 * unchanged if it is empty (nothing to protect) or already encrypted
 * (idempotent — avoids double-wrapping on re-save).
 */
export function encryptSecret(
  plaintext: string,
  options: { masterSecret?: string } = {}
): string {
  if (plaintext.length === 0) return plaintext;
  if (isEncrypted(plaintext)) return plaintext;

  const key = deriveKey(options.masterSecret ?? resolveMasterSecret());
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return (
    PREFIX +
    [iv, authTag, ciphertext].map((b) => b.toString("base64url")).join(":")
  );
}

/**
 * Decrypt an envelope back to plaintext. Backward-compatible: a value that is
 * NOT in envelope format is assumed to be legacy plaintext and returned as-is.
 * Throws only when a well-formed envelope fails authentication (tampering or
 * wrong key) — callers decide whether to surface or swallow.
 */
export function decryptSecret(
  stored: string,
  options: { masterSecret?: string } = {}
): string {
  if (!isEncrypted(stored)) return stored; // legacy plaintext
  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    throw new Error("Envelope cifrado malformado.");
  }
  const [ivB64, tagB64, ctB64] = parts;
  const key = deriveKey(options.masterSecret ?? resolveMasterSecret());
  const iv = Buffer.from(ivB64, "base64url");
  const authTag = Buffer.from(tagB64, "base64url");
  const ciphertext = Buffer.from(ctB64, "base64url");

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
