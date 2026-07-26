# API y acciones

[◄ Índice](./README.md) · Anterior: [Pipeline](./README.PIPELINE.md) · Siguiente: [Datos ►](./README.DATA.md)

Contratos de las rutas REST, los server actions y el data-layer cliente.

---

## Rutas REST (`app/api/`)

Base en dev: `http://localhost:3001` · en escritorio: `http://localhost:1422`.

### Salud

| Método | Ruta | Respuesta |
|---|---|---|
| `GET` | `/api/health` | `200 {status:"ok",db:true,version,timestamp}` · `503` si la DB no responde |

Además dispara el bootstrap del worker (ver [Pipeline](./README.PIPELINE.md#arranque-del-worker)). Fichero: [`app/api/health/route.ts`](./app/api/health/route.ts).

### Cursos

| Método | Ruta | Función |
|---|---|---|
| `GET` | `/api/courses` | Lista de cursos → `{ok,courses}` |
| `POST` | `/api/courses` | Crea curso `{name}` → `201 {ok,id}` · `400` sin name |
| `GET` | `/api/courses/[id]` | Detalle (curso + slides + materiales + figuras) · `404` |
| `PATCH` | `/api/courses/[id]` | Actualiza `name`/`llmContext` · `400` si nada que actualizar |
| `DELETE` | `/api/courses/[id]` | Borra el curso |

Ficheros: [`app/api/courses/route.ts`](./app/api/courses/route.ts), [`app/api/courses/[id]/route.ts`](./app/api/courses/[id]/route.ts).

### Pipeline

| Método | Ruta | Función |
|---|---|---|
| `POST` | `/api/pipeline/start` | Encola un run `{courseId}` → `200 {ok,enqueued,runId}` o `{ok,empty,reason:"NO_MATERIALS"}` · `404` curso · `400` sin courseId |
| `GET` | `/api/pipeline/[jobId]/status` | Estado de un job (fase, status, progreso…) · `404` |
| `POST` | `/api/pipeline/[jobId]/cancel` | Cancela un run/fase (idempotente) · `404` |
| `GET` | `/api/jobs/[jobId]/status` | Estado de un ProcessingJob (para polling) |

<a id="cancelar-un-run"></a>Ficheros: [`app/api/pipeline/start/route.ts`](./app/api/pipeline/start/route.ts), [`app/api/pipeline/[jobId]/cancel/route.ts`](./app/api/pipeline/[jobId]/cancel/route.ts).

### Materiales y export

| Método | Ruta | Función |
|---|---|---|
| `POST` | `/api/courses/[id]/materials/upload` | Sube un PDF al curso |
| `POST` | `/api/upload` | Subida genérica |
| `GET`/`POST` | `/api/export` | Exportación de contenido |

> **Nota de diseño:** las rutas REST **delegan** en los server actions (no duplican lógica). Existen para que un futuro cliente sin server actions (p. ej. una SPA) pueda operar por HTTP.

---

## Server actions (`lib/actions/`)

El camino UI→servidor de Next. Ficheros por dominio:

| Fichero | Acciones principales |
|---|---|
| [`course.ts`](./lib/actions/course.ts) | `getCourses`, `getCourse`, `createCourse`, `updateCourse`, `deleteCourse`, `updateCourseContext` |
| [`pipeline.ts`](./lib/actions/pipeline.ts) | `startPipelineAction`, `getJobStatusAction`, `listActiveJobsAction`, `listFinishedJobsAction`, `cancelPipelineAction` |
| [`slide.ts`](./lib/actions/slide.ts) · `generate.ts` · `slide-export.ts` | CRUD y generación de diapositivas, export |
| [`tree.ts`](./lib/actions/tree.ts) | Operaciones sobre el árbol conceptual |
| [`figure.ts`](./lib/actions/figure.ts) · `box.ts` · `material.ts` | Figuras, cajas de slide, materiales |
| [`settings.ts`](./lib/actions/settings.ts) | `getSettingsAction`, `updateSettingsAction` (cifra la API key — ver [Seguridad](./README.SECURITY.md)) |

Todas pasan por el `container` ([Composition Root](./README.ARCHITECTURE.md#el-composition-root)).

---

## Data-layer cliente: `ApiClient`

[`lib/client/api-client.ts`](./lib/client/api-client.ts) — cliente tipado sobre `fetch`, framework-agnóstico e inyectable (`fetchImpl`, `now`). Aporta:

- **Respuestas tipadas** `ApiResult<T>` (discriminado por `ok`; cero `any`).
- **Caché TTL** para GETs (las mutaciones invalidan las claves relevantes).
- **Deduplicación en vuelo** (GETs concurrentes idénticos comparten una petición).

Métodos: `listCourses`, `getCourse`, `createCourse`, `updateCourse`, `deleteCourse`, `startRun`, `getJobStatus` (sin caché), `cancelRun`. `getJobStatus` bypasea la caché (cambia rápido).

---

## Estado cliente (Zustand)

| Store | Función |
|---|---|
| [`usePipelineStore`](./lib/stores/usePipelineStore.ts) | Jobs del pipeline para el banner (mapa acotado a `MAX_JOBS` para evitar fugas) |
| `useCourseStore` · `useUIStore` · `useJobsUIStore` | Estado de curso y UI |
| `useGenerationStore` · `useSlideGenerationStore` | Estado de generación de diapositivas |

---

[◄ Índice](./README.md) · Anterior: [Pipeline](./README.PIPELINE.md) · Siguiente: [Datos ►](./README.DATA.md)
