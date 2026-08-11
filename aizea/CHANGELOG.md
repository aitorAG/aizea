# Changelog

All notable changes to AIzea are documented in this file.

## [0.7.0] — 2026-08-12

Captura de figuras vectoriales/compuestas mediante recorte fino, in-process
(sin docling, sin Docker, sin binario nativo) — listo para el .exe.

### Added
- **Recorte fino de figuras sin imagen embebida.** Antes, una figura con
  caption ("Figura N: …") pero sin imagen rasterizada embebida (diagramas
  vectoriales, composiciones) se descartaba. Ahora se **rasteriza la región de
  la figura** desde el PDF y se persiste como imagen real, alimentando "una
  diapositiva por elemento visual".
  - `lib/domain/pdf/figure-geometry.ts` — mini-intérprete puro del content-stream
    del PDF que calcula el *bounding box* de la geometría de dibujo (paths
    `m/l/c/v/y/re` y XObjects imagen/form vía `Do`, componiendo la CTM con
    `q/Q/cm`), **excluyendo el texto de cuerpo** (`BT…ET`). Determinista y sin
    dependencias.
  - `lib/infrastructure/pdf/page-rasterizer.ts` — renderiza la página con
    `@hyzyla/pdfium` (WASM, licencia BSD) y recorta al bbox (con volteo del eje
    Y), codificando el PNG con `pngjs` (JS puro). Sin `sharp`, sin binario
    nativo → funciona en el Node embebido del `.exe`.
  - `IFigureRasterizer` (puerto) + `FigureRasterizer` (infra) inyectados en
    `FigureExtractor`; degrada con seguridad (se salta la figura) si no hay
    geometría utilizable o el recorte es degenerado.
  - Motor de rasterizado y `pngjs` declarados en `serverExternalPackages` para
    que el build *standalone* del `.exe` los trace correctamente (incluido
    `pdfium.wasm`, ~3.9 MB).

## [0.6.0] — 2026-08-11

Diapositivas alineadas con la estructura del curso, formato imprimible A4,
visuales reales y un asistente conversacional para editar el árbol.

### Added
- **Orden descendente de las diapositivas (recorrido DFS del árbol).** El árbol
  guarda ahora `orderIndex` por hermano (`TopicNode.orderIndex`) y las
  diapositivas se generan siguiendo un recorrido en profundidad pre-orden
  (padre antes que hijos, hermanos por `orderIndex`). Árbol, lista de
  diapositivas y export comparten el mismo orden de arriba abajo. Nuevo helper
  puro `lib/domain/pipeline/tree-order.ts` (`dfsPreorder`), con guardas
  anti-ciclo y raíces huérfanas.
- **Una diapositiva por elemento visual.** Cada figura real (imagen extraída del
  material) genera su propia diapositiva, intercalada justo después del concepto
  al que pertenece. Provenance de páginas en el nodo (`TopicNode.pageStart/
  pageEnd`) para localizar las figuras del concepto; `Slide.kind`
  (`concept`|`figure`). La imagen se embebe como data URI base64
  (`lib/domain/slides/figure-slide.ts`), por lo que se ve en pantalla y en el
  PDF sin infraestructura adicional. Las figuras sin imagen real se omiten (sin
  placeholders).
- **Slider de granularidad "diapositivas objetivo" (0-300).** Junto a "Generar
  árbol"; orienta cuántos temas/diapositivas produce el pipeline
  (`Course.slideTarget` → umbral de clustering del `ConceptIntegrator`). Es una
  guía, no un límite rígido.
- **Asistente conversacional del árbol.** Panel de chat en la vista del árbol:
  el usuario pide cambios en lenguaje natural y el agente (`AgentService`) los
  aplica en vivo (crear hoja, borrar, fusionar, renombrar, dividir) por el mismo
  `TreeService` que la edición manual. El árbol se actualiza sin recargar la
  página; las diapositivas huérfanas se podan al editar.

### Changed
- **Diapositivas en A4 apaisado** (1123×794px @96dpi) en lugar de 16:9
  (1280×720): prompt de diseño, vista previa en pantalla y HTML exportado.
- **PDF de dos páginas por diapositiva:** página 1 el visual en A4 horizontal,
  página 2 la narrativa/relevancia/guion **y los ejercicios** en A4 vertical.
- **Extracción de figuras por página** en el backend JS (`pdf-parse` pagerender)
  para que la asociación figura↔página funcione también en la versión web, no
  solo en el escritorio.

## [0.5.0] — 2026-07-27

Robustez del instalador y de las actualizaciones del escritorio.

### Fixed
- **Actualizaciones sin perder datos ni romper el esquema** (causa raíz): el
  launcher solo sembraba `db.sqlite` en la primera ejecución, así que al
  **actualizar** (p. ej. 0.3.0 → 0.4.0) la base de datos existente se quedaba
  sin las columnas nuevas y "Generar árbol" fallaba con
  `column sectionPath does not exist`. Nuevo
  `lib/infrastructure/persistence/schema-reconciler.ts`: en el arranque
  (una vez por proceso, en `/api/health`, antes del worker) reconcilia la BD
  viva contra el **DMMF de Prisma** (ya embebido en el cliente del standalone
  → cero binario extra, cero drift con `schema.prisma`) y añade con
  `ALTER TABLE ADD COLUMN` cualquier columna escalar que falte. Idempotente,
  aditivo y no destructivo (conserva los datos del usuario). Elimina la clase
  entera de bugs "columna nueva rompe la actualización". Se descartó
  `prisma db push` en runtime: el schema-engine (17,9 MB) no viaja en el
  standalone y engordaría el instalador.
