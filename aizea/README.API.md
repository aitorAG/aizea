# API and actions

[◄ Index](./README.md) · Previous: [Pipeline](./README.PIPELINE.md) · Next: [Data ►](./README.DATA.md)

Contracts for REST routes, server actions, and the client data layer.

---

## Rutas REST (`app/api/`)

Base en dev: `http://localhost:3001` · en escritorio: `http://localhost:1422`.

### Health

| Method | Route | Response |
|---|---|---|
| `GET` | `/api/health` | `200 {status:"ok",db:true,version,timestamp}` · `503` si la DB no responde |

It also triggers worker bootstrap (see [Pipeline](./README.PIPELINE.md#worker-startup)). File: [`app/api/health/route.ts`](./app/api/health/route.ts).

### Courses

| Method | Route | Function |
|---|---|---|
| `GET` | `/api/courses` | Lists courses → `{ok,courses}` |
| `POST` | `/api/courses` | Creates course `{name}` → `201 {ok,id}` · `400` without name |
| `GET` | `/api/courses/[id]` | Details (course + slides + materials + figures) · `404` |
| `PATCH` | `/api/courses/[id]` | Updates `name`/`llmContext` · `400` if nothing to update |
| `DELETE` | `/api/courses/[id]` | Deletes the course |

Ficheros: [`app/api/courses/route.ts`](./app/api/courses/route.ts), [`app/api/courses/[id]/route.ts`](./app/api/courses/[id]/route.ts).

### Pipeline

| Method | Route | Function |
|---|---|---|
| `POST` | `/api/pipeline/start` | Queues a run `{courseId}` → `200 {ok,enqueued,runId}` or `{ok,empty,reason:"NO_MATERIALS"}` · `404` course · `400` without courseId |
| `GET` | `/api/pipeline/[jobId]/status` | Job status (phase, status, progress…) · `404` |
| `POST` | `/api/pipeline/[jobId]/cancel` | Cancels a run/phase (idempotent) · `404` |
| `GET` | `/api/jobs/[jobId]/status` | ProcessingJob status (for polling) |

<a id="cancel-a-run"></a>Files: [`app/api/pipeline/start/route.ts`](./app/api/pipeline/start/route.ts), [`app/api/pipeline/[jobId]/cancel/route.ts`](./app/api/pipeline/[jobId]/cancel/route.ts).

### Materials and export

| Method | Route | Function |
|---|---|---|
| `POST` | `/api/courses/[id]/materials/upload` | Uploads a PDF to the course |
| `POST` | `/api/upload` | Generic upload |
| `GET`/`POST` | `/api/export` | Content export |

> **Design note:** REST routes **delegate** to server actions (they do not duplicate logic). They exist so a future client without server actions (for example, an SPA) can operate over HTTP.

---

## Server actions (`lib/actions/`)

The UI-to-Next-server path. Files by domain:

| File | Main actions |
|---|---|
| [`course.ts`](./lib/actions/course.ts) | `getCourses`, `getCourse`, `createCourse`, `updateCourse`, `deleteCourse`, `updateCourseContext` |
| [`pipeline.ts`](./lib/actions/pipeline.ts) | `startPipelineAction`, `getJobStatusAction`, `listActiveJobsAction`, `listFinishedJobsAction`, `cancelPipelineAction` |
| [`slide.ts`](./lib/actions/slide.ts) · `generate.ts` · `slide-export.ts` | Slide CRUD and generation, export |
| [`tree.ts`](./lib/actions/tree.ts) | Concept-tree operations |
| [`figure.ts`](./lib/actions/figure.ts) · `box.ts` · `material.ts` | Figures, slide boxes, materials |
| [`settings.ts`](./lib/actions/settings.ts) | `getSettingsAction`, `updateSettingsAction` (encrypts the API key — see [Security](./README.SECURITY.md)) |

All go through the `container` ([Composition Root](./README.ARCHITECTURE.md#the-composition-root)).

---

## Client data layer: `ApiClient`

[`lib/client/api-client.ts`](./lib/client/api-client.ts) — typed, framework-agnostic, injectable client over `fetch` (`fetchImpl`, `now`). It provides:

- **Typed responses** `ApiResult<T>` (discriminated by `ok`; zero `any`).
- **TTL cache** for GETs (mutations invalidate relevant keys).
- **In-flight deduplication** (identical concurrent GETs share one request).

Methods: `listCourses`, `getCourse`, `createCourse`, `updateCourse`, `deleteCourse`, `startRun`, `getJobStatus` (uncached), `cancelRun`. `getJobStatus` bypasses the cache (it changes quickly).

---

## Client state (Zustand)

| Store | Function |
|---|---|
| [`usePipelineStore`](./lib/stores/usePipelineStore.ts) | Jobs del pipeline para el banner (mapa acotado a `MAX_JOBS` para evitar fugas) |
| `useCourseStore` · `useUIStore` · `useJobsUIStore` | Course and UI state |
| `useGenerationStore` · `useSlideGenerationStore` | Slide-generation state |

---

[◄ Index](./README.md) · Previous: [Pipeline](./README.PIPELINE.md) · Next: [Data ►](./README.DATA.md)
