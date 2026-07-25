# Changelog

All notable changes to AIzea are documented in this file.

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
