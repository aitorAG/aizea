# Security and distribution

[◄ Index](./README.md) · Previous: [Testing](./README.TESTING.md)

Secret encryption, content policy, and installer signing.

---

## API key encryption at rest

The OpenRouter API key is stored **encrypted** in the `Settings` row (it was previously plaintext). Module: [`lib/infrastructure/crypto/secret-cipher.ts`](./lib/infrastructure/crypto/secret-cipher.ts).

- **Algorithm:** AES-256-GCM, with a key derived using scrypt.
- **Self-describing versioned envelope:** `enc:v1:<iv>:<tag>:<ciphertext>` (base64url).
- **Backward-compatible:** a value without the `enc:v1:` prefix is treated as legacy plaintext and returned as-is (lazy migration, without breaking existing keys). It is re-encrypted on the next save.
- **Idempotent:** encrypting an already encrypted value is a no-op; the auth tag detects tampering or an incorrect key.

### Where encryption/decryption occurs

| Location | Action |
|---|---|
| `PrismaSettingsRepository.upsert` | **Encrypts** before writing to the DB |
| `PrismaSettingsRepository.get` | **Decrypts** when reading |
| `config-service.readDbSettings` | **Decrypts** (this path reads `db` directly, without going through the repository) |

### Master secret

`resolveMasterSecret` uses `AIZEA_SECRET_KEY` (env) when present; otherwise it uses a constant fallback (documented as weaker).

> **Honest threat model:** protects against casual inspection of `db.sqlite`, backups, and accidental leaks. It **does not** isolate the secret from an attacker with the binary and the machine (a local app must be able to decrypt its own secret). True isolation would require the OS keychain (future work). Even so, this is a real and proportionate improvement over plaintext.

---

## Content-Security-Policy and headers

The Tauri window loads `http://localhost:1422` (content served by **Next over HTTP**), not Tauri's asset protocol. Therefore, the CSP is delivered as **Next HTTP response headers**, configured in [`next.config.ts`](./next.config.ts) (`async headers()`).

Directives (env-aware):

- `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`
- `script-src 'self' 'unsafe-inline'` (Next injects inline bootstrap; `'unsafe-eval'` only in dev for React Refresh)
- `connect-src 'self'` (calls to OpenRouter/docling are server-side Node→external, not browser→external; `ws:` is added in dev for HMR)

Additional headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.

---

## Backend supervision (desktop)

The Rust launcher ([`src-tauri/src/lib.rs`](./src-tauri/src/lib.rs)) supervises the Node sidecar:

- **Spawn + restart** with backoff (up to 5 consecutive failures).
- **Logs** stdout/stderr to `%APPDATA%\AIzea\logs\server.log`.
- **Health poll** of `/api/health` (instead of a blind `sleep`) before opening the window.

These helpers are gated by `not(debug_assertions)` → validate them with `cargo check --release`.

---

<a id="installer-signing-and-auto-updater"></a>
## Installer signing and auto-updater

**Not included** (deliberate decision). The project is for personal/non-commercial use, so the signed auto-updater and code signing were **removed entirely** so that `pnpm build:msi` completes cleanly without requiring keys or certificates.

- The installer (`.msi`/`.exe`) is **unsigned**: when installed, Windows SmartScreen displays an "unknown publisher" warning that must be accepted manually. This is expected and does not affect operation.
- **There is no auto-update**: rebuild and reinstall to update.

If commercial distribution is needed in the future, `tauri-plugin-updater`, an **Authenticode certificate** from a CA (DigiCert/Sectigo), a **signing key** (`TAURI_SIGNING_PRIVATE_KEY`) as a CI secret, and a **release endpoint** would need to be added again. That is not the case today.

---

## Contribution best practices

- Do not commit `.env`, keys, or `db.sqlite` containing real data.
- Treat PDF/LLM output as untrusted input (validate at boundaries).
- Do not expose secret values in logs (refer to them by key name).

---

[◄ Back to index](./README.md)
