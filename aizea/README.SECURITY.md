# Seguridad y distribución

[◄ Índice](./README.md) · Anterior: [Testing](./README.TESTING.md)

Cifrado de secretos, política de contenido y firma del instalador.

---

## Cifrado de la API key en reposo

La API key de OpenRouter se guarda **cifrada** en la fila `Settings` (antes era plaintext). Módulo: [`lib/infrastructure/crypto/secret-cipher.ts`](./lib/infrastructure/crypto/secret-cipher.ts).

- **Algoritmo:** AES-256-GCM, clave derivada con scrypt.
- **Envelope versionado autodescriptivo:** `enc:v1:<iv>:<tag>:<ciphertext>` (base64url).
- **Retrocompatible:** un valor sin el prefijo `enc:v1:` se trata como plaintext legacy y se devuelve tal cual (migración perezosa, sin romper claves existentes). Se re-cifra al siguiente guardado.
- **Idempotente:** cifrar algo ya cifrado es no-op; el auth-tag detecta manipulación o clave errónea.

### Dónde se cifra/descifra (3 puntos)

| Punto | Acción |
|---|---|
| `PrismaSettingsRepository.upsert` | **Cifra** antes de escribir en la DB |
| `PrismaSettingsRepository.get` | **Descifra** al leer |
| `config-service.readDbSettings` | **Descifra** (este camino lee `db` directo, sin pasar por el repo) |

### Secreto maestro

`resolveMasterSecret` usa `AIZEA_SECRET_KEY` (env) si existe; si no, un fallback constante (documentado como más débil).

> **Threat model honesto:** protege contra inspección casual del `db.sqlite`, backups y fugas accidentales. **No** aísla el secreto de un atacante con binario + máquina (una app local debe poder descifrar su propio secreto). El aislamiento real requeriría el keychain del SO (trabajo futuro). Aun así, es una mejora real y proporcionada sobre plaintext.

---

## Content-Security-Policy y cabeceras

La ventana Tauri carga `http://localhost:1422` (contenido servido por **Next sobre HTTP**), no el protocolo de assets de Tauri. Por eso la CSP se entrega como **cabeceras de respuesta HTTP de Next**, configuradas en [`next.config.ts`](./next.config.ts) (`async headers()`).

Directivas (env-aware):

- `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`
- `script-src 'self' 'unsafe-inline'` (Next inyecta bootstrap inline; `'unsafe-eval'` solo en dev para React Refresh)
- `connect-src 'self'` (las llamadas a OpenRouter/docling son server-side Node→externo, no browser→externo; en dev se añade `ws:` para HMR)

Cabeceras adicionales: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.

---

## Supervisión del backend (escritorio)

El lanzador Rust ([`src-tauri/src/lib.rs`](./src-tauri/src/lib.rs)) supervisa el sidecar Node:

- **Spawn + reinicio** con backoff (hasta 5 fallos consecutivos).
- **Logs** de stdout/stderr a `%APPDATA%\AIzea\logs\server.log`.
- **Health-poll** de `/api/health` (en vez de un `sleep` ciego) antes de abrir la ventana.

Estos helpers están gated a `not(debug_assertions)` → se validan con `cargo check --release`.

---

## Firma del instalador y auto-updater

**No incluidos** (decisión deliberada). El proyecto es de uso personal/no comercial, así que el auto-updater firmado y el code signing se **eliminaron por completo** para que `pnpm build:msi` termine limpio sin requerir claves ni certificados.

- El instalador (`.msi`/`.exe`) **no está firmado**: al instalarlo, Windows SmartScreen mostrará un aviso de "editor desconocido" que se acepta manualmente. Es esperado y no afecta al funcionamiento.
- **No hay auto-actualización**: para actualizar, se recompila y reinstala.

Si en el futuro se quisiera distribución comercial, habría que reañadir `tauri-plugin-updater`, un **certificado Authenticode** de una CA (DigiCert/Sectigo), una **clave de firma** (`TAURI_SIGNING_PRIVATE_KEY`) como secreto de CI, y un **endpoint de releases**. No es el caso hoy.

---

## Buenas prácticas al contribuir

- No commitear `.env`, claves ni `db.sqlite` con datos reales.
- Tratar la salida de PDFs/LLM como entrada no confiable (validar en los límites).
- No exponer valores de secretos en logs (referenciar por nombre de clave).

---

[◄ Volver al índice](./README.md)
