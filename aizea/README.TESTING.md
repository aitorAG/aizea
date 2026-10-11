# Testing

[◄ Index](./README.md) · Previous: [Data](./README.DATA.md) · Next: [Security ►](./README.SECURITY.md)

How to run and structure the test suite.

---

## Commands

| Command | What it runs |
|---|---|
| `pnpm test` | Full suite (Vitest, single run) |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm typecheck` | `tsc --noEmit` (type checking) |
| `pnpm test:e2e` | End-to-end tests with Playwright |
| `pnpm test:e2e:smoke` | Only E2E tests marked `@smoke` |
| `cargo check --release` | (in `src-tauri/`) validates Rust for the release build |

Config: [`vitest.config.ts`](./vitest.config.ts) · [`playwright.config.ts`](./playwright.config.ts).

---

## Structure (`tests/`)

| Folder | Contents |
|---|---|---|
| `tests/unit/` | Pure logic, services, stores, React components (jsdom) |
| `tests/integration/` | API routes, end-to-end pipeline, real test database |
| `tests/verification/` | Higher-level verification |
| `tests/fixtures/` | Supporting data |

Playwright E2E tests are in [`e2e/`](./e2e/) (`critical-flow.spec.ts`).

---

## Test types and patterns

### Unit (Node or jsdom)

- **Pure logic**: dependencies (fetch, clock, ports) are injected for determinism. E.g.: [`secret-cipher.test.ts`](./tests/unit/infrastructure/secret-cipher.test.ts), [`api-client.test.ts`](./tests/unit/client/api-client.test.ts), [`health.test.ts`](./tests/unit/health.test.ts).
- **React components**: `// @vitest-environment jsdom` header + `@testing-library/react`. E.g.: [`error-boundary.test.tsx`](./tests/unit/error-boundary.test.tsx).
- **Stores**: `usePipelineStore` includes tests for bounded pruning (`MAX_JOBS`).

### Integration (real test database)

They rebuild a temporary SQLite database by **replaying the migration SQL** and exercise the real code:

- [`pipeline-queue.test.ts`](./tests/integration/pipeline-queue.test.ts) — **the pipeline gate**: non-blocking, drains, cancellable, isolated failures, resumable.
- [`pipeline-rest-api.test.ts`](./tests/integration/pipeline-rest-api.test.ts), [`courses-rest-api.test.ts`](./tests/integration/courses-rest-api.test.ts) — REST routes (status mapping + shape).
- `server-actions.test.ts` — server actions with a mocked container.

> Because the tests replay `migration.sql`, **do not** add new tables casually: the pipeline queue reuses `ProcessingJob`. See [Data](./README.DATA.md#migraciones).

---

## Quality rules

- Every change must pass `tsc --noEmit` **and** the full green suite before it is considered complete.
- `as any`, `@ts-ignore`, and `@ts-expect-error` are prohibited.
- Never delete a failing test to "make it green"; tests pass as a **consequence** of correct code.
- Integration tests clean up their temporary databases (`test-*.db`).

---

## Run a specific test

```powershell
pnpm exec vitest run tests/integration/pipeline-queue.test.ts
pnpm exec vitest run tests/unit/client/api-client.test.ts
```

---

[◄ Index](./README.md) · Previous: [Data](./README.DATA.md) · Next: [Security ►](./README.SECURITY.md)
