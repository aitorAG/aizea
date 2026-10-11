<div align="center">

# 🎓 AIzea

### From PDFs to slides and concept trees with AI, 100% on your computer.

Desktop application that transforms PDF teaching material into **navigable concept trees** and **presentation-ready slides**, with local **semantic search (RAG)**. No cloud: your data never leaves your machine.

<br />

[![Release](https://img.shields.io/github/v/release/aitorAG/aizea?color=369eff&labelColor=black&logo=github&style=flat-square)](https://github.com/aitorAG/aizea/releases)
[![Windows](https://img.shields.io/badge/Windows-MSI%20%2F%20EXE-0078D6?labelColor=black&logo=windows&logoColor=white&style=flat-square)](https://github.com/aitorAG/aizea/releases)
[![Stars](https://img.shields.io/github/stars/aitorAG/aizea?color=ffcb47&labelColor=black&style=flat-square)](https://github.com/aitorAG/aizea/stargazers)
[![Issues](https://img.shields.io/github/issues/aitorAG/aizea?color=ff80eb&labelColor=black&style=flat-square)](https://github.com/aitorAG/aizea/issues)
[![Last commit](https://img.shields.io/github/last-commit/aitorAG/aizea?color=8ae8ff&labelColor=black&style=flat-square)](https://github.com/aitorAG/aizea/commits)

<br />

![Next.js](https://img.shields.io/badge/Next.js%2015-black?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React%2019-20232A?style=flat-square&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri%202-24C8DB?style=flat-square&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=flat-square&logo=rust&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=flat-square&logo=prisma&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)

</div>

---

## ✨ What Is AIzea

AIzea is a tool for **teachers and students** that turns notes and books in PDF format into structured teaching material without manual work.

Give AIzea a course PDF and it:

1. **Understands it**: segments the text, extracts key ideas (semantic units), and builds a navigable **concept tree** for the topic.
2. **Teaches it**: generates **slides** with a script, relevance, teacher narrative, and exercises, plus HTML ready for classroom projection.
3. **Remembers it**: indexes everything in a **semantic search (RAG)** engine so you can find any concept instantly.

Everything runs **locally**: the database (SQLite), vectors (LanceDB), and server live on your computer. The only external call is to the language model (through [OpenRouter](https://openrouter.ai)), using **your own API key**.

---

## 🚀 Features

| | Feature | What it does |
|:---:|:---|:---|
| 📄 | **Ingesta de PDF** | Analiza el layout con [Docling](https://github.com/DS4SD/docling) (o un fallback de texto plano) y extrae texto, estructura y figuras. |
| 🌳 | **Concept tree** | Segmentation → semantic units → integration → navigable topic tree, with adjustable granularity. |
| 🖼️ | **Figure extraction** | Recovers real images from the PDF. For vector diagrams without an embedded image, **rasterizes and crops** the figure from the PDF itself (in-process, with no external dependencies). |
| 🎬 | **Slide generation** | Structured content (script, relevance, narrative, exercises) + AI-generated HTML design. Parallel batch generation. |
| 📐 | **Automatic fitting** | Slides **auto-scale** to always fit landscape A4 (1123×794): no cropping or scrolling, on screen or in the PDF. |
| ∑ | **HTML formulas** | Renders LaTeX with **embedded KaTeX (100% offline)**, working without internet inside the `.exe`. |
| 🔍 | **Semantic search (RAG)** | Indexes content in [LanceDB](https://lancedb.com) for meaning-based search, not just keywords. |
| 📤 | **Export** | Exports to **PDF** (A4, one slide per page) or self-contained **HTML**. |
| 🔒 | **Privacidad primero** | Todo el procesamiento y almacenamiento es local. Tu clave de API se cifra en reposo. |
| 🖥️ | **App de escritorio** | Instalador nativo de Windows (MSI/EXE) con [Tauri 2](https://tauri.app); no requiere navegador ni servidor externo. |

---

## 📦 Installation (users)

AIzea is distributed as a **Windows (x64)** desktop application.

1. Download the installer from the [**Releases page**](https://github.com/aitorAG/aizea/releases):
   - **`AIzea_x.y.z_x64-setup.exe`**: NSIS installer, **per-user and does not require administrator permissions** (recommended).
   - **`AIzea_x.y.z_x64_es-ES.msi`**: MSI installer (enterprise deployment).
2. Run the installer and open AIzea.
3. On first launch, open **Settings** and enter your [OpenRouter](https://openrouter.ai/settings/keys) API key (required for AI generation).

> AIzea works offline except for language-model calls. PDFs, the database, and indexes never leave your computer.

---

## 🧭 How It Works

```
         Upload a PDF to a course
                 │
                 ▼
   ┌──────────────────────────────┐
    │  Pipeline (background)         │   persistent queue + worker
   ├──────────────────────────────┤
    │  1. Text segmentation         │
    │  2. Semantic units             │
    │  3. Integration                │
    │  4. Concept tree               │
   └──────────────┬───────────────┘
                  │
        ┌─────────┴──────────┐
        ▼                    ▼
    Navigable tree       RAG (LanceDB)
        │                    │
        ▼                    ▼
    Slides               Semantic
    (content + HTML      search
     + figures)
        │
        ▼
    Export to PDF / HTML
```

The pipeline is **resumable**: if interrupted, it resumes where it stopped after restart. Slide generation runs on demand or in parallel batches.

---

## 🏗️ Stack and Architecture

**AIzea** is a **[Tauri 2](https://tauri.app)** app (native **Rust** shell) embedding a **[Next.js 15](https://nextjs.org)** server (App Router, React 19, TypeScript) as a Node sidecar. Persistence uses **[Prisma](https://www.prisma.io) + SQLite**, vectors use **[LanceDB](https://lancedb.com)**, and AI uses **[OpenRouter](https://openrouter.ai)**.

The code follows **hexagonal architecture** (ports and adapters): the domain is pure and does not know about infrastructure; they connect through interfaces.

```
UI (app/ + components/ + stores)
        │  server actions / ApiClient
Application (casos de uso + PUERTOS)
         │  depends only on interfaces
Domain (PURE business logic)
        ▲  implementan los puertos
Infrastructure (Prisma · LanceDB · OpenRouter · pdfium · queue)
        ▲  cablea todo
Composition Root (dependency injection)
```

📚 **Complete technical documentation** is available in [`aizea/README.md`](./aizea/README.md): [architecture](./aizea/README.ARCHITECTURE.md), [modules](./aizea/README.MODULES.md), [pipeline](./aizea/README.PIPELINE.md), [data](./aizea/README.DATA.md), [API](./aizea/README.API.md), [security](./aizea/README.SECURITY.md), and [testing](./aizea/README.TESTING.md).

### Current local installer

The `local install file/` directory contains the current local installer files:

- `local install file/AIzea_0.19.2_x64_es-ES.msi`
- `local install file/AIzea_0.19.2_x64-setup.exe`

---

## 🛠️ Development

Requirements: **Node.js 20+**, **pnpm 11+**, **Docker** (optional, for the Docling parser), and **Rust 1.77+** (only for building the desktop app).

```bash
# 1. Install dependencies (triggers prisma generate)
pnpm install

# 2. Create .env from the template
cp .env.example .env   # o Copy-Item en PowerShell

# 3. Start the complete local stack (Docling + DB + Next dev on :3001)
pnpm local
```

Open **http://localhost:3001**. See [Getting started](./aizea/README.GETTING-STARTED.md) for the detailed guide.

### Useful commands

| Command | What it does |
|:---|:---|
| `pnpm local` | Starts Docling, synchronizes the DB, and starts Next dev |
| `pnpm dev` | Next.js dev only |
| `pnpm test` | Suite de tests (Vitest) |
| `pnpm typecheck` | `tsc --noEmit` (type-safety estricta) |
| `pnpm build` | Next.js production build |
| `pnpm build:msi` | Generates the desktop installer (MSI + EXE) — see [Build](./aizea/README.BUILD.md) |
| `pnpm tauri:dev` | Ventana Tauri contra el dev server |

> The project is **strictly type-safe** (`as any` / `@ts-ignore` are prohibited), and every change must pass `tsc --noEmit` and the full test suite.

---

## 🤝 Contributing

Contributions are welcome. Before opening a PR:

1. Make sure `pnpm typecheck` and `pnpm test` pass.
2. Follow the project conventions: UI and documentation are in **English**, code and comments are in **English**, and the domain does not import infrastructure.
3. Describe the change and how you verified it.

---

<div align="center">

**AIzea** — Turns your notes into structured knowledge.

Built with Next.js, Tauri, and Rust.

</div>
