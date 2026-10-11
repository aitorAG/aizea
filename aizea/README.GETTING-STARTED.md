# Getting Started

[◄ Back to index](./README.md) · Next: [Build the desktop app ►](./README.BUILD.md)

How to install and start AIzea in development mode.

---

## Requirements

| Tool | Version | Note |
|---|---|---|
| **Node.js** | ≥ 18 (20+ recommended) | Next.js runtime |
| **pnpm** | 11+ | Project package manager |
| **Docker Desktop** | any recent version | Only for **docling-serve** (PDF parser). Optional but recommended |
| **Rust** | ≥ 1.77 (1.97+ recommended) | Only if you build the desktop app — see [BUILD](./README.BUILD.md) |

> Without Docker, the app still starts, but **PDF uploads** use a plain-text fallback (without layout or figure analysis).

---

## Installation

```powershell
# 1. Install dependencies (triggers `prisma generate` through postinstall)
pnpm install

# 2. Create .env from the template
Copy-Item .env.example .env
```

### Environment variables (`.env`)

```ini
# OpenRouter API key (https://openrouter.ai/settings/keys)
# Also configurable in the app at /settings. May be empty at startup.
OPENROUTER_API_KEY=

# Default LLM model (optional)
OPENROUTER_MODEL=deepseek/deepseek-chat

# Docling URL for advanced parsing (optional; basic parsing is used without it)
DOCLING_BASE_URL=http://127.0.0.1:5001

# SQLite database (relative to prisma/)
DATABASE_URL="file:./dev.db"
```

For details on how configuration is resolved (DB > env > defaults), see [Data and persistence](./README.DATA.md).

---

## Start locally

### Recommended option — start the entire stack at once

```powershell
pnpm local
```

The [`scripts/start-local.cjs`](./scripts/start-local.cjs) script orchestrates the following, in order:

1. Starts **docling-serve** in Docker (`:5001`) and waits for it to report *healthy* (~1 min on a cold start).
2. Runs `prisma generate` + `prisma db push` against `dev.db` (idempotent).
3. Starts **Next.js dev** at http://localhost:3001.

This path does **not** use `AIZEA_DATA_DIR`: all data remains in the repository (`dev.db`, `public/uploads`, `lancedb-data`).

### Granular options

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev only (without docling or DB synchronization) |
| `pnpm docling:up` / `docling:down` | Start/stop docling-serve separately |
| `pnpm docling:logs` | Follow docling logs |
| `pnpm docling:check` | Check that docling responds |
| `pnpm db:push` | Synchronize the Prisma schema with the DB |
| `pnpm db:studio` | Open Prisma Studio (visual DB inspector) |
| `pnpm tauri:dev` | Tauri window against the dev server |

---

## Verify that it started

- **App:** http://localhost:3001
- **Health (readiness):** http://localhost:3001/api/health → should return
  ```json
  { "status": "ok", "db": true, "version": "0.2.0", "timestamp": 1234567890 }
  ```

The `/api/health` endpoint also triggers **worker bootstrap** (recovers interrupted runs and drains the queue). See [Pipeline](./README.PIPELINE.md).

---

## Common issues

| Symptom | Cause / solution |
|---|---|
| `lancedb ... not supported in the browser` errors | Already fixed in the code (it was caused by a misplaced `instrumentation.ts`). If it reappears, make sure there is no `instrumentation.ts` in the root |
| PDF upload fails | Docker/docling-serve is not running → `pnpm docling:up` |
| `@prisma/client did not initialize` | `pnpm db:generate` (or reinstall; `postinstall` runs it) |
| Port 3001 is in use | Another dev server is running → stop it or use `PORT=3002 pnpm dev` |

---

[◄ Back to index](./README.md) · Next: [Build the desktop app ►](./README.BUILD.md)
