# AIZEA

[![Status: Public Alpha](https://img.shields.io/badge/status-public%20alpha-orange.svg)](./aizea/CHANGELOG.md)
[![Next.js 15](https://img.shields.io/badge/Next.js-15-000000.svg?logo=next.js&logoColor=white)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-149ECA.svg?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript 5.7](https://img.shields.io/badge/TypeScript-5.7-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB.svg?logo=tauri&logoColor=white)](https://tauri.app/)

> A local-first desktop workspace that turns teaching PDFs into conceptual trees, searchable course knowledge, and AI-assisted slide decks.

**Public alpha.** AIZEA is actively developed. Workflows, APIs, stored data, and generated output may change, and the application is not presented as production-ready software.

## Start here

- **Product website:** [aitorAG.github.io/aizea](https://aitorag.github.io/aizea/)
- **Windows releases:** [GitHub Releases](https://github.com/aitorAG/aizea/releases)
- **Detailed technical guide:** [aizea/README.md](./aizea/README.md)
- **Changelog:** [aizea/CHANGELOG.md](./aizea/CHANGELOG.md)

## What AIZEA does

1. Upload a teaching PDF to a course.
2. Parse and segment the document, extract semantic units, integrate concepts, and build a navigable conceptual tree.
3. Review, rename, move, and edit the tree, including conversational tree editing.
4. Generate explanation and exercise slides with scripts, relevance, narrative, figures, and HTML designs.
5. Search the course locally through LanceDB semantic retrieval (RAG).
6. Export reviewed material to PDF or self-contained HTML.

The database, uploads, vector index, and processing pipeline run locally. AI generation and embeddings use the OpenRouter provider with the user's API key.

## Features

| Feature | Description |
|---|---|
| PDF ingestion | Docling preserves layout and figures when available; a text-only fallback keeps the workflow usable without Docling. |
| Conceptual tree | A persistent pipeline turns source material into a navigable, editable hierarchy of topics and subtopics. |
| Figure extraction | Embedded and vector figures can be extracted or rasterized from the source PDF. |
| Slide generation | Creates structured explanation and exercise content plus editable HTML slide designs. |
| Local semantic search | LanceDB indexes course content for meaning-based retrieval. |
| Desktop application | Tauri 2 packages the Next.js/Node application for Windows. |
| Export | Produces A4 PDF slides and self-contained HTML output. |

## Quick start

Run these commands from `aizea/`:

```powershell
pnpm install
Copy-Item .env.example .env
pnpm local
```

`pnpm local` starts the optional Docling service, generates the Prisma client, synchronizes the SQLite schema, and starts Next.js at [http://localhost:3001](http://localhost:3001). Docker is required for the all-in-one command. Without Docker, use `pnpm dev` and the text fallback will be used.

Check readiness at [http://localhost:3001/api/health](http://localhost:3001/api/health).

Requirements:

- Node.js 18 or newer; Node.js 20+ recommended.
- pnpm 11+.
- Docker Desktop for the optional Docling parser.
- Rust 1.77+ and Microsoft Visual C++ Build Tools for Windows desktop builds.

## Configuration

Copy `.env.example` to `.env`. Keep API keys, databases, uploads, source PDFs, and generated private material out of commits.

| Variable | Purpose | Default or example |
|---|---|---|
| `OPENROUTER_API_KEY` | Chat, JSON, and embedding requests | Empty |
| `OPENROUTER_MODEL` | Default chat model | `deepseek/deepseek-chat` |
| `DOCLING_BASE_URL` | Local Docling service | `http://127.0.0.1:5001` |
| `DATABASE_URL` | Prisma SQLite connection string | `file:./dev.db` |
| `OPENROUTER_EMBED_MODEL` | Embedding model override | `openai/text-embedding-3-small` |
| `AIZEA_SECRET_KEY` | Encrypts the stored provider key | Recommended |

AI-generated trees, summaries, and slides require human review. Content sent to OpenRouter may be processed by the provider and its model path; review the applicable terms before uploading confidential or regulated material.

## Documentation index

The repository root is the central entry point. Current technical documentation remains next to the application under `aizea/` so implementation links stay valid.

### Current technical guides

- [Getting started](./aizea/README.GETTING-STARTED.md): environment setup, local startup, health checks, and troubleshooting.
- [Desktop build](./aizea/README.BUILD.md): Windows MSI/NSIS packaging, sidecar layout, and release caveats.
- [Architecture](./aizea/README.ARCHITECTURE.md): hexagonal layers, ports, adapters, composition, and process model.
- [Modules and folders](./aizea/README.MODULES.md): repository map and responsibilities.
- [Pipeline](./aizea/README.PIPELINE.md): persistent queue, worker phases, cancellation, recovery, and guarantees.
- [API](./aizea/README.API.md): REST routes, server actions, and the typed client.
- [Data and persistence](./aizea/README.DATA.md): SQLite, Prisma, LanceDB, models, and configuration precedence.
- [Testing](./aizea/README.TESTING.md): Vitest, Playwright, test structure, and quality checks.
- [Security and distribution](./aizea/README.SECURITY.md): key encryption, CSP, desktop supervision, and installer caveats.

### Project records and historical design notes

These documents are retained as project history and are not the canonical operational guide:

- [Product brief](./aizea/docs/PRODUCT.md)
- [Architecture consulting report](./aizea/docs/INFORME-CONSULTORIA-ARQUITECTURA.md)
- [Conceptual-tree strategy](./docs/ARBOL-CONCEPTUAL-analisis-y-estrategia.md)
- [Versioned design and planning notes](./aizea/docs/)

## Architecture at a glance

```text
Next.js UI and API
        |
Application use cases and ports
        |
Pure domain logic
        |
Infrastructure adapters: Prisma, SQLite, LanceDB, OpenRouter, PDF parsing, queue
        |
Tauri 2 / Rust desktop shell
```

The persistent flow is:

```text
PDF upload -> SQLite material -> Docling or text fallback
  -> persistent queue -> segmentation and extraction
  -> concept integration -> conceptual tree
  -> LanceDB index -> editable slides -> PDF or HTML export
```

## Useful commands

```powershell
pnpm dev
pnpm docling:up
pnpm docling:check
pnpm docling:logs
pnpm docling:down
pnpm db:push
pnpm db:studio
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build:msi
pnpm tauri:dev
```

## Contributing

Before opening a pull request, run the checks relevant to your change, describe what changed and how it was verified, and keep secrets, real user data, generated databases, and private PDFs out of commits. Follow the architecture documented above: domain code must not depend on infrastructure implementations.

## License and readiness

The package is currently a public alpha. Windows installers are unsigned and do not auto-update; consult the [changelog](./aizea/CHANGELOG.md) and [desktop build guide](./aizea/README.BUILD.md) for current release context.
