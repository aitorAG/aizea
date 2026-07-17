/**
 * genId — universally-available ID generator.
 *
 * The Web Crypto `crypto.randomUUID()` API is only exposed in *secure
 * contexts* (HTTPS, `http://localhost`, or `http://127.0.0.1`). When the
 * user accesses the app via a plain network IP such as
 * `http://192.168.1.42:3000` the browser refuses to expose the method
 * and any call throws `TypeError: crypto.randomUUID is not a function`.
 *
 * To keep the rest of the client code blissfully unaware of that edge
 * case, we centralize ID generation here. We try the native API first
 * and fall back to a Math.random-based UUID v4 shim when it is not
 * available. The fallback is good enough for client-side identifiers
 * (toast keys, draft IDs, optimistic UI keys) — these never participate
 * in cryptographic decisions, they only have to be unique within the
 * current page session.
 *
 * NOTE: do NOT use the output of this function as a security token.
 */
export function genId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  // Fallback UUID v4 — RFC 4122 compliant shape, version and variant
  // nibbles preserved. Math.random is fine for non-cryptographic IDs.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
