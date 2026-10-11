# Modules and folders

[◄ Index](./README.md) · Previous: [Architecture](./README.ARCHITECTURE.md) · Next: [Pipeline ►](./README.PIPELINE.md)

Reference for each project directory and its responsibilities.

---

## `app/` — Next.js App Router

UI pages (React Server/Client Components) + REST API routes.

### Pages

| Route | File | Function |
|---|---|---|
| `/` | `app/page.tsx` | Home: course list |
| `/courses/[id]` | `app/courses/[id]/page.tsx` | Course view (layout with `layout.tsx`) |
| `/courses/[id]/materials` | `.../materials/page.tsx` | Course materials (PDFs) |
| `/courses/[id]/tree` | `.../tree/page.tsx` | Concept tree (TreeViewer) |
| `/courses/[id]/slides` | `.../slides/page.tsx` | Slide list |
| `/courses/[id]/slides/[slideId]` | `.../slides/[slideId]/page.tsx` | Slide editor |
| `/courses/[id]/figures` | `.../figures/page.tsx` | Extracted figures |
| `/jobs` | `app/jobs/page.tsx` | Pipeline jobs panel |
| `/settings` | `app/settings/page.tsx` | Settings (API key, models) |

### API routes — see [API and actions](./README.API.md) for complete contracts.

---

## `lib/` — core (hexagonal architecture)

### `lib/domain/` — pure business logic

| Subdirectory | Contents |
|---|---|
| `pipeline/` | `SegmenterService`, `UnitExtractor`, `ConceptIntegrator`, `IncrementalMerger`, `TreeBuilder` — pipeline phases |
| `rag/` | `RAGEngine`, `TextChunker` — semantic search |
| `pdf/` | `PDFService`, `LayoutParser` — text/structure extraction |
| `figures/` | `FigureExtractor`, `figure-references` — image extraction |
| `prompts/` | `PromptManager` + `templates/` — LLM prompt templates |
| `entities/` | `course`, `material` — domain entities |
| `utils/` | `image-compressor`, `latex-renderer` |
| `ai/` | `llm-error` — LLM domain errors |

### `lib/application/` — use cases + ports

| Element | Function |
|---|---|
| `ports/` | **Interfaces** (24 ports): `I*Repository`, `I*Provider`, `IJobQueue`, `IPipeline`, `INotifier`… |
| `use-cases/process-course.use-case.ts` | Orchestrates the complete course pipeline |
| `use-cases/upload-material.use-case.ts` | Uploads and parses a PDF |
| `CourseService` · `SlideService` · `SlideCrudService` · `SlideBoxService` · `SlideGenerationService` · `TreeService` · `ExportService` | Application services |
| `health.ts` | Readiness logic (testable, without Next) |

### `lib/infrastructure/` — concrete adapters

| Subdirectory | Contents |
|---|---|
| `persistence/` | ~15 `Prisma*Repository` — implement repository ports |
| `ai/` | `OpenRouterLLMProvider`, `OpenRouterEmbeddingProvider`, `llm-client`, `openrouter-breakers`, `embedding-service` |
| `rag/` | `LanceDBVectorStore`, `rag-engine.factory` |
| `queue/` | `PrismaJobQueue`, `PipelineWorker`, `worker-bootstrap`, `SlideGenerationQueue` |
| `pipeline/` | `PipelineService` — implements `IPipeline` |
| `pdf/` | `pdf-render.service`, `pdf-service-tauri` |
| `crypto/` | `secret-cipher` — AES-256-GCM encryption for the API key |
| `notifications/` | `InAppNotifier` |
| `figures/` | `figure-store` |
| root | `circuit-breaker`, `retry`, `errors` — cross-cutting utilities |

### Other `lib/` directories

| Folder | Function |
|---|---|
| `composition/` | `container.ts` — dependency injection (single wiring point) |
| `actions/` | Next server actions (`course`, `slide`, `pipeline`, `settings`, `tree`, `figure`, `box`, `material`, `generate`, `export`…) |
| `client/` | `api-client.ts` — typed data layer with caching |
| `stores/` | Zustand: `usePipelineStore`, `useCourseStore`, `useUIStore`, `useJobsUIStore`, `useGenerationStore`, `useSlideGenerationStore` |
| `types/` | Shared types (`CourseSummary`, `pipeline`, `slide`…) |
| `adapters/` · `utils/` | Supporting adapters and utilities |

---

## `components/` — React components

| Subdirectory | Contents |
|---|---|
| `course/` | Course-view components (checkpoint bar, status icons…) |
| `slides/` | Slide editor and renderer |
| `TreeViewer/` | Concept-tree viewer (ReactFlow + dagre) |
| `PipelineProgress/` | `GlobalPipelineBanner` — pipeline progress banner |
| `ErrorBoundary/` | Reusable error boundary |
| `ui/` | UI primitives (shadcn style: buttons, inputs…) |

---

## `src-tauri/` — desktop shell (Rust)

| File | Function |
|---|---|
| `src/lib.rs` | Entry point: Node sidecar supervision, health polling, menus, commands |
| `src/main.rs` | Startup |
| `src/pdf_parser.rs` | Native PDF parser (`extract_pdf` command) |
| `tauri.conf.json` | Config: ventana, bundle MSI/NSIS, sidecar |
| `capabilities/default.json` | Permisos de plugins |
| `Cargo.toml` | Dependencias Rust |

---

## `prisma/`, `scripts/`, `tests/`

- **`prisma/`** — `schema.prisma` (13 models), `migrations/`, `dev.db`. See [Data](./README.DATA.md).
- **`scripts/`** — `start-local.cjs`, `build-msi.cjs`, `wal-checkpoint.cjs`, `check-docling.cjs` + QA/inspection utilities.
- **`tests/`** — 83 files (unit + integration). See [Testing](./README.TESTING.md).

---

[◄ Index](./README.md) · Previous: [Architecture](./README.ARCHITECTURE.md) · Next: [Pipeline ►](./README.PIPELINE.md)
