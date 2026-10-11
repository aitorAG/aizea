# Testing

[◄ Index](./README.md) · Previous: [Data](./README.DATA.md) · Next: [Security ►](./README.SECURITY.md)

How to run and structure the test suite. Current status: **889 passing tests**.

---

## Comandos

| Command | What it runs |
|---|---|
| `pnpm test` | Suite completa (Vitest, una pasada) |
| `pnpm test:watch` | Vitest en modo watch |
| `pnpm typecheck` | `tsc --noEmit` (chequeo de tipos) |
| `pnpm test:e2e` | End-to-end con Playwright |
| `pnpm test:e2e:smoke` | E2E tests marked `@smoke` only |
| `cargo check --release` | (en `src-tauri/`) valida el Rust del build release |

Config: [`vitest.config.ts`](./vitest.config.ts) · [`playwright.config.ts`](./playwright.config.ts).

---

## Structure (`tests/`)

| Folder | File count | Contents |
|---|---|---|
| `tests/unit/` | 69 | Pure logic, services, stores, React components (jsdom) |
| `tests/integration/` | 11 | API routes, end-to-end pipeline, real test DB |
| `tests/verification/` | 3 | Higher-level verification |
| `tests/fixtures/` | — | Supporting data |

Playwright E2E tests are in [`e2e/`](./e2e/) (`critical-flow.spec.ts`).

---

## Test types and patterns

### Unit (Node or jsdom)

- **Pure logic**: dependencies (fetch, clock, ports) are injected for determinism. Examples: [`secret-cipher.test.ts`](./tests/unit/infrastructure/secret-cipher.test.ts), [`api-client.test.ts`](./tests/unit/client/api-client.test.ts), [`health.test.ts`](./tests/unit/health.test.ts).
- **React components**: `// @vitest-environment jsdom` header + `@testing-library/react`. Example: [`error-boundary.test.tsx`](./tests/unit/error-boundary.test.tsx).
- **Stores**: el `usePipelineStore` incluye tests de la poda acotada (`MAX_JOBS`).

### Integration (real test database)

They rebuild a temporary SQLite database by **replaying migration SQL** and exercise the real code:

- [`pipeline-queue.test.ts`](./tests/integration/pipeline-queue.test.ts) — **the pipeline gate**: non-blocking, draining, cancellable, isolated failure, resumable.
- [`pipeline-rest-api.test.ts`](./tests/integration/pipeline-rest-api.test.ts), [`courses-rest-api.test.ts`](./tests/integration/courses-rest-api.test.ts) — rutas REST (mapeo de status + shape).
- `server-actions.test.ts` — server actions con container mockeado.

> Because tests replay `migration.sql`, new tables must **not** be introduced casually: the pipeline queue reuses `ProcessingJob`. See [Data](./README.DATA.md#migrations).

---

## Quality rules

- Every change passes `tsc --noEmit` **and** the full suite before it is considered complete.
- `as any`, `@ts-ignore`, and `@ts-expect-error` are prohibited.
- Never delete a failing test to "make it green"; tests pass as a **consequence** of correct code.
- Integration tests clean up their temporary DBs (`test-*.db`).

---

## Run an individual test

```powershell
pnpm exec vitest run tests/integration/pipeline-queue.test.ts
pnpm exec vitest run tests/unit/client/api-client.test.ts
```

---

[◄ Index](./README.md) · Previous: [Data](./README.DATA.md) · Next: [Security ►](./README.SECURITY.md)
