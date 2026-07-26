# Changelog

All notable changes to AIzea are documented in this file.

## [0.3.0] — 2026-07-26

### Added
- **Cola persistente + worker resumible del pipeline** (Fase 2): `IJobQueue`/`PrismaJobQueue` (respaldada en `ProcessingJob` con `type="pipeline-run"`, sin migración nueva) y `PipelineWorker` (`pump()` reentrante + `recover()`). Encolar ya no bloquea la petición; la cola drena en fondo, es cancelable, un fallo no la atasca y es resumible tras un crash (runs `running` vetustos → `recoverStale`).
- **Backend supervisado en el escritorio** (Fase 3): el launcher Rust ahora **supervisa** el sidecar Node — spawn + reinicio con backoff (hasta 5 fallos), captura de stdout/stderr a `%APPDATA%\AIzea\logs\server.log`, y **health-poll** de `/api/health` antes de abrir la ventana (en vez de un `sleep` ciego).
- **Endpoint `/api/health`**: readiness real (ping a la BD) + versión. Devuelve 200/503. Es también el disparador del bootstrap del worker.
- **API REST fina**: `POST /api/pipeline/start`, `POST /api/pipeline/[jobId]/cancel`, `GET /api/courses`, `POST /api/courses`, `GET|PATCH|DELETE /api/courses/[id]`. Delegan en los server actions (sin duplicar lógica).
- **Data-layer tipado con caché** (Fase 4): `lib/client/api-client.ts` — `ApiClient` con respuestas tipadas (`ApiResult<T>`), caché TTL para GETs, deduplicación de peticiones en vuelo e invalidación en mutaciones.
- **Error boundaries** (Fase 4): `components/ErrorBoundary/ErrorBoundary.tsx` reutilizable + `app/error.tsx` y `app/global-error.tsx`. Un error de render ahora muestra un fallback con "Reintentar" en vez de pantalla blanca.
- **Cifrado de la API key en reposo** (Fase 5): `lib/infrastructure/crypto/secret-cipher.ts` — AES-256-GCM con envelope versionado (`enc:v1:…`), retrocompatible con valores plaintext antiguos. La clave se cifra al escribir y se descifra al leer en los 3 puntos de acceso.
- **CSP + cabeceras de seguridad** (Fase 5): `next.config.ts` sirve Content-Security-Policy env-aware + `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
- **Wiki de documentación** en la raíz: `README.md` (hub navegable) + páginas `README.GETTING-STARTED`, `README.BUILD`, `README.ARCHITECTURE`, `README.MODULES`, `README.PIPELINE`, `README.API`, `README.DATA`, `README.TESTING`, `README.SECURITY`.

### Changed
- **Arranque del worker relocalizado**: el bootstrap (recover + pump) se dispara desde el route handler `/api/health` (runtime Node), no desde un `instrumentation.ts`.
- `usePipelineStore`: el mapa de jobs ahora está **acotado** (`MAX_JOBS`), podando jobs terminales/descartados sin tocar los que están en vuelo — corrige una fuga de memoria en sesiones largas.

### Fixed
- **Crash de arranque `lancedb ... is not supported in the browser`**: el `instrumentation.ts` añadido en Fase 3 importaba el `container`, arrastrando el binario nativo de LanceDB al bundle edge/browser. Eliminado; el bootstrap del worker se movió a `/api/health` (runtime Node). El servidor dev vuelve a arrancar limpio.

### Removed
- **Auto-updater firmado y code signing**: eliminados por completo (uso no comercial). Quitados `tauri-plugin-updater` de `Cargo.toml`, su registro en `lib.rs`, el bloque `plugins.updater` + `createUpdaterArtifacts` de `tauri.conf.json` y el permiso `updater:default`. `pnpm build:msi` ahora termina sin el error de clave privada de firma. El instalador no se firma (Windows SmartScreen avisará de "editor desconocido").

## [0.2.0] — 2026-07-25

### Fixed
- **Crash al exportar PDF en desktop**: `exportAllSlidesPdfAction` usaba Playwright (no empaquetado en el build standalone). Ahora devuelve HTML para impresión nativa desde el WebView de Tauri (Ctrl+P → Guardar como PDF).
- **Crash "A boolean was expected" en pipeline**: `latex-renderer.ts` importaba `sharp` estáticamente; su binario nativo falla en el standalone. Sustituido por un PNG placeholder hardcoded (70 bytes). El render visual de fórmulas sigue siendo client-side via rehype-katex.
- **Crash "Unique constraint failed on unitId" al reintentar pipeline**: `UnitExtractor.extract()` usaba `create`; al reintentar fallaba si ya existía la representación. Cambiado a `upsert` — la extracción ahora es idempotente.
- **Crash "table TopicNode does not exist" en app instalada**: `schema.prisma` tenía `url = "file:./dev.db"` hardcoded; Prisma abría un stub vacío ignorando `DATABASE_URL`. Cambiado a `url = env("DATABASE_URL")`.
- **Servidor no arrancaba ("EISDIR lstat 'C:'")**: Ruta verbatim `\\?\` de Windows no parseable por Node. Añadido `strip_verbatim()` en el launcher Rust.
- **image-compressor.ts**: `sharp` cambiado a import dinámico + `serverExternalPackages` en next.config.ts. Si sharp falla en standalone, devuelve el buffer original sin comprimir.

### Changed
- `build-msi.cjs` ahora hace WAL checkpoint antes de copiar la BD, elimina `.env` de dev y borra el stub `dev.db` de `.prisma/client` del standalone.
- `schema.prisma` usa `env("DATABASE_URL")` en vez de ruta hardcoded.
- `next.config.ts` añade `"sharp"` a `serverExternalPackages`.
- Barra de progreso del pipeline: el banner global re-lista jobs reales por courseId en vez de mostrar 0%.

### Added
- `scripts/wal-checkpoint.cjs`: fuerza flush del WAL de SQLite antes de empaquetar.
- `lib/paths.ts`: resolutor centralizado de directorios de datos (uploads, LanceDB, BD).
- API key de OpenRouter se configura desde /settings (persiste en BD, sobrevive reinstalaciones).
- Parser PDF con fallback `pdf-parse` cuando Docling no está disponible (`AIZEA_SKIP_DOCLING=1`).

## [0.1.0] — 2026-07-23

### Added
- Pipeline completo: segmentación → extracción → integración → construcción de árbol.
- Generación de diapositivas con diseño HTML, guion, relevancia y narrativa.
- Export HTML individual y export PDF multi-página.
- Árbol conceptual interactivo con nodos editables (podar, unir, dividir).
- Persistencia en SQLite via Prisma.
- Build MSI + NSIS con Tauri (Node.js sidecar, sin admin para NSIS).
