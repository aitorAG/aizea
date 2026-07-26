# Datos y persistencia

[◄ Índice](./README.md) · Anterior: [API](./README.API.md) · Siguiente: [Testing ►](./README.TESTING.md)

Modelos de datos, almacenes y cómo se resuelve la configuración.

---

## Dos almacenes

| Almacén | Tecnología | Contenido | Ubicación |
|---|---|---|---|
| **Relacional** | SQLite + Prisma | Cursos, materiales, slides, árbol, jobs, settings | dev: `prisma/dev.db` · escritorio: `%APPDATA%\AIzea\db.sqlite` |
| **Vectorial** | LanceDB | Embeddings para RAG (búsqueda semántica) | dev: `lancedb-data/` · escritorio: `%APPDATA%\AIzea\lancedb-data\` |

Los uploads de PDF van a `public/uploads/` (dev) o `%APPDATA%\AIzea\uploads\` (escritorio).

---

## Modelos Prisma

Definidos en [`prisma/schema.prisma`](./prisma/schema.prisma). 13 modelos:

### Contenido del curso

| Modelo | Descripción | Relaciones |
|---|---|---|
| **Course** | Curso raíz. Tiene `llmContext` opcional | → materials, slides, figures, topicNodes, topicGroups |
| **Material** | PDF subido (el `content` está deprecado en favor de `TextChunk`) | → course, textChunks, semanticUnits |
| **TextChunk** | Fragmento de material con `embedding` opcional (para RAG) | → material |
| **Figure** | Imagen extraída del PDF (`caption`, `pageNum`, `tags`) | → course |

### Diapositivas

| Modelo | Descripción | Relaciones |
|---|---|---|
| **Slide** | Diapositiva (`title`, `description`, `order`) | → course, boxes |
| **SlideBox** | Caja de contenido de una slide (`type`: guion/relevancia/narrativa/ejercicios) | → slide |

### Árbol conceptual

| Modelo | Descripción | Relaciones |
|---|---|---|
| **SemanticUnit** | Unidad semántica extraída de un material (`order`, `pageStart`) | → material, representation |
| **UnitRepresentation** | Representación estructurada de una unidad (`concepts`, `mainIdeas`, `formulas` como JSON) | → unit (1:1) |
| **TopicNode** | Nodo del árbol conceptual; auto-relación `parent`/`children` (relación `"TopicTree"`) | → course, parent, children |
| **TopicGroup** | Agrupación de temas (`importance`) | → course |

### Sistema

| Modelo | Descripción |
|---|---|
| **Settings** | Singleton (`id="default"`): `openrouterApiKey` (cifrada — ver [Seguridad](./README.SECURITY.md)), `chatModel`, `embedModel`, `doclingBaseUrl` |
| **ProcessingJob** | Job del pipeline: `type`, `status`, `progress`, `total`, `currentStep`. Con `type="pipeline-run"` es la fila meta de la cola (ver [Pipeline](./README.PIPELINE.md)) |

---

## Migraciones

En [`prisma/migrations/`](./prisma/migrations/):

- `20260711161501_add_pipeline_tables`
- `20260711200000_add_topic_group_table`

> Los tests reconstruyen la DB **replayando el SQL** de la migración de pipeline. Por eso la cola reusa `ProcessingJob` en vez de crear una tabla nueva (una tabla nueva rompería ese replay). Ver [Testing](./README.TESTING.md).

### Comandos

| Comando | Función |
|---|---|
| `pnpm db:generate` | Regenera el cliente Prisma |
| `pnpm db:push` | Sincroniza el schema con la DB (sin migración formal) |
| `pnpm db:studio` | Inspector visual (Prisma Studio) |

---

## Resolución de configuración

[`lib/config-service.ts`](./lib/config-service.ts) resuelve los valores con precedencia **DB > env > defaults**:

1. Fila `Settings` (id `"default"`) si tiene valor no vacío.
2. `process.env` (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_EMBED_MODEL`, `DOCLING_BASE_URL`).
3. Defaults integrados (`deepseek/deepseek-chat`, `openai/text-embedding-3-small`, `http://127.0.0.1:5001`).

- Cachea la fila **30 s** en memoria; `invalidateConfigCache()` fuerza relectura (los server actions de settings lo llaman al guardar).
- **Nunca lanza** por config ausente: siempre devuelve un valor usable.
- La API key se **descifra** al leer (transparente; retrocompatible con valores plaintext antiguos).

---

## SQLite y WAL (relevante para el build)

SQLite usa modo **WAL** por defecto: cambios recientes de schema viven en el fichero `-wal` junto a `dev.db`. El build de escritorio hace un **WAL checkpoint** ([`scripts/wal-checkpoint.cjs`](./scripts/wal-checkpoint.cjs)) **antes** de copiar la DB semilla, para no perder tablas/columnas. Ver [Compilar](./README.BUILD.md).

---

[◄ Índice](./README.md) · Anterior: [API](./README.API.md) · Siguiente: [Testing ►](./README.TESTING.md)
