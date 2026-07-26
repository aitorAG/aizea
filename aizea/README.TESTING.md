# Testing

[◄ Índice](./README.md) · Anterior: [Datos](./README.DATA.md) · Siguiente: [Seguridad ►](./README.SECURITY.md)

Cómo correr y estructurar la suite de tests. Estado actual: **889 tests verdes**.

---

## Comandos

| Comando | Qué corre |
|---|---|
| `pnpm test` | Suite completa (Vitest, una pasada) |
| `pnpm test:watch` | Vitest en modo watch |
| `pnpm typecheck` | `tsc --noEmit` (chequeo de tipos) |
| `pnpm test:e2e` | End-to-end con Playwright |
| `pnpm test:e2e:smoke` | Solo los E2E marcados `@smoke` |
| `cargo check --release` | (en `src-tauri/`) valida el Rust del build release |

Config: [`vitest.config.ts`](./vitest.config.ts) · [`playwright.config.ts`](./playwright.config.ts).

---

## Estructura (`tests/`)

| Carpeta | Nº ficheros | Contenido |
|---|---|---|
| `tests/unit/` | 69 | Lógica pura, servicios, stores, componentes React (jsdom) |
| `tests/integration/` | 11 | Rutas API, pipeline extremo-a-extremo, DB real de prueba |
| `tests/verification/` | 3 | Verificaciones de más alto nivel |
| `tests/fixtures/` | — | Datos de apoyo |

E2E de Playwright en [`e2e/`](./e2e/) (`critical-flow.spec.ts`).

---

## Tipos de test y patrones

### Unit (Node o jsdom)

- **Lógica pura**: se inyectan dependencias (fetch, reloj, puertos) para determinismo. Ej.: [`secret-cipher.test.ts`](./tests/unit/infrastructure/secret-cipher.test.ts), [`api-client.test.ts`](./tests/unit/client/api-client.test.ts), [`health.test.ts`](./tests/unit/health.test.ts).
- **Componentes React**: cabecera `// @vitest-environment jsdom` + `@testing-library/react`. Ej.: [`error-boundary.test.tsx`](./tests/unit/error-boundary.test.tsx).
- **Stores**: el `usePipelineStore` incluye tests de la poda acotada (`MAX_JOBS`).

### Integration (DB real de prueba)

Reconstruyen una SQLite temporal **replayando el SQL de la migración** y ejercitan el código real:

- [`pipeline-queue.test.ts`](./tests/integration/pipeline-queue.test.ts) — **el gate del pipeline**: no bloquea, drena, cancelable, fallo aislado, resumible.
- [`pipeline-rest-api.test.ts`](./tests/integration/pipeline-rest-api.test.ts), [`courses-rest-api.test.ts`](./tests/integration/courses-rest-api.test.ts) — rutas REST (mapeo de status + shape).
- `server-actions.test.ts` — server actions con container mockeado.

> Como los tests replayan `migration.sql`, **no** se introducen tablas nuevas a la ligera: la cola del pipeline reusa `ProcessingJob`. Ver [Datos](./README.DATA.md#migraciones).

---

## Reglas de calidad

- Todo cambio pasa `tsc --noEmit` **y** la suite verde antes de darse por hecho.
- Prohibido `as any`, `@ts-ignore`, `@ts-expect-error`.
- Nunca se borra un test que falla para "ponerlo en verde"; los tests pasan como **consecuencia** de código correcto.
- Los tests de integración limpian sus DBs temporales (`test-*.db`).

---

## Ejecutar un test concreto

```powershell
pnpm exec vitest run tests/integration/pipeline-queue.test.ts
pnpm exec vitest run tests/unit/client/api-client.test.ts
```

---

[◄ Índice](./README.md) · Anterior: [Datos](./README.DATA.md) · Siguiente: [Seguridad ►](./README.SECURITY.md)
