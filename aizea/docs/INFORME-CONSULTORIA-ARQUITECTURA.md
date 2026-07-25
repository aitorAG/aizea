# AIzea — Informe de Consultoría de Arquitectura

**Alcance:** Frontend · Backend · Despliegue
**Naturaleza del documento:** Auditoría técnica independiente. Análisis de "lo que hay" frente a "lo que debería ser".
**Restricción:** Este informe NO modifica código. Es un diagnóstico y una hoja de ruta.
**Evidencia:** Todas las afirmaciones están respaldadas por rutas de fichero y fragmentos concretos del repositorio.

---

## 1. Resumen ejecutivo

Tu intuición es correcta, y la evidencia la respalda sin ambigüedad.

**AIzea no es una aplicación de escritorio nativa. Es una aplicación web (un servidor Next.js completo) empaquetada dentro de una ventana de escritorio.** El binario de escritorio arranca un runtime de Node.js de 91 MB incrustado, ejecuta el servidor HTTP de Next.js en `127.0.0.1:1422`, y la ventana de Tauri no es más que un navegador Chromium apuntando a ese `localhost`. Cada uno de los síntomas que percibes —arranque lento, navegación lenta, inestabilidad, sensación de "parches"— es una consecuencia **directa y predecible** de esa decisión de arquitectura y de cómo se ha construido el resto del sistema encima.

### Veredicto por capa

| Capa | Estado | Diagnóstico en una frase |
|---|---|---|
| **Despliegue / Desktop** | Deficiente por diseño | Es una web servida por Node dentro de un webview; el modelo entero está mal elegido para escritorio. |
| **Backend (arquitectura)** | Hexagonal ~25% real, ~75% aspiracional | Los puertos y el composition root son de libro, pero casi todo el código real los ignora y va directo a Prisma. |
| **Backend (flujos/pipeline)** | Frágil | No hay cola real ni worker de fondo; horas de trabajo CPU/IA se ejecutan dentro del propio request. Sin resumibilidad. |
| **Frontend** | Inestable y no optimizado | Cero error boundaries, 4 pollers descoordinados, stores globales muertos, adapters que se recrean en cada render (causa documentada de bucles infinitos). |

### La pregunta del cliente: ¿rehacer, refactorizar o parchear?

Adelanto la recomendación y la justifico a lo largo del informe:

> **Reescritura selectiva sobre reaprovechamiento del núcleo de dominio.** No es "tirar todo y empezar de cero" (eso desperdiciaría la lógica de negocio valiosa: el pipeline de IA, los prompts, el modelo de datos, el RAG). Tampoco es "parchear" (eso es exactamente lo que te ha traído hasta aquí, y produce el "producto mediocre" que quieres evitar). Es: **reemplazar la capa de despliegue y de ejecución por una arquitectura de escritorio real, reescribir la capa de frontend y la capa de orquestación (actions/pipeline/estado), y preservar+sanear el núcleo de dominio.**

Los "pequeños cambios" están descartados con razón. El historial del propio proyecto lo demuestra: el `CHANGELOG.md` de la versión 0.2.0 es literalmente un catálogo de crashes causados por esta arquitectura, cada uno resuelto con un parche puntual (un `sleep` de 3 segundos, un PNG de 70 bytes hardcodeado, un `strip_verbatim` para rutas de Windows, borrar un stub de base de datos...). Ese patrón es insostenible y es la raíz de tu sensación de "vamos haciendo parches".

---

## 2. Alcance y metodología

Este informe se basa en una exploración sistemática del repositorio `aizea/` mediante cuatro análisis paralelos independientes:

1. **Integración de escritorio y despliegue** — `src-tauri/`, scripts de build, Docker, empaquetado MSI.
2. **API, datos y pipeline de trabajos** — rutas API, server actions, esquema Prisma, sistema de jobs, integraciones externas (LanceDB, Docling, OpenRouter).
3. **Arquitectura frontend y estado** — App Router, componentes cliente/servidor, stores Zustand, patrones de fetching y renderizado.
4. **Arquitectura por capas del backend** — la estructura hexagonal (`domain/`, `application/`, `infrastructure/`, `adapters/`, `composition/`).

**Stack confirmado:** Next.js 15 (App Router) · React 19 · Tauri 2 · TypeScript · Prisma + SQLite · LanceDB (vectorial) · Docling (procesamiento de documentos, vía Docker) · OpenRouter/DeepSeek (LLM) · Zustand · ReactFlow · dnd-kit · KaTeX.

**Producto (según `docs/PRODUCT.md`):** herramienta local-first para que profesores universitarios generen material docente (diapositivas, guiones, narrativas, ejercicios) a partir de su bibliografía, con la IA como asistente y el profesor como decisor final. El flujo previsto es: Dashboard → Curso → Materiales → Diapositivas → Exportar.

Cada sección siguiente contrasta **lo que debería ser** (el diseño correcto para este producto y estas restricciones) con **lo que hay** (el estado real, con evidencia).

---

## 3. Diagnóstico global: "una web desplegada como app"

Esta es tu preocupación central, y es la más importante. La confirmo con la pistola humeante.

### 3.1 Cómo se ejecuta AIzea hoy (lo que hay)

Cuando el usuario abre la aplicación instalada, ocurre lo siguiente:

```
1. Windows lanza aizea.exe (el binario Rust de Tauri).
2. El proceso Rust resuelve %APPDATA%\AIzea, crea uploads/ y lancedb-data/.
3. El proceso Rust ARRANCA UN SEGUNDO PROCESO: node.exe server.js
   (el runtime de Node.js de 91 MB incrustado, ejecutando el servidor
    standalone de Next.js) en el puerto 1422.
4. El proceso Rust hace: std::thread::sleep(3000ms)   ← espera "a ojo".
5. Se abre la ventana (WebView2 / Chromium) apuntando a http://localhost:1422.
6. A partir de aquí, TODO es una web: cada navegación es un request HTTP
   al servidor Node que corre en la misma máquina.
```

**Evidencia irrefutable:**

