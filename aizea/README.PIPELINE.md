# Pipeline de generación

[◄ Índice](./README.md) · Anterior: [Módulos](./README.MODULES.md) · Siguiente: [API ►](./README.API.md)

Cómo AIzea procesa un PDF hasta convertirlo en árbol conceptual y diapositivas, con una cola persistente y un worker resumible.

---

## Visión general

El pipeline **no bloquea** la petición del usuario. Al pulsar "generar", se **encola** un run y un worker lo drena en fondo. La UI refleja el progreso por *polling*.

```
startPipelineAction(courseId)
   │  valida curso + comprueba que hay materiales (NO_MATERIALS si no)
   ▼
IJobQueue.enqueue({ courseId })  ──►  devuelve { enqueued:true, runId }  [retorna YA]
   │
   ▼  (fire-and-forget)
PipelineWorker.pump()  ──►  claimNext() ──► processCourse() ──► markCompleted/Failed/Cancelled
```

---

## Componentes

| Componente | Fichero | Rol |
|---|---|---|
| **Puerto de cola** | [`lib/application/ports/job-queue.port.ts`](./lib/application/ports/job-queue.port.ts) | Interfaz `IJobQueue` |
| **Cola persistente** | [`lib/infrastructure/queue/prisma-job-queue.ts`](./lib/infrastructure/queue/prisma-job-queue.ts) | Respaldada en `ProcessingJob` (`type="pipeline-run"`) |
| **Worker** | [`lib/infrastructure/queue/pipeline-worker.ts`](./lib/infrastructure/queue/pipeline-worker.ts) | `pump()` + `recover()` |
| **Bootstrap** | [`lib/infrastructure/queue/worker-bootstrap.ts`](./lib/infrastructure/queue/worker-bootstrap.ts) | Arranque a nivel de proceso |
| **Pipeline** | [`lib/infrastructure/pipeline/pipeline.service.ts`](./lib/infrastructure/pipeline/pipeline.service.ts) | Implementa `IPipeline`, corre las 4 fases |
| **Caso de uso** | [`lib/application/use-cases/process-course.use-case.ts`](./lib/application/use-cases/process-course.use-case.ts) | Orquesta `processCourse` |

---

## Las 4 fases

`PipelineService` corre las fases **en orden**, cada una con su progreso, y falla rápido si alguna lanza:

1. **Segmentación** — `SegmenterService` parte el material en segmentos manejables.
2. **Extracción** — `UnitExtractor` extrae unidades semánticas (una tarea `extract-unit` por unidad).
3. **Integración** — `ConceptIntegrator` integra conceptos (soft-skip si el módulo no está).
4. **Construcción de árbol** — `TreeBuilder` construye el árbol de `TopicNode` (soft-skip si no está).

El resultado es el árbol conceptual navegable + el contenido indexado en RAG. Las diapositivas se generan después, bajo demanda.

---

## Cola: `IJobQueue`

La fila *meta* de cada run usa `ProcessingJob` con `type="pipeline-run"` (no se creó tabla nueva, para no romper el replay de migraciones en tests). Métodos:

| Método | Función |
|---|---|
| `enqueue(input)` | Crea el run en estado `pending`, devuelve `{ runId }` |
| `claimNext()` | Reclama atómicamente el siguiente `pending` → `running` |
| `markCompleted / markFailed / markCancelled` | Transiciones terminales |
| `findRun(runId)` | Consulta un run |
| `recoverStale(olderThanMs)` | Devuelve a `pending` los `running` vetustos (resumibilidad) |

El banner de progreso **excluye** `type="pipeline-run"` (es fila meta, no una fase visible).

---

## Worker: `PipelineWorker`

- **`pump()`** — drena la cola: reclama runs y ejecuta `runCourse` (= `processCourse.execute`) hasta vaciarla. Es **reentrante**: si ya hay un drenado en curso, retorna la misma promesa (no hay doble ejecución).
- **`recover()`** — llama a `recoverStale(staleAfterMs)` (default **10 min**): un run dejado en `running` por un crash vuelve a `pending` y se reprocesa.
- **Mapa de resultado:** éxito → `completed`; `PipelineCancelledError` → `cancelled`; otro throw → `failed` (un fallo **no atasca** la cola, el resto sigue).

---

## Arranque del worker

El worker arranca a nivel de **proceso** (no solo por petición), vía [`worker-bootstrap.ts`](./lib/infrastructure/queue/worker-bootstrap.ts):

- `bootstrapWorkerOnce({ recover, pump })` — recupera runs vetustos y dispara el pump **una vez por proceso**. Nunca lanza (un fallo de bootstrap no debe tumbar el arranque).
- Se invoca desde el route handler **`/api/health`** (runtime Node, donde las deps nativas cargan bien). El supervisor Tauri sondea `/api/health` al arrancar → efecto de arranque en el boot.

> **Nota histórica:** originalmente esto vivía en un `instrumentation.ts` de raíz, pero eso arrastraba el binario nativo de LanceDB al bundle edge/browser y rompía el build. Se movió a `/api/health`. No debe existir `instrumentation.ts` en la raíz.

---

## Cancelación cooperativa

Cancelar un job marca su estado a `cancelled`; el bucle de extracción comprueba ese estado y se detiene (lanza `PipelineCancelledError`), que el worker mapea a run `cancelled`. Ver el endpoint en [API](./README.API.md#cancelar-un-run).

---

## Garantías (probadas en tests de integración)

`tests/integration/pipeline-queue.test.ts` verifica el *gate* de la fase:

- Encolar **no bloquea** aunque el pipeline sea lento.
- La cola **drena múltiples** runs.
- Es **cancelable**.
- Un fallo **no atasca** la cola.
- Es **resumible** (run `running` vetusto → recover → reprocesa).

Ver [Testing](./README.TESTING.md).

---

[◄ Índice](./README.md) · Anterior: [Módulos](./README.MODULES.md) · Siguiente: [API ►](./README.API.md)
