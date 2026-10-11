# Security and distribution

[◄ Index](./README.md) · Previous: [Testing](./README.TESTING.md)

Secret encryption, content policy, and installer signing.

---

## API-key encryption at rest

The OpenRouter API key is stored **encrypted** in the `Settings` row (it was previously plaintext). Module: [`lib/infrastructure/crypto/secret-cipher.ts`](./lib/infrastructure/crypto/secret-cipher.ts).

- **Algoritmo:** AES-256-GCM, clave derivada con scrypt.
- **Envelope versionado autodescriptivo:** `enc:v1:<iv>:<tag>:<ciphertext>` (base64url).
- **Backward-compatible:** a value without the `enc:v1:` prefix is treated as legacy plaintext and returned as-is (lazy migration without breaking existing keys). It is re-encrypted on the next save.
- **Idempotent:** encrypting an already encrypted value is a no-op; the auth tag detects tampering or an incorrect key.

### Where encryption/decryption occurs (3 points)

| Location | Action |
|---|---|
| `PrismaSettingsRepository.upsert` | **Cifra** antes de escribir en la DB |
| `PrismaSettingsRepository.get` | **Descifra** al leer |
| `config-service.readDbSettings` | **Descifra** (este camino lee `db` directo, sin pasar por el repo) |

### Master secret

`resolveMasterSecret` uses `AIZEA_SECRET_KEY` (env) if present; otherwise, a constant fallback (documented as weaker).

> **Honest threat model:** protects against casual inspection of `db.sqlite`, backups, and accidental leaks. It does **not** isolate the secret from an attacker with the binary and machine (a local app must be able to decrypt its own secret). True isolation would require the OS keychain (future work). Even so, this is a real and proportionate improvement over plaintext.

---

## Content Security Policy and headers

The Tauri window loads `http://localhost:1422` (content served by **Next over HTTP**), not Tauri's asset protocol. Therefore CSP is delivered as **Next HTTP response headers**, configured in [`next.config.ts`](./next.config.ts) (`async headers()`).

Directivas (env-aware):

- `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`
- `script-src 'self' 'unsafe-inline'` (Next inyecta bootstrap inline; `'unsafe-eval'` solo en dev para React Refresh)
- `connect-src 'self'` (calls to OpenRouter/Docling are server-side Node-to-external, not browser-to-external; `ws:` is added in dev for HMR)

Cabeceras adicionales: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.

---

## Backend supervision (desktop)

El lanzador Rust ([`src-tauri/src/lib.rs`](./src-tauri/src/lib.rs)) supervisa el sidecar Node:

- **Spawn + reinicio** con backoff (hasta 5 fallos consecutivos).
- **Logs** de stdout/stderr a `%APPDATA%\AIzea\logs\server.log`.
- **Health-poll** de `/api/health` (en vez de un `sleep` ciego) antes de abrir la ventana.

These helpers are gated by `not(debug_assertions)` → they are validated with `cargo check --release`.

---

## Installer signing and auto-updater

**Not included** (deliberate decision). The project is for personal/non-commercial use, so the signed auto-updater and code signing were **removed entirely** so `pnpm build:msi` completes cleanly without keys or certificates.

- The installer (`.msi`/`.exe`) is **not signed**: Windows SmartScreen will show an "unknown publisher" warning during installation, which must be accepted manually. This is expected and does not affect operation.
- **There is no auto-update**: rebuild and reinstall to update.

If commercial distribution were desired in the future, `tauri-plugin-updater`, an **Authenticode certificate** from a CA (DigiCert/Sectigo), a **signing key** (`TAURI_SIGNING_PRIVATE_KEY`) as a CI secret, and a **release endpoint** would need to be added again. That is not the case today.

---

## Contribution best practices

- Do not commit `.env`, keys, or `db.sqlite` containing real data.
- Treat PDF/LLM output as untrusted input (validate at boundaries).
- No exponer valores de secretos en logs (referenciar por nombre de clave).

---

[◄ Back to index](./README.md)
