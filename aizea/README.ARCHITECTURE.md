# Architecture

[◄ Index](./README.md) · Previous: [Build](./README.BUILD.md) · Next: [Modules ►](./README.MODULES.md)

AIzea follows a **hexagonal architecture** (ports and adapters). The domain is pure and knows nothing about infrastructure; the two are connected through interfaces (*ports*).

---

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│  UI / Entry                                                   │
│  app/ (React pages + API routes)  ·  components/  ·  stores/  │
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
                ▲ implements the ports
┌───────────────┴───────────────────────────────────────────────┐
│  Infrastructure — concrete adapters                            │
│  Prisma · LanceDB · OpenRouter · queue · encryption · notifier │
│  lib/infrastructure/                                          │
└───────────────────────────────────────────────────────────────┘
                ▲ wires everything
┌───────────────┴───────────────────────────────────────────────┐
│  Composition Root — dependency injection                       │
│  lib/composition/container.ts                                 │
└───────────────────────────────────────────────────────────────┘
```

**Golden rule:** dependencies point **inward**. `domain` imports nothing from `infrastructure`. `application` defines ports (interfaces) that `infrastructure` implements. The `container` is the only place that knows the concrete implementations.

See [Modules and folders](./README.MODULES.md) for a folder-by-folder reference.

---

## Ports and adapters

The **ports** live in [`lib/application/ports/`](./lib/application/ports/) (interfaces `I*Repository`, `I*Provider`, `IJobQueue`, etc.). Each has a concrete **adapter** in `lib/infrastructure/`:

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

This makes it possible to test the domain with test doubles and change an implementation (for example, another vector store) without touching business logic.

---

## The Composition Root

[`lib/composition/container.ts`](./lib/composition/container.ts) builds and wires **all** dependencies into a single `container` object. It accepts *overrides* for tests. Among other things, it exposes:

- Repositories (`courses`, `materials`, `slides`, `processingJobs`, `settings`, etc.)
- Use cases (`processCourse`, `uploadMaterial`)
- Services (`CourseService`, `SlideService`, `TreeService`, `ExportService`, etc.)
- Pipeline infrastructure (`jobQueue`, `pipelineWorker`)

Everything consumed from `app/` or `lib/actions/` goes through `container`; adapters are never instantiated directly.

---

## Process model (desktop)

The desktop build has **two processes**:

1. **Tauri shell (Rust)** — [`src-tauri/src/lib.rs`](./src-tauri/src/lib.rs): native window + backend **supervisor** (spawn, health check, restart, logs).
2. **Next.js server (Node, sidecar)** — serves the UI and API routes on `:1422`, and runs the pipeline.

The pipeline worker starts at the process level through the first poll of `/api/health` (see [Pipeline](./README.PIPELINE.md#worker-startup)). In development, both roles are handled by `next dev`.

---

## Data flow (PDF upload → slides)

```
User uploads PDF
   │
   ▼
uploadMaterial (use case) ──► saves Material + parses PDF (docling/pdf-parse)
   │
   ▼
startPipelineAction ──► IJobQueue.enqueue(pipeline-run)  [non-blocking]
   │                          │
   │                          ▼
   │                    PipelineWorker.pump()  [background]
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

See [Generation pipeline](./README.PIPELINE.md) for details on each phase and resumability.

---

## Frontend: data layer and state

- **Server actions** ([`lib/actions/`](./lib/actions/)) — the historical UI-to-server path.
- **`ApiClient`** ([`lib/client/api-client.ts`](./lib/client/api-client.ts)) — typed data layer with TTL caching, in-flight request deduplication, and invalidation. The basis for decoupling the UI (the *strangler-fig* strategy).
- **Zustand** ([`lib/stores/`](./lib/stores/)) — client state (pipeline banner, UI, generation). `usePipelineStore` bounds its job map to prevent memory leaks.
- **Error boundaries** ([`components/ErrorBoundary/`](./components/ErrorBoundary/), `app/error.tsx`, `app/global-error.tsx`).

See [API and actions](./README.API.md) for concrete contracts.

---

[◄ Index](./README.md) · Previous: [Build](./README.BUILD.md) · Next: [Modules ►](./README.MODULES.md)
