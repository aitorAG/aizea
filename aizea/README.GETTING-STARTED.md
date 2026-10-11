# Getting started

[◄ Back to index](./README.md) · Next: [Build the desktop app ►](./README.BUILD.md)

How to install and start AIzea in development mode.

---

## Requirements

| Tool | Version | Note |
|---|---|---|
| **Node.js** | ≥ 18 (20+ recommended) | Next.js runtime |
| **pnpm** | 11+ | Gestor de paquetes del proyecto |
| **Docker Desktop** | any recent version | Only for **docling-serve** (PDF parser). Optional but recommended |
| **Rust** | ≥ 1.77 (1.97+ recommended) | Only to build the desktop app — see [Build](./README.BUILD.md) |

> Without Docker, the app still starts, but **PDF uploads** use a plain-text fallback (without layout analysis or figures).

---

## Installation

```powershell
# 1. Install dependencies (triggers `prisma generate` through postinstall)
pnpm install

# 2. Create .env from the template
Copy-Item .env.example .env
```

### Variables de entorno (`.env`)

```ini
# OpenRouter API key (https://openrouter.ai/settings/keys)
# Can also be configured in the app at /settings. May be empty at startup.
OPENROUTER_API_KEY=

# Default LLM model (optional)
OPENROUTER_MODEL=deepseek/deepseek-chat

# Docling URL for advanced parsing (optional; basic parsing is used without it)
DOCLING_BASE_URL=http://127.0.0.1:5001

# SQLite database (relative to prisma/)
DATABASE_URL="file:./dev.db"
```

See [Data and persistence](./README.DATA.md) for configuration resolution (DB > env > defaults).

---

## Start locally

### Recommended option — complete stack

```powershell
pnpm local
```

The [`scripts/start-local.cjs`](./scripts/start-local.cjs) script orchestrates, in order:

1. Starts **docling-serve** in Docker (`:5001`) and waits for it to report *healthy* (~1 minute on a cold start).
2. Runs `prisma generate` + `prisma db push` against `dev.db` (idempotent).
3. Starts **Next.js dev** at http://localhost:3001.

This path does **not** use `AIZEA_DATA_DIR`: all data remains in the repository (`dev.db`, `public/uploads`, `lancedb-data`).

### Individual commands

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev only (without Docling or DB synchronization) |
| `pnpm docling:up` / `docling:down` | Starts/stops docling-serve separately |
| `pnpm docling:logs` | Follows Docling logs |
| `pnpm docling:check` | Checks that Docling responds |
| `pnpm db:push` | Synchronizes the Prisma schema with the DB |
| `pnpm db:studio` | Opens Prisma Studio (visual DB inspector) |
| `pnpm tauri:dev` | Tauri window against the dev server |

---

## Verify startup

- **App:** http://localhost:3001
- **Health (readiness):** http://localhost:3001/api/health → should return
  ```json
  { "status": "ok", "db": true, "version": "0.19.2", "timestamp": 1234567890 }
  ```

The `/api/health` endpoint also triggers **worker bootstrap** (recovers interrupted runs and drains the queue). See [Pipeline](./README.PIPELINE.md).

---

## Common problems

| Symptom | Cause / solution |
|---|---|
| `lancedb ... not supported in the browser` errors | Already fixed in the code (caused by a misplaced `instrumentation.ts`). If it reappears, ensure there is no root `instrumentation.ts` |
| PDF upload fails | Docker/docling-serve is not running → `pnpm docling:up` |
| `@prisma/client did not initialize` | Run `pnpm db:generate` (or reinstall; postinstall does this) |
| Port 3001 is occupied | Another dev server is running → stop it or use `PORT=3002 pnpm dev` |

---

[◄ Back to index](./README.md) · Next: [Build the desktop app ►](./README.BUILD.md)
