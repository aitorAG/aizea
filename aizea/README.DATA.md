# Data and persistence

[◄ Index](./README.md) · Previous: [API](./README.API.md) · Next: [Testing ►](./README.TESTING.md)

Data models, stores, and configuration resolution.

---

## Two stores

| Store | Technology | Contents | Location |
|---|---|---|---|
| **Relational** | SQLite + Prisma | Courses, materials, slides, tree, jobs, settings | dev: `prisma/dev.db` · desktop: `%APPDATA%\AIzea\db.sqlite` |
| **Vector** | LanceDB | Embeddings for RAG (semantic search) | dev: `lancedb-data/` · desktop: `%APPDATA%\AIzea\lancedb-data\` |

Los uploads de PDF van a `public/uploads/` (dev) o `%APPDATA%\AIzea\uploads\` (escritorio).

---

## Prisma models

Defined in [`prisma/schema.prisma`](./prisma/schema.prisma). 13 models:

### Course content

| Model | Description | Relations |
|---|---|---|
| **Course** | Root course. Has optional `llmContext` | → materials, slides, figures, topicNodes, topicGroups |
| **Material** | Uploaded PDF (`content` is deprecated in favor of `TextChunk`) | → course, textChunks, semanticUnits |
| **TextChunk** | Material fragment with optional `embedding` (for RAG) | → material |
| **Figure** | Image extracted from the PDF (`caption`, `pageNum`, `tags`) | → course |

### Slides

| Model | Description | Relations |
|---|---|---|
| **Slide** | Slide (`title`, `description`, `order`) | → course, boxes |
| **SlideBox** | Slide content box (`type`: script/relevance/narrative/exercises) | → slide |

### Concept tree

| Model | Description | Relations |
|---|---|---|
| **SemanticUnit** | Semantic unit extracted from material (`order`, `pageStart`) | → material, representation |
| **UnitRepresentation** | Structured unit representation (`concepts`, `mainIdeas`, `formulas` as JSON) | → unit (1:1) |
| **TopicNode** | Concept-tree node; `parent`/`children` self-relation (`"TopicTree"`) | → course, parent, children |
| **TopicGroup** | Topic grouping (`importance`) | → course |

### Sistema

| Model | Description |
|---|---|
| **Settings** | Singleton (`id="default"`): `openrouterApiKey` (encrypted — see [Security](./README.SECURITY.md)), `chatModel`, `embedModel`, `doclingBaseUrl` |
| **ProcessingJob** | Pipeline job: `type`, `status`, `progress`, `total`, `currentStep`. With `type="pipeline-run"`, it is the queue meta row (see [Pipeline](./README.PIPELINE.md)) |

---

## Migrations

En [`prisma/migrations/`](./prisma/migrations/):

- `20260711161501_add_pipeline_tables`
- `20260711200000_add_topic_group_table`

> Tests rebuild the DB by **replaying the SQL** from the pipeline migration. Therefore the queue reuses `ProcessingJob` instead of creating a new table (a new table would break that replay). See [Testing](./README.TESTING.md).

### Commands

| Command | Function |
|---|---|
| `pnpm db:generate` | Regenera el cliente Prisma |
| `pnpm db:push` | Synchronizes the schema with the DB (without a formal migration) |
| `pnpm db:studio` | Inspector visual (Prisma Studio) |

---

## Configuration resolution

[`lib/config-service.ts`](./lib/config-service.ts) resuelve los valores con precedencia **DB > env > defaults**:

1. `Settings` row (`id="default"`) if it has a non-empty value.
2. `process.env` (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_EMBED_MODEL`, `DOCLING_BASE_URL`).
3. Defaults integrados (`deepseek/deepseek-chat`, `openai/text-embedding-3-small`, `http://127.0.0.1:5001`).

- Cachea la fila **30 s** en memoria; `invalidateConfigCache()` fuerza relectura (los server actions de settings lo llaman al guardar).
- **Nunca lanza** por config ausente: siempre devuelve un valor usable.
- La API key se **descifra** al leer (transparente; retrocompatible con valores plaintext antiguos).

---

## SQLite and WAL (relevant to the build)

SQLite uses **WAL** mode by default: recent schema changes live in the `-wal` file next to `dev.db`. The desktop build performs a **WAL checkpoint** ([`scripts/wal-checkpoint.cjs`](./scripts/wal-checkpoint.cjs)) **before** copying the seeded DB, preventing tables or columns from being lost. See [Build](./README.BUILD.md).

---

[◄ Index](./README.md) · Previous: [API](./README.API.md) · Next: [Testing ►](./README.TESTING.md)
