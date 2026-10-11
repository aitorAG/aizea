# AIZEA

[![Status: Public Alpha](https://img.shields.io/badge/status-public%20alpha-orange.svg)](./CHANGELOG.md)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000.svg?logo=next.js&logoColor=white)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-149ECA.svg?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB.svg?logo=tauri&logoColor=white)](https://tauri.app/)

> A local-first workspace for turning teaching PDFs into conceptual trees, searchable course knowledge, and AI-assisted slide decks.

**Public alpha.** AIZEA is an actively developed, local-first application. Expect incomplete workflows, changing behavior, and rough edges. It is not presented as production-ready software.

## Contents

- [What it does](#what-it-does)
- [Current status and limitations](#current-status-and-limitations)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [First workflow](#first-workflow)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Data flow](#data-flow)
- [Security and provider handling](#security-and-provider-handling)
- [Troubleshooting](#troubleshooting)
- [Testing and quality checks](#testing-and-quality-checks)
- [Desktop build](#desktop-build)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Releases and readiness](#releases-and-readiness)

## What it does

AIZEA provides a course-oriented workflow:

1. Create a course and upload PDF teaching material.
2. Run a persistent background pipeline that segments the material, extracts semantic units, integrates concepts, and builds a navigable conceptual tree.
3. Browse and edit the tree, including conversational tree editing.
4. Generate structured slides from the resulting knowledge and edit or export them.
5. Use local LanceDB indexing for semantic retrieval (RAG) over the course content.

The web application is built with Next.js 15, React 19, TypeScript, Tailwind CSS, Prisma/SQLite, LanceDB, and OpenRouter integrations. A Tauri 2/Rust shell is available for the Windows desktop build.

## Current status and limitations

- This is a **public alpha**, so APIs, UI details, persisted data, and generated output can change.
- AI features require an OpenRouter API key. Without one, local course and UI setup can still be explored, but LLM/embedding-powered operations cannot complete.
- PDF parsing is best with the optional local `docling-serve` service. Without Docker/Docling, AIZEA uses a basic text-only fallback without layout or figure analysis.
- Generated trees, summaries, and slides require review. They are model-assisted output, not authoritative educational or factual content.
- The default local setup stores development data in the repository (`prisma/dev.db`, `public/uploads/`, and `lancedb-data/`). Do not use real or sensitive material in a shared checkout.

## Requirements

For local development:

- Node.js 18 or newer (20+ recommended)
- pnpm 11+
- Docker Desktop, if you want the optional Docling PDF parser

For the Windows desktop build, add Rust 1.77+ (1.97+ recommended), Microsoft Visual C++ Build Tools, and the Tauri CLI dependency installed by the project.

## Quick start

Run these commands from `aizea/`:

```powershell
pnpm install
Copy-Item .env.example .env
pnpm local
```

`pnpm local` starts the optional Docling container, generates the Prisma client, synchronizes the local SQLite schema, and starts Next.js on [http://localhost:3001](http://localhost:3001). Docker must be available for the all-in-one command. Without Docker, use `pnpm dev` and the PDF fallback will be used.

Check readiness at [http://localhost:3001/api/health](http://localhost:3001/api/health). The health route also bootstraps the persistent pipeline worker.

Useful separate commands:

```powershell
pnpm dev
pnpm docling:up
pnpm docling:check
pnpm docling:logs
pnpm docling:down
pnpm db:push
pnpm db:studio
```

## First workflow

1. Open the app and create a course.
2. Open the course's materials view and upload a PDF.
3. Start generation and watch the job status while the background worker processes the course.
4. Review the conceptual tree and adjust it as needed.
5. Generate slides from the tree, edit individual slides, then use the export workflow.

Configure the provider before starting AI generation: use `/settings` in the app or set `OPENROUTER_API_KEY` in `.env`.

## Configuration

Copy `.env.example` to `.env`. The template contains no secret. Keep `.env` private and never commit API keys, databases, uploads, or generated private material.

| Variable | Required | Purpose | Default / example |
|---|---:|---|---|
| `OPENROUTER_API_KEY` | For AI features | OpenRouter credential used for chat/JSON and embedding requests | Empty |
| `OPENROUTER_MODEL` | No | Default chat model | `deepseek/deepseek-chat` |
| `DOCLING_BASE_URL` | No | URL of the local Docling parsing service | `http://127.0.0.1:5001` |
| `DATABASE_URL` | No | Prisma SQLite connection string | `file:./dev.db` |
| `OPENROUTER_EMBED_MODEL` | No | Embedding model override | Built-in default: `openai/text-embedding-3-small` |
| `AIZEA_SECRET_KEY` | Recommended for stored credentials | Master secret used to encrypt the saved OpenRouter key | No `.env.example` default; without it the code uses a weaker constant fallback |

Settings saved through the application take precedence over environment values, followed by built-in defaults. The OpenRouter key is encrypted in the settings row with AES-256-GCM; this protects stored data from casual inspection, not an attacker who controls the machine and application binary.

## Architecture

AIZEA uses a hexagonal (ports-and-adapters) structure:

- `app/`, `components/`, and stores provide the Next.js UI and API entry points.
- `lib/application/` defines use cases and ports.
- `lib/domain/` contains business logic for PDFs, the pipeline, RAG, prompts, and entities.
- `lib/infrastructure/` supplies Prisma, LanceDB, OpenRouter, the persistent queue, PDF parsing, and encryption adapters.
- `lib/composition/container.ts` wires the concrete implementations together.

In development, Next.js serves the UI and API and runs the worker in the Node process. In the desktop build, a Rust Tauri shell supervises a packaged Next.js/Node sidecar, health-checks it, captures logs, and can restart it after failures.

## Data flow

```text
PDF upload
  -> Material persisted in SQLite
  -> PDF parsed by Docling or the text-only fallback
  -> pipeline run enqueued in the persistent Prisma-backed queue
  -> worker runs segmentation, extraction, integration, and tree construction
  -> conceptual tree persisted; content indexed in LanceDB
  -> slides generated on demand and persisted for editing/export
```

SQLite stores courses, materials, jobs, settings, tree nodes, figures, and slides. LanceDB stores embeddings for semantic retrieval. In development, uploads are under `public/uploads/`; the desktop build uses `%APPDATA%\AIzea\` for its database, uploads, vector data, and logs.

## Security and provider handling

- OpenRouter is an external provider. Content sent for LLM or embedding features may be received and processed by OpenRouter and the model/provider path it uses. Review the provider and model terms before uploading confidential, regulated, or third-party material.
- Docling is optional and normally runs locally through Docker at `127.0.0.1:5001`; it is a local parsing service, not a substitute for the external AI provider.
- Keep API keys and source documents out of commits and logs. Treat PDF and model output as untrusted input at application boundaries.
- The app applies HTTP security headers and a Content Security Policy in Next.js. This is not a claim of complete application security or compliance.
- Desktop installers are currently unsigned and there is no auto-updater. Windows may show an unknown-publisher warning; updates require rebuilding and reinstalling.

## Troubleshooting

| Symptom | Action |
|---|---|
| PDF upload or layout/figure extraction fails | Start Docker and run `pnpm docling:up`, then verify with `pnpm docling:check`. Without it, expect the text-only fallback. |
| `@prisma/client did not initialize` | Run `pnpm db:generate`; reinstalling dependencies also runs Prisma generation through `postinstall`. |
| Port `3001` is already in use | Stop the other development server or run `$env:PORT=3002; pnpm dev` in PowerShell. |
| AI generation returns an authentication error | Configure `OPENROUTER_API_KEY` in `.env` or `/settings`, and confirm the selected model is available through OpenRouter. |
| Local data appears missing | Check the configured `DATABASE_URL`, `prisma/dev.db`, `public/uploads/`, and `lancedb-data/`. The desktop build stores data under `%APPDATA%\AIzea\` instead. |
| Desktop backend does not open | Inspect `%APPDATA%\AIzea\logs\server.log` and check `/api/health` behavior; release supervision is validated separately with `Push-Location src-tauri; cargo check --release; Pop-Location`. |

## Testing and quality checks

The repository uses Vitest for unit/integration tests and Playwright for browser tests. Run the checks relevant to your change:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:watch
pnpm test:e2e
pnpm test:e2e:smoke
```

To run one Vitest file:

```powershell
pnpm exec vitest run tests/integration/pipeline-queue.test.ts
```

The pipeline tests cover non-blocking enqueueing, queue draining, cancellation, failure isolation, and recovery of stale runs. Do not rely on a hard-coded test count; the suite changes with the codebase.

## Desktop build

Build the Windows MSI and per-user NSIS installer with:

```powershell
pnpm build:msi
```

The desktop bundle packages a Node runtime and uses the `pdf-parse` fallback; `docling-serve` is not bundled. For desktop development, use `pnpm tauri:dev`. Before a release build, the deeper build guide also recommends:

```powershell
pnpm typecheck
pnpm test
Push-Location src-tauri
cargo check --release
Pop-Location
```

See [Compiling the desktop](./README.BUILD.md) for the packaging sequence and runtime layout.

## Documentation

- [Getting started](./README.GETTING-STARTED.md): requirements, environment setup, and local commands.
- [Architecture](./README.ARCHITECTURE.md): layers, ports, adapters, process model, and data flow.
- [Modules and folders](./README.MODULES.md): repository map and responsibilities.
- [Pipeline](./README.PIPELINE.md): persistent queue, worker, phases, cancellation, and recovery.
- [API and actions](./README.API.md): REST routes, server actions, and the typed client.
- [Data and persistence](./README.DATA.md): SQLite, LanceDB, Prisma models, and configuration precedence.
- [Testing](./README.TESTING.md): test structure and patterns.
- [Security and distribution](./README.SECURITY.md): secret encryption, headers, desktop supervision, and installer caveats.
- [Desktop build](./README.BUILD.md): MSI/NSIS packaging requirements and output.
- [Changelog](./CHANGELOG.md): notable changes and release history.

## Contributing

There is no separate contribution guide in this repository yet. Start with [Modules and folders](./README.MODULES.md), follow the architecture described in [Architecture](./README.ARCHITECTURE.md), and run `pnpm lint`, `pnpm typecheck`, and the relevant tests before submitting a change. Keep secrets, real user data, generated databases, and private PDFs out of commits.

## Releases and readiness

The package currently declares version `0.9.1`, but this repository should be treated as a public alpha rather than a production release. Release artifacts are Windows MSI/NSIS installers produced by `pnpm build:msi`; they are unsigned and do not self-update. Consult the [Changelog](./CHANGELOG.md) and [desktop build guide](./README.BUILD.md) for the current build context.
