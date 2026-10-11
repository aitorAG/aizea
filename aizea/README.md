# AIzea

> Desktop platform (Tauri + Next.js) that transforms teaching PDFs into AI-generated **concept trees** and **slides**, with local semantic search (RAG).

**Version:** 0.19.2 · **Stack:** Next.js 15 · React 19 · TypeScript · Prisma/SQLite · LanceDB · Tauri 2 (Rust) · Zustand · Tailwind

---

## Wiki — navigable index

This wiki is split across several pages. Start wherever you need:

| Page | Purpose |
|---|---|
| [Getting started](./README.GETTING-STARTED.md) | Requirements, installation, and local startup (`pnpm local`) |
| [Build the desktop app (MSI)](./README.BUILD.md) | Generate the `.msi`/`.exe` installer with `pnpm build:msi` |
| [Architecture](./README.ARCHITECTURE.md) | Hexagonal design, layers, data flow, and diagrams |
| [Modules and folders](./README.MODULES.md) | Reference for each directory and its responsibilities |
| [Generation pipeline](./README.PIPELINE.md) | Persistent queue, worker, and phases (segmentation to tree) |
| [API and actions](./README.API.md) | REST endpoints, server actions, and contracts |
| [Data and persistence](./README.DATA.md) | Prisma models, SQLite, LanceDB, and migrations |
| [Testing](./README.TESTING.md) | Running the suite (889 tests) and test types |
| [Security and distribution](./README.SECURITY.md) | API-key encryption, CSP, and installer signing |

---

## What AIzea does

1. **Upload a PDF** of study material to a course.
2. The **pipeline** processes it in the background: it segments the text, extracts semantic units, integrates them, and builds a navigable **concept tree**.
3. It generates **slides** from the tree with structured content (script, relevance, narrative, and exercises).
4. A **RAG** engine (LanceDB) indexes the content for semantic search.

Everything runs **locally**: the database (SQLite), vectors (LanceDB), and server (Next.js) live on the user's machine. The only external call is to the LLM (OpenRouter), using the user's API key.

---

## Quick start (TL;DR)

```powershell
# 1. Install dependencies
pnpm install

# 2. Configure the environment (copy the template and optionally add your API key)
Copy-Item .env.example .env

# 3. Start the complete local stack (Docling + DB + Next dev on :3001)
pnpm local
```

Abre http://localhost:3001 · Salud del servicio: http://localhost:3001/api/health

See **[Getting started](./README.GETTING-STARTED.md)** for the complete guide.

---

## Repository map (level 1)

```
aizea/
├── app/            → Next.js App Router: pages (UI) + REST API routes
├── components/     → React components (course, slides, tree, banner, UI)
├── lib/            → Core (hexagonal architecture) — see README.MODULES.md
│   ├── domain/          pure business logic
│   ├── application/     use cases + ports (interfaces)
│   ├── infrastructure/  implementations (Prisma, LanceDB, OpenRouter…)
│   ├── composition/     dependency injection (container)
│   ├── actions/         server actions de Next
│   ├── client/          data-layer tipado (ApiClient)
│   ├── stores/          client state (Zustand)
│   └── types/           shared types
├── prisma/         → schema + migraciones + dev.db
├── src-tauri/      → desktop shell (Rust): supervision, Node sidecar
├── scripts/        → local startup, MSI build, QA utilities
├── tests/          → suite (unit + integration)
└── docs/           → historical version documentation + consulting
```

---

## Project conventions

- **Language:** UI, messages, and documentation are in **English**; code and comments are in English.
- **Package manager:** `pnpm` (with `node-linker=hoisted`, required for the standalone Windows build).
- **Strict type safety:** `as any` and `@ts-ignore` are prohibited. Every change passes `tsc --noEmit` and the full suite.
- **Hexagonal architecture:** the domain does not know about infrastructure; they connect through ports in `lib/application/ports/`.

See the details in **[Architecture](./README.ARCHITECTURE.md)**.
