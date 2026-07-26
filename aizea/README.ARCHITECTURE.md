# Arquitectura

[◄ Índice](./README.md) · Anterior: [Compilar](./README.BUILD.md) · Siguiente: [Módulos ►](./README.MODULES.md)

AIzea sigue una **arquitectura hexagonal** (puertos y adaptadores). El dominio es puro y no conoce la infraestructura; ambos se conectan por interfaces (*puertos*).

---

## Capas

```
┌─────────────────────────────────────────────────────────────┐
│  UI / Entrada                                                 │
│  app/ (páginas React + rutas API)  ·  components/  ·  stores/ │
└───────────────┬───────────────────────────────────────────────┘
                │ server actions (lib/actions) · ApiClient (lib/client)
┌───────────────▼───────────────────────────────────────────────┐
│  Application — casos de uso + PUERTOS (interfaces)             │
│  lib/application/use-cases/   lib/application/ports/           │
│  lib/application/*Service.ts                                   │
└───────────────┬───────────────────────────────────────────────┘
                │ depende SOLO de puertos (interfaces)
┌───────────────▼───────────────────────────────────────────────┐
│  Domain — lógica de negocio PURA                              │
│  lib/domain/ (pipeline, rag, pdf, figures, prompts, entities) │
└───────────────────────────────────────────────────────────────┘
                ▲ implementa los puertos
┌───────────────┴───────────────────────────────────────────────┐
│  Infrastructure — adaptadores concretos                       │
│  Prisma · LanceDB · OpenRouter · cola · cifrado · notifier    │
│  lib/infrastructure/                                          │
└───────────────────────────────────────────────────────────────┘
                ▲ cablea todo
┌───────────────┴───────────────────────────────────────────────┐
│  Composition Root — inyección de dependencias                 │
│  lib/composition/container.ts                                 │
└───────────────────────────────────────────────────────────────┘
```

**Regla de oro:** las dependencias apuntan **hacia adentro**. `domain` no importa nada de `infrastructure`. `application` define puertos (interfaces) que `infrastructure` implementa. El `container` es el único sitio que conoce las implementaciones concretas.

Referencia carpeta a carpeta en [Módulos y carpetas](./README.MODULES.md).

---

## Puertos y adaptadores

Los **puertos** viven en [`lib/application/ports/`](./lib/application/ports/) (interfaces `I*Repository`, `I*Provider`, `IJobQueue`…). Cada uno tiene un **adaptador** concreto en `lib/infrastructure/`:

| Puerto (interfaz) | Adaptador (implementación) |
|---|---|
| `ICourseRepository` | `PrismaCourseRepository` |
| `IVectorStore` | `LanceDBVectorStore` |
| `ILLMProvider` | `OpenRouterLLMProvider` |
| `IEmbeddingProvider` | `OpenRouterEmbeddingProvider` |
| `IJobQueue` | `PrismaJobQueue` |
| `IPipeline` | `PipelineService` |
| `INotifier` | `InAppNotifier` |
| `ISettingsRepository` | `PrismaSettingsRepository` |

Esto permite testear el dominio con dobles y cambiar una implementación (p. ej. otro vector store) sin tocar la lógica de negocio.

---

## El Composition Root

[`lib/composition/container.ts`](./lib/composition/container.ts) construye y cablea **todas** las dependencias en un único objeto `container`. Acepta *overrides* para tests. Expone, entre otros:

- Repositorios (`courses`, `materials`, `slides`, `processingJobs`, `settings`…)
- Casos de uso (`processCourse`, `uploadMaterial`)
- Servicios (`CourseService`, `SlideService`, `TreeService`, `ExportService`…)
- Infraestructura de pipeline (`jobQueue`, `pipelineWorker`)

Todo consumo desde `app/` o `lib/actions/` pasa por `container`, nunca instancia adaptadores directamente.

---

## Modelo de proceso (escritorio)

En el build de escritorio hay **dos procesos**:

1. **Shell Tauri (Rust)** — [`src-tauri/src/lib.rs`](./src-tauri/src/lib.rs): ventana nativa + **supervisor** del backend (spawn, health-check, reinicio, logs).
2. **Servidor Next.js (Node, sidecar)** — sirve la UI y las rutas API en `:1422`, ejecuta el pipeline.

El worker del pipeline arranca a nivel de proceso vía el primer sondeo a `/api/health` (ver [Pipeline](./README.PIPELINE.md#arranque-del-worker)). En dev, ambos roles los cubre `next dev`.

---

## Flujo de datos (subir PDF → diapositivas)

```
Usuario sube PDF
   │
   ▼
uploadMaterial (caso de uso) ──► guarda Material + parsea PDF (docling/pdf-parse)
   │
   ▼
startPipelineAction ──► IJobQueue.enqueue(pipeline-run)  [no bloquea]
   │                          │
   │                          ▼
   │                    PipelineWorker.pump()  [en fondo]
   │                          │
   ▼                          ▼
Banner (polling)      processCourse:  Segmentación ─► Extracción ─►
                                      Integración ─► Construcción de árbol
                                          │
                                          ▼
                                    TopicNode (árbol) + RAG indexado
                                          │
                                          ▼
                              Generación de diapositivas (bajo demanda)
```

Detalle de cada fase y de la resumibilidad en [Pipeline de generación](./README.PIPELINE.md).

---

## Frontend: data-layer y estado

- **Server actions** ([`lib/actions/`](./lib/actions/)) — el camino histórico UI→servidor.
- **`ApiClient`** ([`lib/client/api-client.ts`](./lib/client/api-client.ts)) — data-layer tipado con caché TTL, deduplicación de peticiones en vuelo e invalidación. Base para desacoplar la UI (estrategia *strangler-fig*).
- **Zustand** ([`lib/stores/`](./lib/stores/)) — estado cliente (banner de pipeline, UI, generación). El `usePipelineStore` acota su mapa de jobs para evitar fugas de memoria.
- **Error boundaries** ([`components/ErrorBoundary/`](./components/ErrorBoundary/), `app/error.tsx`, `app/global-error.tsx`).

Contratos concretos en [API y acciones](./README.API.md).

---

[◄ Índice](./README.md) · Anterior: [Compilar](./README.BUILD.md) · Siguiente: [Módulos ►](./README.MODULES.md)
