# Generation pipeline

[◄ Index](./README.md) · Previous: [Modules](./README.MODULES.md) · Next: [API ►](./README.API.md)

How AIzea processes a PDF into a concept tree and slides using a persistent queue and resumable worker.

---

## Overview

The pipeline does **not block** the user's request. When the user clicks "generate", a run is **queued** and a worker drains it in the background. The UI reflects progress through *polling*.

```
startPipelineAction(courseId)
   │  validates course + checks for materials (NO_MATERIALS if none)
   ▼
IJobQueue.enqueue({ courseId })  ──►  devuelve { enqueued:true, runId }  [retorna YA]
   │
   ▼  (fire-and-forget)
PipelineWorker.pump()  ──►  claimNext() ──► processCourse() ──► markCompleted/Failed/Cancelled
```

---

## Components

| Component | File | Role |
|---|---|---|
| **Queue port** | [`lib/application/ports/job-queue.port.ts`](./lib/application/ports/job-queue.port.ts) | `IJobQueue` interface |
| **Persistent queue** | [`lib/infrastructure/queue/prisma-job-queue.ts`](./lib/infrastructure/queue/prisma-job-queue.ts) | Backed by `ProcessingJob` (`type="pipeline-run"`) |
| **Worker** | [`lib/infrastructure/queue/pipeline-worker.ts`](./lib/infrastructure/queue/pipeline-worker.ts) | `pump()` + `recover()` |
| **Bootstrap** | [`lib/infrastructure/queue/worker-bootstrap.ts`](./lib/infrastructure/queue/worker-bootstrap.ts) | Process-level startup |
| **Pipeline** | [`lib/infrastructure/pipeline/pipeline.service.ts`](./lib/infrastructure/pipeline/pipeline.service.ts) | Implementa `IPipeline`, corre las 4 fases |
| **Caso de uso** | [`lib/application/use-cases/process-course.use-case.ts`](./lib/application/use-cases/process-course.use-case.ts) | Orquesta `processCourse` |

---

## The four phases

`PipelineService` runs the phases **in order**, each with its own progress, and fails fast if one throws:

1. **Segmentation** — `SegmenterService` splits the material into manageable segments.
2. **Extraction** — `UnitExtractor` extracts semantic units (one `extract-unit` task per unit).
3. **Integration** — `ConceptIntegrator` integrates concepts (soft-skip if the module is unavailable).
4. **Tree construction** — `TreeBuilder` builds the `TopicNode` tree (soft-skip if unavailable).

The result is the navigable concept tree plus content indexed in RAG. Slides are generated afterward, on demand.

---

## Queue: `IJobQueue`

The *meta* row for each run uses `ProcessingJob` with `type="pipeline-run"` (no new table was created, to avoid breaking migration replay in tests). Methods:

| Method | Function |
|---|---|
| `enqueue(input)` | Creates the run in `pending` state and returns `{ runId }` |
| `claimNext()` | Atomically claims the next `pending` → `running` job |
| `markCompleted / markFailed / markCancelled` | Transiciones terminales |
| `findRun(runId)` | Consulta un run |
| `recoverStale(olderThanMs)` | Devuelve a `pending` los `running` vetustos (resumibilidad) |

The progress banner **excludes** `type="pipeline-run"` (it is a meta row, not a visible phase).

---

## Worker: `PipelineWorker`

- **`pump()`** — drains the queue: claims runs and executes `runCourse` (= `processCourse.execute`) until empty. It is **reentrant**: if a drain is already running, it returns the same promise (no double execution).
- **`recover()`** — calls `recoverStale(staleAfterMs)` (default **10 min**): a run left `running` by a crash returns to `pending` and is reprocessed.
- **Result mapping:** success → `completed`; `PipelineCancelledError` → `cancelled`; other throw → `failed` (a failure does **not jam** the queue; the rest continues).

---

## Worker startup

The worker starts at **process** level (not only per request), through [`worker-bootstrap.ts`](./lib/infrastructure/queue/worker-bootstrap.ts):

- `bootstrapWorkerOnce({ recover, pump })` — recovers stale runs and starts the pump **once per process**. It never throws (a bootstrap failure must not break startup).
- It is invoked by the **`/api/health`** route handler (Node runtime, where native dependencies load correctly). The Tauri supervisor polls `/api/health` at startup, triggering the boot effect.

> **Historical note:** this originally lived in a root `instrumentation.ts`, but that pulled the native LanceDB binary into the edge/browser bundle and broke the build. It was moved to `/api/health`. There must be no root `instrumentation.ts`.

---

## Cooperative cancellation

Cancelling a job sets its state to `cancelled`; the extraction loop checks that state and stops (throwing `PipelineCancelledError`), which the worker maps to a `cancelled` run. See the endpoint in [API](./README.API.md#cancel-a-run).

---

## Guarantees (tested in integration tests)

`tests/integration/pipeline-queue.test.ts` verifies the phase *gate*:

- Encolar **no bloquea** aunque el pipeline sea lento.
- The queue **drains multiple** runs.
- Es **cancelable**.
- A failure **does not jam** the queue.
- Es **resumible** (run `running` vetusto → recover → reprocesa).

See [Testing](./README.TESTING.md).

---

[◄ Index](./README.md) · Previous: [Modules](./README.MODULES.md) · Next: [API ►](./README.API.md)