- `src-tauri/tauri.conf.json`: la ventana abre `"url": "http://localhost:1422"`; el bundle incluye `"externalBin": ["binaries/node"]` y `"resources": { "../.next/standalone": "standalone" }`.
- `src-tauri/src/lib.rs`: el proceso Rust ejecuta literalmente
  ```rust
  Command::new(&node_bin_clean)
      .arg(&server_js_str)
      .env("PORT", "1422")
      .env("AIZEA_SKIP_DOCLING", "1")
      .spawn();
  // ...
  std::thread::sleep(std::time::Duration::from_millis(3000));
  ```
- `src-tauri/binaries/node-x86_64-pc-windows-msvc.exe` = **91,4 MB** de Node.js empaquetado.
- `next.config.ts`: `output: "standalone"` — esto NO es un export estático; es un servidor Node autocontenido que necesita Node para arrancar.
- `Dockerfile`: `CMD ["node", "server.js"]` — **el mismo `server.js` que corre en Docker es el que corre dentro del "escritorio".** Es, exactamente, la misma web con dos lanzadores distintos.

**Conclusión:** no hay UI nativa, no hay SPA estática, no hay ni siquiera un service worker activo (el componente `PwaRegister.tsx` existe pero **nunca se monta** en `app/layout.tsx` — es código muerto). La "app de escritorio" es un supervisor de tres procesos concurrentes: Rust (Tauri) + Node (Next.js) + Chromium (WebView2). El proceso *primario* real es Node; Rust es solo un lanzador con un puente para diálogos de fichero y extracción de PDF.

### 3.2 Por qué esto explica TODOS tus síntomas