- **El instalador ya no arranca con datos de desarrollo**: el build copiaba
  `prisma/dev.db` CON datos (cursos y materiales de prueba) al instalador, así
  que toda instalación nueva los mostraba. Nuevo
  `scripts/seed-installer-db.cjs` vacía todas las filas de la COPIA del
  instalador (enumera tablas de `sqlite_master`, `DELETE` con FKs off,
  `VACUUM` + checkpoint) conservando el esquema. Nunca toca `dev.db`.

### Changed
- **Versión del instalador sincronizada**: `tauri.conf.json` toma la versión de
  `../package.json` en vez de un literal hardcoded (el MSI/NSIS salía 0.3.0
  cuando `package.json` ya iba por 0.4.0). Fin del drift de versión.
- **`upgradeCode` del MSI fijado** (`60418511-84f1-568b-9944-be04e2ab6037`, el
  mismo que Tauri derivaba) para que las actualizaciones reconozcan la
  instalación previa y no dupliquen la app aunque cambie el `productName`. El
  `.exe` NSIS ya detecta instalación previa y ofrece reinstalar/actualizar.

## [0.4.0] — 2026-07-27

Calidad y eficiencia de la generación del árbol conceptual (ver
`docs/ARBOL-CONCEPTUAL-analisis-y-estrategia.md`). Cuatro entregas, cada una
reversible y con la suite verde.

### Added
- **Extracción concurrente** (PR1): nuevo `IBoundedPool`/`BoundedPool`
  (`lib/infrastructure/concurrency/`) — pool acotado con orden preservado,
  cancelación cooperativa vía `AbortSignal` y fail-fast que drena las tareas en
  vuelo antes de rechazar. `PipelineService.runExtraction` pasa de un bucle
  serial a `map` concurrente (límite configurable con
  `AIZEA_EXTRACTION_CONCURRENCY`, default 6): el tiempo de la fase más cara baja
  de `N·t` a ≈`N·t/límite` respetando el rate-limit y la cancelación.
- **Estructura del documento como esqueleto del árbol** (PR2): `SemanticUnit`
  gana `sectionPath` (breadcrumb de headings, columna nueva + migración
  `add_section_path`). Nuevo `ITreeSkeletonBuilder`/`TreeSkeletonBuilder`
  (`tree-skeleton.ts`) que deriva la jerarquía de los headings (adyacencia del
  breadcrumb + numeración "3.2"⊂"3"), con `depth` **derivado de la cadena real**
  (no declarado) → imposible declarar profundidad falsa; garantías anti-ciclo y
  orden topológico.
- **Estrategia "structure" del `TreeBuilder`** (PR3): feature flag
  `AIZEA_TREE_STRATEGY` (`structure` por defecto, `llm` legacy). El camino
  `structure` monta el esqueleto, cuelga cada `TopicGroup` bajo su sección
  dominante (por `sourceUnitIds`→`sectionPath`) con clamp a `MAX_DEPTH`, y
  persiste con `replaceCourseNodes` **transaccional** (build-before-delete: si
  algo falla, el árbol viejo queda intacto). Fallback automático a `llm` cuando
  no hay estructura.
- **Prompt de merge propio** (PR4): `build-merge-decisions.template.ts` +
  `PromptManager.buildMergeDecisionsPrompt`. `IncrementalMerger` ya pide al LLM
  `{ action, parentRef }` por concepto en vez de reutilizar el prompt de
  integración (que nunca los pedía).
- **Tope de tamaño por unidad** (PR2): `MAX_UNIT_CHARS` parte secciones largas
  por límites de párrafo → ninguna llamada de extracción arriesga el contexto.
- **Helper de tests** `tests/helpers/migrate-test-db.ts`: aplica **todas** las
  migraciones en orden (arregla la fragilidad de replays hard-coded a una sola).

### Changed
- **Clustering de conceptos exacto y más rápido** (PR4): `ConceptIntegrator`
  normaliza los vectores una vez y usa producto punto + early-skip por
  union-find en el bucle O(n²) (elimina 2 raíces por par). Resultados
  **idénticos** (sin pérdida de recall). Decisión de diseño: se descartó
  ANN/LanceDB por ser aproximado (degradaría la calidad del clustering) y la
  abstracción equivocada para un lote transitorio en memoria.

### Fixed
- **Profundidad del árbol validada sobre la cadena real** (P2): el esqueleto
  deriva `depth` recorriendo `parentRef`, no confiando en un número declarado.
- **Sin ventana sin árbol** (P4): el reemplazo es atómico (transacción), no un
  `delete` incondicional seguido de inserciones sueltas.

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
