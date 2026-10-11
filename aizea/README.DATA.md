# Data and Persistence

[◄ Index](./README.md) · Previous: [API](./README.API.md) · Next: [Testing ►](./README.TESTING.md)

Data models, stores, and how configuration is resolved.

---

## Two Stores

| Store | Technology | Contents | Location |
|---|---|---|---|
| **Relational** | SQLite + Prisma | Courses, materials, slides, tree, jobs, settings | dev: `prisma/dev.db` · desktop: `%APPDATA%\AIzea\db.sqlite` |
| **Vector** | LanceDB | Embeddings for RAG (semantic search) | dev: `lancedb-data/` · desktop: `%APPDATA%\AIzea\lancedb-data\` |

PDF uploads go to `public/uploads/` (dev) or `%APPDATA%\AIzea\uploads\` (desktop).

---

## Prisma Models

Defined in [`prisma/schema.prisma`](./prisma/schema.prisma). The models are:

### Course Content

| Model | Description | Relationships |
|---|---|---|
| **Course** | Root course. Has optional `llmContext` | → materials, slides, figures, topicNodes, topicGroups |
| **Material** | Uploaded PDF (`content` is deprecated in favor of `TextChunk`) | → course, textChunks, semanticUnits |
| **TextChunk** | Material fragment with optional `embedding` (for RAG) | → material |
| **Figure** | Image extracted from the PDF (`caption`, `pageNum`, `tags`) | → course |

### Slides

| Model | Description | Relationships |
|---|---|---|
| **Slide** | Slide (`title`, `description`, `order`) | → course, boxes |
| **SlideBox** | Content box for a slide (`type`: guion/relevancia/narrativa/ejercicios) | → slide |

### Concept Tree

| Model | Description | Relationships |
|---|---|---|
| **SemanticUnit** | Semantic unit extracted from material (`order`, `pageStart`) | → material, representation |
| **UnitRepresentation** | Structured representation of a unit (`concepts`, `mainIdeas`, `formulas` as JSON) | → unit (1:1) |
| **TopicNode** | Concept tree node; self-relation `parent`/`children` (relation `"TopicTree"`) | → course, parent, children |
| **TopicGroup** | Topic grouping (`importance`) | → course |

### System

| Model | Description |
|---|---|
| **Settings** | Singleton (`id="default"`): `openrouterApiKey` (encrypted — see [Security](./README.SECURITY.md)), `chatModel`, `embedModel`, `doclingBaseUrl` |
| **ProcessingJob** | Pipeline job: `type`, `status`, `progress`, `total`, `currentStep`. With `type="pipeline-run"`, it is the queue's meta row (see [Pipeline](./README.PIPELINE.md)) |

---

## Migrations

In [`prisma/migrations/`](./prisma/migrations/):

- `20260711161501_add_pipeline_tables`
- `20260711200000_add_topic_group_table`

> Tests rebuild the DB by **replaying the SQL** from the pipeline migration. That is why the queue reuses `ProcessingJob` instead of creating a new table (a new table would break that replay). See [Testing](./README.TESTING.md).

### Commands

| Command | Function |
|---|---|
| `pnpm db:generate` | Regenerates the Prisma client |
| `pnpm db:push` | Synchronizes the schema with the DB (without a formal migration) |
| `pnpm db:studio` | Visual inspector (Prisma Studio) |

---

## Configuration Resolution

[`lib/config-service.ts`](./lib/config-service.ts) resolves values with **DB > env > defaults** precedence:

1. `Settings` row (`id="default"`) if it has a non-empty value.
2. `process.env` (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_EMBED_MODEL`, `DOCLING_BASE_URL`).
3. Defaults integrados (`deepseek/deepseek-chat`, `openai/text-embedding-3-small`, `http://127.0.0.1:5001`).

- Caches the row for **30 s** in memory; `invalidateConfigCache()` forces a reread (the settings server actions call it when saving).
- **Never throws** because of missing config: always returns a usable value.
- The API key is **decrypted** when read (transparent; backward-compatible with old plaintext values).

---

## SQLite and WAL (Relevant to the Build)

SQLite uses **WAL** mode by default: recent schema changes live in the `-wal` file next to `dev.db`. The desktop build performs a **WAL checkpoint** ([`scripts/wal-checkpoint.cjs`](./scripts/wal-checkpoint.cjs)) **before** copying the seed DB, to avoid losing tables/columns. See [Build](./README.BUILD.md).

---

[◄ Index](./README.md) · Previous: [API](./README.API.md) · Next: [Testing ►](./README.TESTING.md)