| Síntoma que percibes | Causa raíz en el código |
|---|---|
| **"Tarda en abrir"** | Arranque en cadena: Tauri → WebView2 → Node → Next.js → init de Prisma → primer render dinámico. Coronado por un `sleep(3000ms)` fijo en `lib.rs` que no comprueba si el servidor está listo (no hay health-check; es una espera a ciegas). Arranque en frío: 5-10 s. |
| **"Navegación lenta"** | Cada cambio de ruta es un request HTTP real a Node → render RSC → consulta Prisma → respuesta. Todas las rutas de curso son dinámicas (`force-dynamic`). No hay caché de cliente ni prefetch efectivo. |
| **"Inestable / crashea"** | El servidor Node dentro del empaquetado ha fallado repetidamente por rutas de Windows (`\\?\`, "EISDIR lstat 'C:'"), por una BD stub vacía, por el WAL de SQLite sin checkpoint, por binarios nativos (`sharp`, Playwright) ausentes en el standalone. Cada fallo es un parche en el CHANGELOG. |
| **"Instalador enorme"** | Node 22 (91 MB) + el standalone de Next.js + cliente Prisma + binario nativo de LanceDB + sharp + artefactos de workbox. Sin el pruning agresivo del script de build, el standalone es ~1,8 GB (el script lo recorta a ~89 MB borrando binarios de otras plataformas). |
| **"PDF peor en la app que en la web"** | El build de escritorio fija `AIZEA_SKIP_DOCLING=1` (`lib.rs`), que **desactiva silenciosamente** el parseo estructural de PDF (Docling) y cae a `pdf-parse` (solo texto). El usuario no tiene ninguna indicación de que la calidad es inferior. |

### 3.3 El proceso hijo Node es huérfano y sin supervisión

Dos defectos graves de fiabilidad, ambos en `src-tauri/src/lib.rs`:

- **Sin comprobación de arranque:** el `sleep(3000ms)` es lo único que sincroniza la ventana con el servidor. Si Node tarda más (BD fría, JIT, primer request), la ventana abre sobre un "connection refused". Si tarda menos, se desperdicia tiempo.
- **Proceso huérfano:** el `Child` devuelto por `.spawn()` se descarta inmediatamente (sin `.wait()`, sin `kill_on_drop`). Si el usuario cierra la ventana, el proceso Node puede quedar como zombi ocupando el puerto 1422. Si Node crashea primero, el webview muestra un error de conexión sin recuperación.
- **Sin logs:** stdout/stderr de Node no se redirige a ningún sitio. Cuando algo falla en producción, no queda rastro en el disco del usuario. `tauri-plugin-log` solo se registra en builds de debug.

### 3.4 Portabilidad y distribución (lo que hay vs lo prometido)

- `docs/BUILD-DESKTOP.md` afirma soportar `.dmg` / `.appimage` / `.deb` / `.rpm`, pero `binaries/` **solo contiene el Node de Windows x64**. Los builds de macOS y Linux **no son construibles** sin añadir un sidecar de Node por plataforma. Es una brecha entre la documentación y la realidad.
- El plugin `tauri-plugin-updater` está en `Cargo.toml` pero **no hay configuración de updater** en `tauri.conf.json`. Sin actualizaciones automáticas: cada parche exige reinstalar el MSI a mano.
- La notarización de macOS no está configurada (`docs/BUILD-DESKTOP.md` lo lista como "No incluido"). Gatekeeper bloquearía la app.
- `csp: null` en `tauri.conf.json`: se desactiva explícitamente la Content Security Policy.
- La API key de OpenRouter se guarda en texto plano en la tabla `Settings` de SQLite.

### 3.5 Lo que debería ser: una aplicación de escritorio real

Para un producto local-first, single-user, orientado a rendimiento y estabilidad, el modelo correcto **elimina el servidor Node del runtime**. Hay dos arquetipos válidos, en orden de preferencia para este caso:

**Opción A (recomendada) — Tauri con frontend estático + núcleo nativo Rust:**
- El frontend se compila como **SPA estática** (Vite + React, o Next.js en modo `output: "export"`), servida por el propio Tauri desde el bundle (protocolo `tauri://`), sin ningún servidor HTTP ni Node.
- La lógica de negocio pesada (acceso a datos, pipeline, RAG, exportación) se expone como **comandos Tauri (IPC)** implementados en Rust, o como una librería nativa. La navegación pasa a ser instantánea (no hay round-trip HTTP; es memoria local).
- SQLite se accede nativamente (por ejemplo vía `sqlx`/`rusqlite` o el plugin SQL de Tauri). El binario final baja de cientos de MB a ~10-20 MB. Arranque en frío por debajo de 1 s.

**Opción B — Servidor local desacoplado, pero como servicio nativo, no como "web empaquetada":**
- Si se quiere preservar TypeScript en el backend a corto plazo, el servidor se ejecuta como un **sidecar gestionado con health-check real, reinicio y logging**, y el frontend se sirve estático. Es un paso intermedio, no el destino.

La diferencia clave: hoy el frontend **depende** de que haya un servidor Node vivo para cada clic. En el objetivo, el frontend es autónomo y solo cruza a la capa nativa para operaciones de datos concretas, vía IPC en memoria. Eso es lo que da las propiedades de "app de escritorio" que estás pagando: arranque sub-segundo, navegación instantánea, menús nativos, sistema de ficheros real, y sin la clase entera de bugs de "el servidor Node no arrancó".

---

## 4. Backend: capas, responsabilidades y límites de control

Aquí está la raíz de tu segunda preocupación: "las responsabilidades de cada módulo y las capas de control no están claras; da la sensación de que vamos haciendo parches".

El backend **intenta** seguir una arquitectura hexagonal (puertos y adaptadores). La estructura de carpetas es correcta: `domain/`, `application/` (con `ports/` y `use-cases/`), `infrastructure/`, `adapters/`, `composition/`. El problema es que **el patrón está dibujado pero no respetado**: es hexagonal en un ~25% y aspiracional en el ~75% restante.

### 4.1 Lo que debería ser (regla de dependencia hexagonal)

```
   UI / actions  ──►  application (use-cases)  ──►  domain (lógica pura)
                             │                          ▲
                             ▼                          │
                          ports (interfaces)            │
                             ▲                          │
                             │                          │
                       infrastructure (Prisma, LanceDB, OpenRouter, FS)
                       implementa los ports; el dominio NUNCA los conoce
```

Reglas: el dominio no importa nada de infraestructura. La aplicación orquesta el dominio a través de puertos. La infraestructura implementa los puertos. Un único **composition root** cablea las implementaciones concretas. Los *entry points* (server actions) son finos: validan, llaman a un caso de uso, revalidan.

### 4.2 Lo que hay: las piezas limpias (la buena noticia)

Existe una base excelente sobre la que construir:

- **`lib/application/ports/`** — 13 interfaces bien documentadas, con forma de caso de uso. De libro.
- **`lib/composition/container.ts`** — composition root ejemplar (134 líneas): acepta overrides para tests, cablea repositorios → implementaciones → casos de uso, expone un singleton `container`.
- **`lib/infrastructure/persistence/prisma-*.repository.ts`** — 10 repositorios, uno por modelo, cada uno implementa correctamente su puerto.
- **`lib/application/use-cases/process-course.use-case.ts`** y **`upload-material.use-case.ts`** — dos "ciudadanos modelo": inyección pura de puertos, resultado como unión discriminada, cero fugas. Así debería ser TODO.
- **`lib/infrastructure/ai/openrouter-*.provider.ts`** — implementan sus puertos correctamente.

### 4.3 Lo que hay: las violaciones (la mala noticia)

El código que **realmente se ejecuta** esquiva esa base:

**Violación 1 — Los tres "Services" de aplicación van directos a Prisma.**
- `lib/application/CourseService.ts`: `import { db } from "@/lib/db"` + `import { Course } from "@prisma/client"`. Llama a `db.course.*` directamente, ignorando `ICourseRepository`.
- `lib/application/ExportService.ts`: recibe `PrismaClient` en el constructor. Además duplica lógica de render HTML/PDF que también vive en `actions/slide-export.ts`.
- `lib/application/SlideService.ts`: **fichero-dios de 581 líneas.** Importa `PrismaClient`, `db`, `chatJSON` (dominio concreto), `PromptManager`, `RAGEngine`. Seis responsabilidades en una clase: generación de esquema, creación de diapositivas desde el árbol, generación de contenido, regeneración de HTML, CRUD de diapositivas, CRUD de cajas. Viola descaradamente el principio de responsabilidad única.

**Violación 2 — El "dominio" no es puro: importa infraestructura y BD.**
- `lib/domain/llm/LLMClient.ts` importa `OpenRouterLLMProvider` de infraestructura → **el dominio depende de infraestructura** (inversión rota).
- `lib/domain/rag/EmbeddingService.ts` → idem con `OpenRouterEmbeddingProvider`.
- `lib/domain/rag/RAGEngine.ts` importa `db` → **acceso directo a BD desde el dominio**.
- `lib/domain/rag/VectorStore.ts` importa `lancedb` → el dominio conoce una implementación concreta de vector store.
- `lib/domain/figures/FigureExtractor.ts` importa `db`, `node:fs/promises`, `node:path` → **BD + sistema de ficheros en el dominio**.
- `lib/domain/pdf/PDFService.ts` detecta Tauri en runtime (`window.__TAURI_INTERNALS__`) → **preocupación de infraestructura empotrada en el dominio**.
- `lib/domain/pipeline/SegmenterService.ts` y `UnitExtractor.ts` importan `db` y servicios concretos.

**Violación 3 — Las server actions esquivan el composition root.**
Los *entry points* reales de la UI son un mosaico de cumplimiento:
- **Modelo (usan el container):** `material.ts::uploadMaterial`, `pipeline.ts::startPipelineAction`.
- **Mixtas:** `slide.ts`, `generate.ts`, `box.ts` usan `container.slides.findCourseIdById()` para lo trivial, pero `new SlideService()` (la clase-dios) para el trabajo real.
- **Bypass total (los peores):**
  - `lib/actions/tree.ts` — **472 líneas.** `db.topicNode.*` directo por todas partes, `chatJSON`, `new PromptManager()`. Cinco operaciones CRUD + una llamada LLM (split de nodos) viviendo en la capa de action. **Es un caso de uso disfrazado de server action.** El peor infractor del código base.
  - `lib/actions/figure.ts` — `db.material.*`, `db.figure.*`, `new FigureExtractor()`, `extractFigureReferences` de `lib/figures.ts`. Cinco caminos de entrada al sistema, ninguno a través de un puerto.
  - `lib/actions/settings.ts` — `db.settings.*` directo; el puerto `ISettingsRepository` existe pero nunca se usa.
  - `lib/actions/slide-export.ts` — **524 líneas.** Consultas a BD + lanzamiento de Playwright + espera de KaTeX + plantilla PDF + un bloque `<style>` de 220 líneas en un template literal. Sin caso de uso, sin puerto.

**Violación 4 — Puertos definidos pero nunca consumidos (código muerto de arquitectura).**
Siete puertos están definidos e implementados pero **jamás se usan** en ninguna action: `ISettingsRepository`, `IProcessingJobRepository`, `ISlideBoxRepository`, `ITopicNodeRepository`, `ISemanticUnitRepository`, `IFigureRepository`, `ITextChunkRepository`. Es esfuerzo de diseño hexagonal que no se cosecha.

### 4.4 Duplicación y código muerto (síntoma directo de "parches")

- **Extracción de figuras duplicada:** el mismo regex `(?:Figura|Figure)\s+(\d+(?:\.\d+)?)...` existe en `lib/figures.ts:9` **y** en `lib/domain/pdf/PDFService.ts:187`. Dos caminos para lo mismo.
- **Extracción de texto PDF duplicada:** `lib/pdf.ts` (marcado `@deprecated` pero todavía presente) y `lib/domain/pdf/PDFService.ts`, ambos con `pdf-parse`.
- **Dos notificadores idénticos:** `InAppNotifier` (infraestructura, cableado en el container) y una clase privada `LegacyNotifyAdapter` dentro de `pipeline.service.ts`, envolviendo la misma función `notifyUser`. El PipelineService no usa el notificador del composition root: tiene su propio duplicado.
- **Dos lógicas de retry:** `infrastructure/retry.ts` (genérico, nunca importado) y `domain/ai/llm-error.ts::withRetries` (específico LLM).
- **`infrastructure/circuit-breaker.ts`** — existe, nunca se importa. Muerto.
- **Comentarios obsoletos de BullMQ:** cuatro ficheros aún mencionan "JobQueue"/"BullMQ" que fue eliminado (marca `MOD-04`). Las cabeceras describen una arquitectura que ya no existe.
- **Código de parche visible:** `pipeline.service.ts` usa `await import(...)` + un regex `WAVE4_NOT_PRESENT` para saltarse silenciosamente módulos no implementados (`ConceptIntegrator`/`TreeBuilder`). Es una feature a medias mantenida viva con un try/catch.

### 4.5 Modelo de datos (Prisma + SQLite)

15 modelos: `Course`, `Material`, `Slide`, `SlideBox`, `TextChunk`, `Figure`, `SemanticUnit`, `UnitRepresentation`, `TopicNode`, `TopicGroup`, `Settings` (singleton), `ProcessingJob` (+ enum `SlideStatus`). El diseño es razonable para el dominio, pero con dos observaciones estructurales:

- **JSON-como-string por todas partes:** `figureRefs`, `tags`, `concepts`, `mainIdeas`, `formulas`, `prerequisites`, etc. se guardan como strings JSON en vez de tablas hijas. Funciona con N pequeño, pero bloquea cualquier consulta SQL sobre esos campos.
- **Sin modelo `User`, sin propiedad, sin ACL:** cada `id` es un token-capacidad; toda action es global. Aceptable para single-user local, pero es un muro para cualquier evolución multi-usuario.

---

## 5. Backend: flujos, pipeline y trabajos asíncronos

Aquí está la raíz técnica de la inestabilidad y la lentitud en las operaciones de IA.

### 5.1 Superficie del backend

- **5 rutas API** (`app/api/`): `upload` (huérfana, escribe a disco sin tocar BD — código muerto), `courses/[id]/materials/upload` (espejo HTTP de la action, existe solo para exponer progreso de subida), `export` (genera HTML en el propio request), `jobs/[jobId]/status` y `pipeline/[jobId]/status` (lecturas finas de `ProcessingJob` para el polling).
- **13 ficheros de server actions** (`lib/actions/`) — la superficie real de la aplicación.

### 5.2 El flujo del pipeline: cómo funciona hoy

Cuando el usuario pulsa "Generar árbol":

```
startPipelineAction(courseId)          [dentro del request HTTP]
  └─ container.processCourse.execute(courseId)
       └─ por cada Material del curso (bucle secuencial):
            └─ pipeline.service.runPhases():
                 1. segmentación   (Docling → secciones, o fallback pdf-parse)
                 2. extracción     (1 llamada LLM POR CADA unidad semántica, en bucle secuencial)
                 3. integración    (ConceptIntegrator — puede no existir → skip silencioso)
                 4. árbol          (TreeBuilder — idem)
```

**El problema central: TODO esto se ejecuta dentro del propio request HTTP.** No hay cola real, no hay worker de fondo, no hay resumibilidad. Con 5 materiales × 50 unidades cada uno, son **~250 llamadas secuenciales a OpenRouter de 3-15 s cada una, bloqueando el request**. Si el request expira o el usuario cierra la ventana, el trabajo se pierde y las filas `ProcessingJob` quedan en `status="running"` para siempre (no hay reconciliación al arrancar).

### 5.3 Riesgos concretos de fiabilidad y rendimiento (con evidencia)

- **Trabajo de larga duración en el handler del request** (patrón dominante): `startPipelineAction` bloquea el pipeline entero; `uploadMaterial` ejecuta 4 pasos IO secuenciales dentro del request (extraer texto → BD → indexar RAG → extraer figuras → parsear layout con timeout de 120 s de Docling).
- **Sin cola ni control de concurrencia entre requests:** dos clics en "Generar árbol" ejecutan el pipeline dos veces en paralelo, sin deduplicación, pisándose las filas `SemanticUnit`/`UnitRepresentation`.
- **`cancelPipelineAction` no cancela nada:** solo cambia la fila de BD a `cancelled`; el bucle en curso sigue ejecutándose hasta terminar.
- **Export PDF dentro de la action** (`slide-export.ts`): lanza un Chromium completo vía Playwright, espera KaTeX hasta 5 s, genera el PDF en memoria y lo codifica en base64. Para 60 diapositivas supera fácilmente los 30 s. (Y en el build MSI, Playwright ni siquiera está empaquetado — de ahí el crash arreglado en el CHANGELOG 0.2.0.)
- **RAG con consistencia "best-effort":** `RAGEngine.indexMaterial` escribe primero la transacción de BD y luego inserta en LanceDB "si puede". Si LanceDB falla, las búsquedas RAG devuelven cero resultados pese a que la BD está correcta, y no hay forma de re-indexar desde la UI.
- **`VectorStore.deleteByMaterialId` hace full-scan** de la tabla + filtrado en JS + delete por `IN` con ids interpolados sin escapar.
- **`generateSlideContent` hace una búsqueda RAG por cada material** en bucle secuencial (N embeddings + N búsquedas LanceDB por diapositiva).
- **Embeddings en una sola llamada gigante:** un material de 500 chunks se envía como un único POST que puede chocar con el timeout de 120 s.
- **Dimensión de embedding hardcodeada a 1536:** cambiar el modelo desincroniza silenciosamente el índice; no hay migración del vector store.
- **Escrituras N a BD:** `ProcessingJob.update` en cada unidad extraída, `createMinimalSlidesFromTree` con N `slide.create` en una transacción, `reorderSlides` con N updates en paralelo sin transacción.
- **Singleton de LLM a nivel de módulo** (`LLMClient.ts`): `const _provider = new OpenRouterLLMProvider()`. Imposible inyectar un mock o un circuit breaker sin mockear el módulo entero.

### 5.4 Lo que debería ser

- **Cola real + worker desacoplado del request:** el pipeline y el export deben ejecutarse fuera del ciclo de vida del request (en la arquitectura de escritorio objetivo, en un worker nativo o un runtime dedicado con backpressure).
- **Trabajos resumibles:** guardar fase + checkpoint en `ProcessingJob`; un hook de arranque que reconcilie trabajos `running` obsoletos a `failed` y ofrezca "reanudar".
- **Concurrencia gobernada por un semáforo** ligado a los límites de rate de OpenRouter, con circuit breaker en ráfagas de 429/5xx.
- **RAG transaccional o con reparación:** exponer una action `reindexMaterial`; usar el pushdown de filtro de LanceDB en lugar de full-scan.
- **Cancelación cooperativa real** (tokens de cancelación comprobados en el bucle).
- **Inyección del proveedor LLM** vía el composition root que ya existe.

---

## 6. Frontend: arquitectura, estado, rendimiento y estabilidad

Aquí está la raíz de la lentitud de navegación y de la inestabilidad que percibes en la interfaz.

### 6.1 Lo que hay: estructura

- Las páginas (`page.tsx`) sí son Server Components que consultan Prisma y pasan los datos como props (bien). Usan `Promise.all` para lecturas paralelas (bien).
- Pero 9 de 14 ficheros de `app/` y 32 de 41 componentes son Client Components (`"use client"`). El límite cliente/servidor está empujado demasiado abajo, y varios `page.tsx` entregan toda la carga a un único `*-client.tsx` gigante (p.ej. `tree-client.tsx` con 1011 líneas, `slides-client.tsx` con 1057).

### 6.2 Estabilidad: fallos graves

- **CERO error boundaries.** No existe ningún `error.tsx`, `global-error.tsx` ni `not-found.tsx` en toda la app. Si cualquier Server Component lanza una excepción (timeout de Prisma, un crash del pipeline en proceso), el usuario ve la pantalla de error por defecto de Next.js — en el escritorio, una pantalla blanca con un stack trace.
- **Los adapters se recrean en cada render** (`useSlideAdapter`, `useCourseAdapter`, `useMaterialAdapter` devuelven un objeto nuevo cada vez). Esto está documentado en el propio código (`slides-client.tsx`) como la causa de un bug de bucle infinito que tuvieron que parchear con un `slideAdapterRef`. Es deuda activa, no teórica.
- **`tree-client.tsx` sincroniza el mismo array `nodes` por tres caminos** (useState inicial, un `useEffect([initialNodes])` que hace merge, y un push-back al padre). Receta de actualizaciones perdidas y UI obsoleta tras cada `router.refresh()`.
- **`figure-gallery-client.tsx` hace `window.location.reload()`** tras extraer figuras — un recargado completo de la ventana Tauri donde bastaría un `router.refresh()`.

### 6.3 Estado global: stores muertos y duplicados

De 6 stores Zustand:
- **`useCourseStore`** guarda datos de servidor (`course`, `slides`, `materials`, `figures`) que **ningún componente lee**. Los adapters lo escriben; la UI lee de props locales. Trabajo puro desperdiciado y una fuente oculta de bugs de sincronización. Es el anti-patrón clásico "store global con datos de servidor".
- **`useGenerationStore`** — estado de generación plano, sin suscriptores en la UI (duplica `useSlideGenerationStore`).
- **`useUIStore.toasts`** — duplicado por el store de `components/toast.tsx`, que es el que realmente se usa.
- Solo 3 stores están genuinamente vivos y justificados (`usePipelineStore`, `useSlideGenerationStore`, `useJobsUIStore`).

### 6.4 Rendimiento: los cuellos de botella

- **4 pollers descoordinados** golpeando las mismas actions: `GlobalPipelineBanner` (cada 1,5 s), `JobsPanelContent` (1,5 s), `NavJobsButton` (3 s), `JobsPreview` (3 s). Más un `useTick(1000)` que **re-renderiza toda la barra global cada segundo**, esté o no corriendo un trabajo. El banner está montado en el layout raíz, así que esto ocurre en todas las páginas.
- **KaTeX + react-markdown en el bundle de cliente**, renderizado 5 veces por diapositiva en el detalle. El CSS de KaTeX (~270 KB) se carga globalmente en todas las páginas.
- **`slide-thumbnail.tsx` usa un `<iframe>` con `doc.write` por cada diapositiva:** una lista de 20 diapositivas crea 20 iframes, cada uno con un DOM 1280×720, re-escribiéndose en cada cambio de prop.
- **El detalle de diapositiva monta 2 iframes** (preview + modal) del mismo HTML, más un `ResizeObserver` que se destruye y recrea al abrir el modal (thrashing de layout).
- **ReactFlow + dagre recalculan el layout de todo el árbol** en cada toggle de selección (el `useMemo` depende del `Set` de seleccionados).
- **La memoización está anulada:** `TreeNode` y `SlideCard` usan `memo`, pero reciben objetos `data`/`Set`/`Map` recreados en cada render del padre, así que el memo nunca acierta.
- **`SlideGenerationQueue` hace busy-wait cada 50 ms** durante todo el lote de generación, manteniendo el event loop caliente.
- **Código muerto en el bundle:** `PwaRegister` (nunca montado), `upload-zone.tsx` (huérfano, solo acepta PDFs), `katex-renderer.tsx` (sin usar), `slide-block.tsx` (duplicado de `slide-card.tsx`, con su propio `setInterval` por tarjeta).

### 6.5 Lo que debería ser

- **Frontend autónomo (SPA)** que no dependa de un servidor por clic; datos vía IPC nativo o vía una capa de datos cliente con caché (React Query/SWR) y deduplicación de requests.
- **Error boundaries** por ruta y global, con recuperación elegante (crítico en escritorio).
- **Una única fuente de verdad** para los trabajos (un store con un solo poller y suscripciones) en lugar de 4 pollers.
- **Estado de servidor gestionado por el data layer**, no espejado en useState ni en stores globales muertos. React 19 `useOptimistic` + `useTransition` para las mutaciones.
- **Componentes pesados aislados y correctamente memoizados**; render de fórmulas y HTML fuera del hilo principal o virtualizado.
- **Eliminar todo el código muerto y las duplicaciones de componentes.**

---

## 7. Mapa de módulos y responsabilidades

Resumen de cada módulo principal, su responsabilidad **prevista** y su estado **real**.

| Módulo | Responsabilidad prevista | Estado real |
|---|---|---|
| `src-tauri/` (Rust) | Shell de escritorio nativo | Lanzador que arranca un servidor Node + puente mínimo (diálogos, extracción PDF). Sin UI nativa. Proceso hijo huérfano, sin health-check ni logs. |
| `app/` (rutas) | Enrutado y Server Components | Páginas servidor correctas, pero delegan a client components enormes. Sin error boundaries. |
| `app/api/` | Endpoints HTTP | 5 rutas; 1 huérfana; el resto son lecturas de estado para polling y espejos de actions. |
| `lib/actions/` | Entry points finos → casos de uso | Mosaico: 2 correctas, 3 mixtas, 4+ con bypass total. `tree.ts` y `slide-export.ts` son casos de uso disfrazados de action. |
| `lib/application/use-cases/` | Orquestación vía puertos | 2 ficheros ejemplares. El modelo a seguir. |
| `lib/application/*Service.ts` | Servicios de aplicación | Los 3 van directos a Prisma. `SlideService` es un fichero-dios de 581 líneas. |
| `lib/application/ports/` | Interfaces (contratos) | 13 puertos de libro; 7 nunca consumidos. |
| `lib/domain/` | Lógica de negocio pura | No es puro: importa BD, LanceDB, OpenRouter, Tauri, filesystem. |
| `lib/infrastructure/persistence/` | Adaptadores Prisma | 10 repositorios correctos. La pieza más limpia. |
| `lib/infrastructure/ai/` | Proveedores OpenRouter | Implementan sus puertos correctamente. |
| `lib/infrastructure/pipeline/` | Orquestación del pipeline | Funciona pero in-process, con notificador duplicado y código de parche (Wave 4). |
| `lib/infrastructure/queue/` | Cola de generación | Mal ubicada (es orquestador de aplicación); busy-wait de 50 ms; comentarios BullMQ obsoletos. |
| `lib/adapters/` | (nombre engañoso) hooks React | No son adaptadores hexagonales; son hooks cliente que se recrean cada render (bug de bucle). |
| `lib/composition/` | Composition root | Ejemplar, pero infrautilizado (pocas actions lo usan). |
| `lib/stores/` | Estado cliente | 3 vivos y justificados, 3 muertos/duplicados. |

---

## 8. Inventario de deuda: síntoma → causa raíz

Esta tabla conecta lo que percibes con la causa técnica exacta y el nivel de intervención necesario.

| Síntoma | Causa raíz | Nivel de intervención |
|---|---|---|
| Arranque lento | Cadena Tauri→Node→Next→Prisma + `sleep(3000)` a ciegas | Reescritura de despliegue |
| Navegación lenta | Cada ruta = request HTTP dinámico a Node + Prisma; sin caché cliente | Reescritura despliegue + frontend |
| Crashes al instalar/abrir | Servidor Node en standalone: rutas Windows, BD stub, WAL, binarios nativos ausentes | Reescritura de despliegue |
| Pantalla blanca ante errores | Cero error boundaries | Reescritura frontend |
| UI que "se pega" o hace bucles | Adapters recreados cada render; sync de estado por 3 caminos | Reescritura frontend/estado |
| Generación IA lenta/frágil | Pipeline in-process en el request; sin cola; sin resumibilidad | Reescritura de orquestación |
| PDF de peor calidad en la app | `AIZEA_SKIP_DOCLING=1` degrada silenciosamente | Rediseño de integración |
| "Vamos haciendo parches" | Hexagonal no respetado; duplicaciones; código muerto; comentarios obsoletos | Refactor del backend |
| Instalador pesado | Node 91 MB + standalone + nativos | Reescritura de despliegue |
| No hay actualizaciones | Updater no configurado | Configuración (rápido) |

---

## 9. Las tres opciones: rehacer, refactorizar o parchear

Planteaste tres caminos. Los evalúo con honestidad, incluyendo por qué el "producto mediocre" que temes es un resultado real de la opción equivocada.

### Opción 1 — Pequeñas modificaciones (parches)

**Qué sería:** arreglar el `sleep` con un health-check, redirigir logs, montar `PwaRegister`, configurar el updater, memoizar algún componente.

**Veredicto: DESCARTADA, y con razón.** Esto es exactamente lo que ha producido el estado actual. El `CHANGELOG` 0.2.0 es la prueba: cada parche resuelve un crash y planta la semilla del siguiente. Los defectos de fondo (web-as-app, in-process pipeline, cero error boundaries, hexagonal no respetado) **no son parcheables**: son decisiones estructurales. Parchear aquí garantiza el "producto mediocre" que quieres evitar. Coincido plenamente con tu instinto.

### Opción 2 — Reescritura completa desde cero (greenfield)

**Qué sería:** tirar todo el repositorio y empezar de nuevo.

**Veredicto: NO RECOMENDADA.** Desperdiciaría activos genuinamente valiosos y difíciles de recrear:
- El **modelo de dominio del producto** (cursos, materiales, unidades semánticas, árbol conceptual, los 5 "carriles": guion/relevancia/narrativa/ejercicio/diseño) está bien pensado y validado con la usuaria real (las notas de Bea en `PRODUCT.md`).
- Los **prompts de IA** y la lógica del pipeline (segmentación → extracción → integración → árbol) encapsulan conocimiento no trivial.
- El **esquema de datos** y los **repositorios Prisma** son sólidos.
- Los **puertos, casos de uso y composition root** ya definen la arquitectura correcta; el problema es que no se respetan, no que estén mal diseñados.

Reescribir desde cero reintroduce riesgo en partes que ya funcionan y alarga el tiempo sin necesidad.

### Opción 3 (RECOMENDADA) — Reescritura selectiva sobre núcleo preservado

**Qué es:** una intervención mayor, sin miedo, que **reemplaza las capas equivocadas y preserva+sanea el núcleo valioso.** Concretamente:

- **REEMPLAZAR (reescritura real):**
  1. La **capa de despliegue/ejecución**: eliminar el servidor Node del runtime; frontend estático + núcleo nativo Tauri/Rust vía IPC (§3.5, opción A).
  2. La **capa de frontend**: SPA autónoma, error boundaries, data layer con caché, estado saneado, componentes pesados aislados (§6.5).
  3. La **capa de orquestación**: cola real + worker desacoplado, trabajos resumibles, cancelación cooperativa (§5.4).

- **PRESERVAR Y SANEAR (refactor disciplinado, no reescritura):**
  4. El **núcleo de dominio** (pipeline IA, prompts, RAG, entidades): moverlo a un dominio genuinamente puro, detrás de los puertos que ya existen.
  5. El **modelo de datos y los repositorios Prisma**: casi intactos; corregir el JSON-como-string donde convenga.
  6. Los **casos de uso y el composition root**: extenderlos para que TODA action pase por ellos (eliminando los bypass y los ficheros-dios).

**Por qué esta es la opción "maravillosa" que pides:** ataca las causas raíz (no los síntomas), entrega las propiedades de escritorio real (arranque sub-segundo, navegación instantánea, estabilidad), y capitaliza el trabajo bueno que ya existe en lugar de desperdiciarlo. No es más lenta que el greenfield —es más rápida— porque no reconstruye el dominio ni los datos.

### Comparación

| Criterio | Parches | Greenfield | **Reescritura selectiva** |
|---|---|---|---|
| Resuelve web-as-app | No | Sí | **Sí** |
| Resuelve inestabilidad | No | Sí | **Sí** |
| Preserva dominio/datos/prompts | Sí | **No (los tira)** | **Sí** |
| Riesgo de regresión | Alto (acumulativo) | Alto (todo nuevo) | **Medio (núcleo estable)** |
| Resultado "maravilloso" | No (mediocre) | Sí | **Sí** |
| Tiempo relativo | Bajo pero infinito | Alto | **Medio** |

---

## 10. Arquitectura objetivo (frontend + backend + despliegue)

```
┌───────────────────────────────────────────────────────────────┐
│                      APLICACIÓN DE ESCRITORIO                    │
│                                                                 │
│  ┌───────────────────────────┐        ┌──────────────────────┐ │
│  │   FRONTEND (SPA estática)  │  IPC   │   NÚCLEO NATIVO       │ │
│  │   React + Vite             │◄──────►│   (Tauri / Rust)      │ │
│  │   - Router cliente         │ memoria│                       │ │
│  │   - Data layer + caché     │  local │  Comandos expuestos:  │ │
│  │   - Error boundaries       │        │  - datos (CRUD)       │ │
│  │   - Estado saneado         │        │  - pipeline (async)   │ │
│  │   Navegación INSTANTÁNEA   │        │  - export             │ │
│  └───────────────────────────┘        └──────────┬───────────┘ │
│                                                    │             │
│                            ┌───────────────────────┼───────────┐ │
│                            ▼                       ▼           ▼ │
│                     ┌────────────┐        ┌────────────┐ ┌──────┐│
│                     │  SQLite    │        │  LanceDB   │ │ FS   ││
│                     │ (nativo)   │        │ (vectorial)│ │uploads││
│                     └────────────┘        └────────────┘ └──────┘│
│                                                                 │
│   WORKER de fondo (cola real, resumible)                        │
│      └─ pipeline IA: segmentación→extracción→integración→árbol  │
│      └─ backpressure + circuit breaker → OpenRouter / Docling   │
└───────────────────────────────────────────────────────────────┘

  Núcleo de dominio PRESERVADO (puro, tras puertos):
  prompts · pipeline · RAG · entidades · casos de uso · composition root
```

**Principios de la arquitectura objetivo:**
1. **Sin servidor HTTP en el runtime de escritorio.** El frontend es autónomo; cruza a nativo solo por IPC en memoria.
2. **Dominio puro tras puertos.** Ninguna importación de infraestructura en `domain/`. TODA action pasa por un caso de uso.
3. **Trabajo asíncrono en un worker desacoplado**, resumible y cancelable, nunca dentro de un request.
4. **Estado de servidor en un data layer con caché**; nada de stores globales espejando datos.
5. **Errores contenidos** por boundaries en cada nivel.
6. **Un único camino** para cada operación (sin duplicados, sin código muerto).

**Nota sobre Docling:** en escritorio, Docling (que hoy se desactiva) debe resolverse de forma consciente: o bien empaquetar una alternativa nativa de parseo de layout, o bien indicar explícitamente al usuario que el parseo estructural requiere el servicio y ofrecer un modo degradado transparente (no silencioso).

---

## 11. Hoja de ruta por fases

Orientada a reducir riesgo entregando valor verificable en cada fase. Sin estimaciones de tiempo (el cliente indicó que tiempo y dinero no son la restricción; la calidad sí).

**Fase 0 — Red de seguridad (antes de tocar nada estructural).**
Instrumentar arranque y errores; capturar métricas reales (tiempo de arranque en frío, latencia de navegación, tasa de crash) para tener una línea base objetiva contra la que medir la mejora. Suite de tests E2E sobre los flujos críticos (crear curso → subir material → generar árbol → generar diapositiva → exportar) para bloquear regresiones.

**Fase 1 — Sanear el backend sobre la base hexagonal existente.**
Extraer la lógica de las actions-dios (`tree.ts`, `slide-export.ts`) y de los Services-dios (`SlideService`) a casos de uso detrás de los puertos que ya existen. Purificar el dominio (quitar imports de BD/infra). Consumir los 7 puertos huérfanos. Eliminar duplicados (figuras, PDF, notificador, retry) y código muerto (circuit-breaker sin usar, comentarios BullMQ). Enrutando TODO por el composition root. *Resultado: responsabilidades y capas claras — resuelve tu segunda preocupación.*

**Fase 2 — Desacoplar la orquestación.**
Introducir cola real + worker resumible + cancelación cooperativa + circuit breaker. Sacar el pipeline y el export fuera del request. Reparación/re-indexado de RAG. *Resultado: generación IA estable y no bloqueante.*

**Fase 3 — Reescribir el despliegue a escritorio real.**
Frontend estático + núcleo nativo Tauri vía IPC; eliminar el sidecar Node y el servidor Next.js del runtime. SQLite y LanceDB nativos. *Resultado: arranque sub-segundo, navegación instantánea, instalador pequeño, fin de la clase de crashes de "el servidor no arrancó" — resuelve tu preocupación central.*

**Fase 4 — Reescribir el frontend.**
SPA con router cliente, data layer con caché, error boundaries, estado saneado, componentes pesados aislados y memoizados. *Resultado: UI rápida y estable.*

**Fase 5 — Endurecer la distribución.**
Updater firmado, notarización macOS/firma Windows, builds multiplataforma reales (sidecars/targets por plataforma), CSP, cifrado de la API key en reposo. *Resultado: producto distribuible y actualizable con garantías.*

> Las fases 1 y 2 aportan valor aunque se ejecuten antes que el cambio de despliegue, porque sanean el núcleo que se preserva. La fase 3 es la que elimina la causa raíz de la mayoría de tus síntomas.

---

## 12. Riesgos y consideraciones

- **Docling en escritorio:** decisión de producto pendiente (empaquetar alternativa nativa vs. modo degradado transparente). No dejarlo silencioso.
- **Paridad de features web/escritorio:** hoy divergen (Docling). La arquitectura objetivo debe tener tests que aseguren paridad o documentar diferencias explícitas.
- **Migración de datos:** los usuarios existentes tienen datos en `%APPDATA%\AIzea`. Cualquier cambio de esquema o de motor de acceso necesita una migración probada.
- **Rendimiento del LLM:** la latencia de OpenRouter es intrínseca; la arquitectura solo puede paralelizar con gobierno de rate y dar feedback honesto de progreso (no barras falsas como la actual en subida de materiales).
- **Reaprovechar TypeScript del pipeline:** si se pasa el núcleo a Rust, hay coste de portado; una alternativa es mantener el pipeline en un runtime JS gestionado como worker nativo (menos ideal, pero preserva más código). Es una decisión a tomar al inicio de la Fase 3.

---

## 13. Conclusión

Tu diagnóstico intuitivo es correcto en los dos frentes:

1. **"Intenta desplegar una web como app"** — confirmado con evidencia irrefutable: un servidor Node de Next.js corriendo dentro de un webview. Es la causa raíz de la lentitud, el peso y la mayor parte de la inestabilidad.
2. **"Vamos haciendo parches; las responsabilidades y capas no están claras"** — confirmado: una arquitectura hexagonal bien dibujada pero mayoritariamente ignorada, con ficheros-dios, duplicaciones y código muerto.

La opción de "pequeños cambios" está correctamente descartada: produciría el producto mediocre que quieres evitar. La reescritura total desperdiciaría un núcleo de dominio valioso. **La vía para "algo maravilloso" es la reescritura selectiva: reemplazar las capas equivocadas (despliegue, frontend, orquestación) y preservar+sanear el núcleo (dominio, datos, prompts, puertos), siguiendo la hoja de ruta por fases.**

Existe una base buena enterrada bajo las decisiones equivocadas: el modelo de producto, los puertos, los casos de uso y el composition root demuestran que hubo un buen diseño en mente. El trabajo consiste en hacer que la realidad del código alcance a ese diseño, y en cambiar el vestido de "web empaquetada" por el de una aplicación de escritorio de verdad.

---

*Fin del informe. Documento de diagnóstico; no se ha modificado código.*
