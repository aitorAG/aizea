# Architecture

[◄ Index](./README.md) · Previous: [Build](./README.BUILD.md) · Next: [Modules ►](./README.MODULES.md)

AIzea follows **hexagonal architecture** (ports and adapters). The domain is pure and does not know about infrastructure; they connect through interfaces (*ports*).

---

## Capas

```
┌─────────────────────────────────────────────────────────────┐
│  UI / Entrada                                                 │
│  app/ (React pages + API routes)  ·  components/  ·  stores/ │
└───────────────┬───────────────────────────────────────────────┘
                │ server actions (lib/actions) · ApiClient (lib/client)
┌───────────────▼───────────────────────────────────────────────┐
│  Application — use cases + PORTS (interfaces)                  │
│  lib/application/use-cases/   lib/application/ports/           │
│  lib/application/*Service.ts                                   │
└───────────────┬───────────────────────────────────────────────┘
                │ depends ONLY on ports (interfaces)
┌───────────────▼───────────────────────────────────────────────┐
│  Domain — PURE business logic                                  │
│  lib/domain/ (pipeline, rag, pdf, figures, prompts, entities) │
└───────────────────────────────────────────────────────────────┘
                ▲ implementa los puertos
┌───────────────┴───────────────────────────────────────────────┐
│  Infrastructure — adaptadores concretos                       │
│  Prisma · LanceDB · OpenRouter · queue · encryption · notifier │
│  lib/infrastructure/                                          │
└───────────────────────────────────────────────────────────────┘
                ▲ cablea todo
┌───────────────┴───────────────────────────────────────────────┐
│  Composition Root — dependency injection                       │
│  lib/composition/container.ts                                 │
└───────────────────────────────────────────────────────────────┘
```

**Golden rule:** dependencies point **inward**. `domain` imports nothing from `infrastructure`. `application` defines ports (interfaces) implemented by `infrastructure`. The `container` is the only place that knows concrete implementations.

See the directory-by-directory reference in [Modules and folders](./README.MODULES.md).

---

## Ports and adapters

**Ports** live in [`lib/application/ports/`](./lib/application/ports/) (interfaces `I*Repository`, `I*Provider`, `IJobQueue`, and so on). Each has a concrete **adapter** in `lib/infrastructure/`:

| Port (interface) | Adapter (implementation) |
|---|---|
| `ICourseRepository` | `PrismaCourseRepository` |
| `IVectorStore` | `LanceDBVectorStore` |
| `ILLMProvider` | `OpenRouterLLMProvider` |
| `IEmbeddingProvider` | `OpenRouterEmbeddingProvider` |
| `IJobQueue` | `PrismaJobQueue` |
| `IPipeline` | `PipelineService` |
| `INotifier` | `InAppNotifier` |
| `ISettingsRepository` | `PrismaSettingsRepository` |

This allows the domain to be tested with doubles and an implementation to be changed (for example, another vector store) without touching business logic.

---

## The Composition Root

[`lib/composition/container.ts`](./lib/composition/container.ts) builds and wires **all** dependencies into a single `container` object. It accepts *overrides* for tests. It exposes, among others:

- Repositorios (`courses`, `materials`, `slides`, `processingJobs`, `settings`…)
- Casos de uso (`processCourse`, `uploadMaterial`)
- Servicios (`CourseService`, `SlideService`, `TreeService`, `ExportService`…)
- Infraestructura de pipeline (`jobQueue`, `pipelineWorker`)

Todo consumo desde `app/` o `lib/actions/` pasa por `container`, nunca instancia adaptadores directamente.

---

## Process model (desktop)

The desktop build has **two processes**:

1. **Shell Tauri (Rust)** — [`src-tauri/src/lib.rs`](./src-tauri/src/lib.rs): ventana nativa + **supervisor** del backend (spawn, health-check, reinicio, logs).
2. **Servidor Next.js (Node, sidecar)** — sirve la UI y las rutas API en `:1422`, ejecuta el pipeline.

The pipeline worker starts at process level through the first `/api/health` poll (see [Pipeline](./README.PIPELINE.md#worker-startup)). In development, both roles are handled by `next dev`.

---

## Data flow (PDF upload → slides)

```
User uploads PDF
   │
   ▼
uploadMaterial (use case) ──► saves Material + parses PDF (docling/pdf-parse)
   │
   ▼
startPipelineAction ──► IJobQueue.enqueue(pipeline-run)  [no bloquea]
   │                          │
   │                          ▼
   │                    PipelineWorker.pump()  [en fondo]
   │                          │
   ▼                          ▼
Banner (polling)      processCourse:  Segmentation ─► Extraction ─►
                                       Integration ─► Tree construction
                                          │
                                          ▼
                                     TopicNode (tree) + indexed RAG
                                          │
                                          ▼
                               Slide generation (on demand)
```

Details for each phase and resumability are in the [Generation pipeline](./README.PIPELINE.md).

---

## Frontend: data layer and state

- **Server actions** ([`lib/actions/`](./lib/actions/)) — the historical UI-to-server path.
- **`ApiClient`** ([`lib/client/api-client.ts`](./lib/client/api-client.ts)) — typed data layer with TTL cache, in-flight request deduplication, and invalidation. Base for decoupling the UI (the *strangler-fig* strategy).
- **Zustand** ([`lib/stores/`](./lib/stores/)) — client state (pipeline banner, UI, generation). `usePipelineStore` bounds its job map to prevent memory leaks.
- **Error boundaries** ([`components/ErrorBoundary/`](./components/ErrorBoundary/), `app/error.tsx`, `app/global-error.tsx`).

Concrete contracts are in [API and actions](./README.API.md).

---

[◄ Index](./README.md) · Previous: [Build](./README.BUILD.md) · Next: [Modules ►](./README.MODULES.md)
