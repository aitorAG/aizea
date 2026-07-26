# Módulos y carpetas

[◄ Índice](./README.md) · Anterior: [Arquitectura](./README.ARCHITECTURE.md) · Siguiente: [Pipeline ►](./README.PIPELINE.md)

Referencia de cada directorio del proyecto y sus responsabilidades.

---

## `app/` — Next.js App Router

Páginas de UI (React Server/Client Components) + rutas API REST.

### Páginas

| Ruta | Fichero | Función |
|---|---|---|
| `/` | `app/page.tsx` | Home: lista de cursos |
| `/courses/[id]` | `app/courses/[id]/page.tsx` | Vista del curso (layout con `layout.tsx`) |
| `/courses/[id]/materials` | `.../materials/page.tsx` | Materiales (PDFs) del curso |
| `/courses/[id]/tree` | `.../tree/page.tsx` | Árbol conceptual (TreeViewer) |
| `/courses/[id]/slides` | `.../slides/page.tsx` | Lista de diapositivas |
| `/courses/[id]/slides/[slideId]` | `.../slides/[slideId]/page.tsx` | Editor de diapositiva |
| `/courses/[id]/figures` | `.../figures/page.tsx` | Figuras extraídas |
| `/jobs` | `app/jobs/page.tsx` | Panel de trabajos del pipeline |
| `/settings` | `app/settings/page.tsx` | Configuración (API key, modelos) |

### Rutas API — ver [API y acciones](./README.API.md) para contratos completos.

---

## `lib/` — núcleo (arquitectura hexagonal)

### `lib/domain/` — lógica de negocio pura

| Subcarpeta | Contenido |
|---|---|
| `pipeline/` | `SegmenterService`, `UnitExtractor`, `ConceptIntegrator`, `IncrementalMerger`, `TreeBuilder` — las fases del pipeline |
| `rag/` | `RAGEngine`, `TextChunker` — búsqueda semántica |
| `pdf/` | `PDFService`, `LayoutParser` — extracción de texto/estructura |
| `figures/` | `FigureExtractor`, `figure-references` — extracción de imágenes |
| `prompts/` | `PromptManager` + `templates/` — plantillas de prompts LLM |
| `entities/` | `course`, `material` — entidades de dominio |
| `utils/` | `image-compressor`, `latex-renderer` |
| `ai/` | `llm-error` — errores de dominio del LLM |

### `lib/application/` — casos de uso + puertos

| Elemento | Función |
|---|---|
| `ports/` | **Interfaces** (24 puertos): `I*Repository`, `I*Provider`, `IJobQueue`, `IPipeline`, `INotifier`… |
| `use-cases/process-course.use-case.ts` | Orquesta el pipeline completo de un curso |
| `use-cases/upload-material.use-case.ts` | Sube y parsea un PDF |
| `CourseService` · `SlideService` · `SlideCrudService` · `SlideBoxService` · `SlideGenerationService` · `TreeService` · `ExportService` | Servicios de aplicación |
| `health.ts` | Lógica de readiness (testeable, sin Next) |

### `lib/infrastructure/` — adaptadores concretos

| Subcarpeta | Contenido |
|---|---|
| `persistence/` | ~15 `Prisma*Repository` — implementan los puertos de repositorio |
| `ai/` | `OpenRouterLLMProvider`, `OpenRouterEmbeddingProvider`, `llm-client`, `openrouter-breakers`, `embedding-service` |
| `rag/` | `LanceDBVectorStore`, `rag-engine.factory` |
| `queue/` | `PrismaJobQueue`, `PipelineWorker`, `worker-bootstrap`, `SlideGenerationQueue` |
| `pipeline/` | `PipelineService` — implementa `IPipeline` |
| `pdf/` | `pdf-render.service`, `pdf-service-tauri` |
| `crypto/` | `secret-cipher` — cifrado AES-256-GCM de la API key |
| `notifications/` | `InAppNotifier` |
| `figures/` | `figure-store` |
| raíz | `circuit-breaker`, `retry`, `errors` — utilidades transversales |

### Otras carpetas de `lib/`

| Carpeta | Función |
|---|---|
| `composition/` | `container.ts` — inyección de dependencias (único punto de cableado) |
| `actions/` | Server actions de Next (`course`, `slide`, `pipeline`, `settings`, `tree`, `figure`, `box`, `material`, `generate`, `export`…) |
| `client/` | `api-client.ts` — data-layer tipado con caché |
| `stores/` | Zustand: `usePipelineStore`, `useCourseStore`, `useUIStore`, `useJobsUIStore`, `useGenerationStore`, `useSlideGenerationStore` |
| `types/` | Tipos compartidos (`CourseSummary`, `pipeline`, `slide`…) |
| `adapters/` · `utils/` | Adaptadores y utilidades auxiliares |

---

## `components/` — componentes React

| Subcarpeta | Contenido |
|---|---|
| `course/` | Componentes de la vista de curso (checkpoint bar, iconos de estado…) |
| `slides/` | Editor y render de diapositivas |
| `TreeViewer/` | Visor del árbol conceptual (ReactFlow + dagre) |
| `PipelineProgress/` | `GlobalPipelineBanner` — banner de progreso del pipeline |
| `ErrorBoundary/` | Error boundary reutilizable |
| `ui/` | Primitivas de UI (estilo shadcn: botones, inputs…) |

---

## `src-tauri/` — shell de escritorio (Rust)

| Fichero | Función |
|---|---|
| `src/lib.rs` | Entry point: supervisión del sidecar Node, health-poll, menús, comandos |
| `src/main.rs` | Arranque |
| `src/pdf_parser.rs` | Parser PDF nativo (comando `extract_pdf`) |
| `tauri.conf.json` | Config: ventana, bundle MSI/NSIS, sidecar |
| `capabilities/default.json` | Permisos de plugins |
| `Cargo.toml` | Dependencias Rust |

---

## `prisma/`, `scripts/`, `tests/`

- **`prisma/`** — `schema.prisma` (13 modelos), `migrations/`, `dev.db`. Ver [Datos](./README.DATA.md).
- **`scripts/`** — `start-local.cjs`, `build-msi.cjs`, `wal-checkpoint.cjs`, `check-docling.cjs` + utilidades de QA/inspección.
- **`tests/`** — 83 ficheros (unit + integration). Ver [Testing](./README.TESTING.md).

---

[◄ Índice](./README.md) · Anterior: [Arquitectura](./README.ARCHITECTURE.md) · Siguiente: [Pipeline ►](./README.PIPELINE.md)
