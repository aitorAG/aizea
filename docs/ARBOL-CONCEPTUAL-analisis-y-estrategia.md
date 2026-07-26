# Generación del árbol conceptual — análisis, problemas y estrategia

> Documento de trabajo. Analiza el subsistema de generación del árbol conceptual (el valor añadido del producto), documenta los problemas detectados con sus recomendaciones, y propone estrategias para **reducir el tiempo de ejecución** y **mantener/aumentar la calidad**, contrastadas con el estado del arte.

Índice:
- [1. Aislamiento y contratos](#1-aislamiento-y-contratos)
- [2. Estrategia actual](#2-estrategia-actual)
- [3. Problemas identificados](#3-problemas-identificados)
- [4. Recomendaciones sobre lo actual](#4-recomendaciones-sobre-lo-actual)
- [5. Reducción del tiempo de ejecución](#5-reduccion-del-tiempo-de-ejecucion)
- [6. Estado del arte y estrategias propuestas](#6-estado-del-arte-y-estrategias-propuestas)
- [7. Hoja de ruta sugerida](#7-hoja-de-ruta-sugerida)
- [8. Propuesta de diseño de implementación](#8-propuesta-de-diseno-de-implementacion)

Ficheros del subsistema:
- `lib/domain/pipeline/SegmenterService.ts` — segmentación (heurística, sin LLM)
- `lib/domain/pipeline/UnitExtractor.ts` — extracción de conceptos (1 LLM/unidad)
- `lib/domain/pipeline/ConceptIntegrator.ts` — clustering + naming de grupos (embeddings + 1 LLM)
- `lib/domain/pipeline/TreeBuilder.ts` — jerarquía (1 LLM)
- `lib/domain/pipeline/IncrementalMerger.ts` — merge incremental de material nuevo
- `lib/domain/prompts/templates/build-tree.template.ts` — prompt del árbol
- `lib/infrastructure/pipeline/pipeline.service.ts` — orquestación de las 4 fases

---

## 1. Aislamiento y contratos

**Veredicto: bien aislado, seguro de tocar.** Es de los subsistemas mejor diseñados del proyecto.

- Dominio puro: `TreeBuilder` solo depende de dos puertos inyectados (`ITreeBuilderRepository`, `ILLMProvider`); cero imports de Prisma/infra.
- Contratos explícitos y pequeños: el puerto del repositorio tiene 4 métodos (`findTopicGroupsByCourse`, `findLatestVersion`, `deleteNodesByCourse`, `createNode`). El prompt está aislado en su plantilla.
- Orquestación desacoplada: `PipelineService` invoca cada fase por import dinámico con soft-skip.
- Red de tests: 17 casos `tree-builder`, 11 `concept-integrator`, 8 `incremental-merger`, 11 `unit-extractor`, + `pipeline.service` + `actions-tree` + e2e.

Los puntos de cambio (umbrales 0.7/0.85, prompt, versionado) están localizados y testeados. Se puede refactorizar con confianza.

---

## 2. Estrategia actual

```
PDF → Segmentación (heurística por párrafos/secciones, SIN LLM)
    → Extracción      (1 llamada LLM por unidad semántica)
    → Integración     (embeddings de conceptos + clustering O(n²) + 1 LLM para nombrar)
    → Árbol           (1 LLM organiza los grupos en jerarquía de cero)
```

La idea base es correcta: pre-clusterizar por embeddings para no saturar al LLM, y usar el LLM solo para nombrar/organizar. El problema no es la idea, sino su ejecución (sección 3).

---

## 3. Problemas identificados

### 🔴 P1 — El árbol descarta la señal del clustering
`ConceptIntegrator` calcula y guarda `sourceUnitIds` y `concepts` por grupo, pero `TreeBuilder` los ignora: manda solo nombre/descripción al LLM y le pide inventar la jerarquía. Se pagan embeddings para calcular relaciones y luego se tiran. Grupos que comparten unidades de origen (parentesco probable) no se marcan como relacionados.
`lib/domain/pipeline/TreeBuilder.ts` (build) · `build-tree.template.ts`

### 🔴 P2 — La validación de profundidad confía en el `depth` del LLM
`assertValidHierarchy` comprueba `n.depth > MAX_DEPTH` usando el número que el LLM puso en cada nodo, no la profundidad real derivada de la cadena `parentRef`. El LLM puede declarar `depth:1` en un nodo que está a profundidad 5 por su cadena de padres y pasa la validación.
`lib/domain/pipeline/TreeBuilder.ts` (assertValidHierarchy)

### 🟠 P3 — Clustering O(n²)
`clusterBySimilarity` compara cada par de conceptos. 500 conceptos = 125.000 comparaciones; 2.000 = 2 millones. Se nota en cursos grandes.
`lib/domain/pipeline/ConceptIntegrator.ts` (clusterBySimilarity)

### 🟠 P4 — Borra el árbol antes de confirmar el nuevo
`build` hace `deleteNodesByCourse` incondicional y luego crea. Si `createNode` falla a mitad, quedas sin árbol viejo y sin nuevo.
`lib/domain/pipeline/TreeBuilder.ts` (build)

### 🟠 P5 — Persistencia nodo a nodo en serie
Un `await createNode` por nodo → N round-trips secuenciales a SQLite.
`lib/domain/pipeline/TreeBuilder.ts` (build)

### 🟠 P6 — Extracción serial (el cuello de botella real)
`runExtraction` procesa las unidades en un bucle `for` con `await` por unidad: N llamadas LLM secuenciales. Es la fase más cara del pipeline y la más paralelizable.
`lib/infrastructure/pipeline/pipeline.service.ts` (runExtraction)

### 🟡 P7 — IncrementalMerger reusa el prompt equivocado
Llama a `buildIntegrateConceptsPrompt` para validar merges, pero espera `{decisions:[{action,parentRef}]}` que ese prompt no pide. En la práctica cae siempre al fallback de cosine.
`lib/domain/pipeline/IncrementalMerger.ts` (validateWithLlm)

### 🟡 P8 — Segmentación sin tope de tamaño
`SegmenterService` parte por párrafos/secciones con mínimo de 32 chars, pero sin máximo. Una sección larga va entera a una llamada de extracción, arriesgando el límite de contexto. El "refinar fronteras con LLM" es no-op futuro.
`lib/domain/pipeline/SegmenterService.ts`

---

## 4. Recomendaciones sobre lo actual

| # | Recomendación | Ataca | Esfuerzo | Impacto |
|---|---|---|---|---|
| R1 | Pasar `sourceUnitIds`/co-ocurrencia al prompt del árbol como señal de parentesco | P1 | Bajo | Alto (calidad) |
| R2 | Derivar `depth` de la cadena de padres al resolver; ignorar el del LLM | P2 | Bajo | Corrige bug |
| R3 | Construir la versión nueva y borrar/ocultar la vieja solo al final (o filtrar por `version`) | P4 | Bajo | Seguridad de datos |
| R4 | Insertar nodos por niveles en lote (`createMany` por nivel) | P5 | Bajo | Medio (velocidad) |
| R5 | Prompt de merge propio para `IncrementalMerger` (que devuelva `action`/`parentRef`) | P7 | Medio | Medio (calidad merge) |
| R6 | Tope de tamaño por unidad en la segmentación (partir secciones largas) | P8 | Bajo | Medio (robustez) |

---

## 5. Reducción del tiempo de ejecución

### Paralelización (sin cambiar metodología)

- **E1 — Extracción concurrente con límite** *(mayor ganancia)*. Sustituir el bucle serial de `runExtraction` por procesamiento con concurrencia acotada (p. ej. 5-8 en vuelo) respetando la cancelación cooperativa y el rate-limit de OpenRouter. Para N unidades, el tiempo baja de `N·t` a ≈ `N·t/concurrencia`. Ya hay circuit-breaker y retry en infra para apoyarlo.
- **E2 — Persistencia en lote**. `createMany` por nivel del árbol (R4) y batch de representaciones en extracción.
- **E3 — Clustering sub-cuadrático** (P3). Usar el índice vectorial (LanceDB, ya presente) para vecinos aproximados en vez de comparar todos los pares, o clusterizar por bloques.

### Metodología (menos llamadas LLM)

- **E4 — Aprovechar la estructura del documento**. Docling ya extrae `structure.sections` (headings/TOC). Usar esa jerarquía como **esqueleto** del árbol elimina en gran parte la llamada del `TreeBuilder` "de cero": el LLM pasa de *inventar* la jerarquía a *refinar/etiquetar* una que ya viene del libro. Menos tokens, más fidelidad. (Ver estado del arte, sección 6.)
- **E5 — Extracción por lotes**. Agrupar varias unidades pequeñas en una sola llamada de extracción reduce el nº de round-trips (menos overhead por llamada), a costa de prompts más largos. Equilibrio a medir.

---

## 6. Estado del arte y estrategias propuestas

Contraste con investigación reciente sobre generación de jerarquías/grafos conceptuales desde textos:

### A. Usar la estructura del propio libro como ground-truth
Varios trabajos (Stamper 2023, *Concept Hierarchy Extraction from Textbooks*, Frontiers 2024) coinciden: la **tabla de contenidos y los headings** del libro son la mejor semilla de la jerarquía, con mínimo preprocesado y de forma independiente del dominio. La filosofía de DocKG lo resume: *"structure is ground truth; embeddings are an acceleration layer"*.
→ **Propuesta S1**: construir el esqueleto del árbol desde `structure.sections` de docling (headings), y usar el LLM solo para etiquetar/consolidar y colocar los conceptos-hoja bajo la sección correcta. Ataca P1 y reduce coste (E4).

### B. Taxonomía top-down por capas (Chain-of-Layer, arXiv 2402.07386)
En vez de pedir toda la jerarquía en una sola respuesta (lo que hoy hace `TreeBuilder`, propenso a raíces múltiples, ciclos y alucinación), CoL la construye **capa a capa de arriba abajo** con un *filtro de ranking por ensemble* para reducir alucinación, y usa un **formato jerárquico numerado** (1, 1.1, 1.2…) para que el LLM tenga vista global de la estructura en cada paso. Estado del arte en 4 benchmarks.
→ **Propuesta S2**: si se mantiene la generación por LLM, migrar el prompt del árbol a formato numerado jerárquico y construcción por capas. Ataca P1/P2 (estructura explícita) y sube calidad. Coste: más llamadas (una por capa) — combinable con S1 para acotar.

### C. Resumen recursivo tipo RAPTOR / E2GraphRAG (arXiv 2505.24226)
Construir el árbol **bottom-up**: agrupar chunks consecutivos y resumirlos con LLM, y repetir sobre los resúmenes hasta llegar a la raíz. El nº de llamadas LLM es ≈ `n/(g-1)` (casi logarítmico) y **cada nivel es totalmente paralelizable**. E2GraphRAG reporta hasta 10× más rápido en indexación que GraphRAG.
→ **Propuesta S3**: alternativa de metodología para el árbol — resumen recursivo por niveles, paralelo por nivel. Naturalmente rápido y escalable; produce nodos con resumen multi-granularidad (útil también para las diapositivas). Ataca P5/P6 y el tiempo global.

### D. Extracción de entidades sin LLM (E2GraphRAG)
E2GraphRAG usa **SpaCy** (NLP tradicional) en vez de LLM para extraer entidades, y co-ocurrencia en frase para relaciones — muchísimo más barato que 1 LLM/unidad.
→ **Propuesta S4** (más disruptiva): para la capa de conceptos, evaluar extracción con NLP local (entidades/nombres) reservando el LLM para desambiguar/nombrar clusters. Reduce drásticamente el coste de la fase de extracción (P6). Requiere añadir dependencia NLP; valorar contra la ganancia.

### E. Desambiguación por similitud + juez LLM (RAKG, arXiv 2504.09823)
RAKG extrae pre-entidades por chunk, las **desambigua por similitud vectorial** (unión por umbral) y usa el **LLM como juez** solo para validar los casos dudosos y las relaciones, no para generarlo todo. Reporta 95.9% de precisión, superando a GraphRAG.
→ **Propuesta S5**: aplicar el patrón "cosine primero, LLM solo para dudas" también en integración/merge — es justo lo que `IncrementalMerger` intenta pero con el prompt roto (P7). Formalizarlo sube calidad y baja coste.

---

## 7. Hoja de ruta sugerida

**Fase A — Correcciones de bajo riesgo (sobre lo actual, sin cambiar metodología).** R1 (usar `sourceUnitIds` en el prompt), R2 (depth real), R3 (construir antes de borrar), R4 (persistencia en lote), E1 (extracción concurrente). Alto retorno, red de tests existente, contratos intactos.

**Fase B — Aprovechar la estructura del documento.** S1 (esqueleto desde headings de docling) + R6 (tope de tamaño en segmentación). Sube calidad y baja coste sin reescritura mayor.

**Fase C — Metodología avanzada (evaluar, mayor alcance).** Elegir entre S2 (Chain-of-Layer por capas) para calidad, o S3 (resumen recursivo paralelo) para velocidad; y S5 (cosine + juez LLM) para integración/merge. S4 (NLP local) solo si el coste de extracción sigue siendo el cuello.

**Recomendación de arranque:** Fase A primero — corrige dos bugs reales (P2, P4), da la mayor ganancia de velocidad (E1) y la mayor ganancia de calidad barata (R1), todo con los contratos y tests actuales. Fase B y C ya son decisiones de producto sobre cuánta metodología nueva incorporar.

---

## 8. Propuesta de diseño de implementación

> Esta es la propuesta con opinión del líder del proyecto. No es un menú: es **una** arquitectura elegida, justificada, y encajada en los contratos y ficheros actuales. Prioriza solidez (contratos claros, fallos localizados, red de tests), calidad (fidelidad al libro, menos alucinación) y eficiencia (paralelismo real, menos tokens).

### 8.0 Decisión de arquitectura

Combino tres ideas del estado del arte, cada una donde aporta más, en vez de reescribir el pipeline entero:

1. **Estructura del documento como esqueleto** (DocKG / textbooks): docling ya entrega `structure.sections` (headings). Ese árbol de secciones ES la columna vertebral. El LLM deja de *inventar* jerarquía y pasa a *etiquetar y colocar* — menos tokens, más fidelidad, menos alucinación estructural.
2. **Cosine-primero, LLM-solo-para-dudas** (RAKG): embeddings resuelven lo obvio (agrupar conceptos, colgar hojas bajo su sección); el LLM interviene solo en los casos ambiguos y en nombrar. Menos llamadas, mayor precisión.
3. **Refinamiento por capas con formato numerado** (Chain-of-Layer): cuando el LLM sí toca la jerarquía (consolidar secciones ruidosas, reubicar huérfanos), lo hace sobre un formato numerado `1 / 1.1 / 1.2` que le da vista global y elimina ciclos/raíces múltiples por construcción.

**Por qué no full-LLM (lo actual):** caro, no determinista, y desperdicia la estructura del libro y la señal de embeddings. **Por qué no full-bottom-up (RAPTOR puro):** produce resúmenes multi-granularidad excelentes pero pierde los *nombres de tema* pedagógicos que el usuario espera ver; lo dejamos como opción futura para las diapositivas, no para el árbol.

### 8.1 Flujo objetivo

```
PDF ─► Segmentación (headings + tope de tamaño)         [sin LLM]
        │  produce: unidades con sectionPath (breadcrumb del heading)
        ▼
     Extracción concurrente (pool acotado)               [N× LLM en paralelo]
        │  produce: conceptos por unidad
        ▼
     Integración (ANN clustering vía LanceDB + naming)   [1 LLM: solo nombrar clusters]
        │  produce: TopicGroups con sourceUnitIds + sectionPaths
        ▼
     Ensamblado del árbol:
        1. Esqueleto = jerarquía de secciones (headings)  [sin LLM]
        2. Colgar cada TopicGroup bajo su sección por      [cosine, sin LLM]
           coincidencia de sectionPath / similitud
        3. Refinamiento por capas SOLO si hace falta       [LLM opcional, formato numerado]
           (secciones vacías, huérfanos, colisiones)
        ▼
     Persistencia por niveles (createMany)                [batch]
```

Coste LLM: de `O(unidades) + 2` llamadas grandes (hoy) a `O(unidades)` paralelas + `1` de naming + `≤1` de refinamiento. El árbol deja de depender de una única respuesta monolítica del LLM.

### 8.2 Contratos (nuevos / cambiados)

Mantiene los puertos actuales; añade campos y un servicio de concurrencia. Sin `as any`, sin romper firmas existentes.

```ts
// lib/types/pipeline.ts — SemanticUnit gana el breadcrumb de sección.
interface SemanticUnit {
  // …campos actuales…
  /** Ruta de headings desde la raíz del doc: ["Cap 3", "3.2 Termodinámica"].
   *  Vacío si docling no dio estructura (fallback text-only). */
  sectionPath: string[];
}

// lib/domain/pipeline/tree-skeleton.ts — NUEVO. Construye el esqueleto
// desde las secciones, sin LLM. Dominio puro y testeable.
interface SkeletonNode {
  ref: string;              // id local estable derivado del sectionPath
  name: string;             // título del heading
  parentRef: string | null;
  depth: number;            // DERIVADO de la cadena, no declarado
}
interface ITreeSkeletonBuilder {
  fromSections(sections: DocSection[]): SkeletonNode[];
}

// lib/application/ports/concurrency.port.ts — NUEVO. Pool acotado
// reutilizable, con cancelación cooperativa y respeto al circuit-breaker.
interface IBoundedPool {
  /** Ejecuta tasks con como máximo `limit` en vuelo. Aborta limpio si
   *  `signal.aborted`. Propaga el primer error tras drenar los en curso. */
  map<T, R>(items: T[], limit: number,
            fn: (item: T, signal: AbortSignal) => Promise<R>,
            signal?: AbortSignal): Promise<R[]>;
}
```

`ITreeBuilderRepository` gana dos métodos aditivos (los actuales siguen):

```ts
interface ITreeBuilderRepository {
  // …los 4 actuales…
  /** Inserción por niveles: todos los nodos de una profundidad en un batch. */
  createNodesBatch(nodes: CreateTopicNodeInput[]): Promise<CreatedTopicNodeRow[]>;
  /** Borra una versión concreta (para limpiar la vieja tras confirmar la nueva). */
  deleteNodesByVersion(courseId: string, version: number): Promise<void>;
}
```

### 8.3 Diseño por fase

**Segmentación** (`SegmenterService`): al mapear `structure.sections`, adjuntar `sectionPath` a cada unidad y **partir** cualquier unidad que supere un tope de tokens (`MAX_UNIT_CHARS`, configurable) por frontera de párrafo. Resuelve P8 y habilita el esqueleto. Sigue sin LLM.

**Extracción** (`PipelineService.runExtraction`): sustituir el bucle serial por `IBoundedPool.map(units, CONCURRENCY, …, signal)`. La cancelación cooperativa actual (comprobar `isJobCancelled`) se traslada al `signal` del pool. El progreso se actualiza por unidad completada (contador atómico). Resuelve P6, mantiene retry/circuit-breaker.

**Integración** (`ConceptIntegrator`): reemplazar el clustering O(n²) por vecinos aproximados vía LanceDB (embeber conceptos, consultar top-k por concepto, unir por umbral). El LLM sigue solo para nombrar clusters. Propagar `sectionPaths` agregados de las unidades fuente a cada `TopicGroup`. Resuelve P3, alimenta P1.

**Ensamblado del árbol** (`TreeBuilder`, reescrito con la nueva estrategia):
1. `skeleton = ITreeSkeletonBuilder.fromSections(...)` — esqueleto desde headings, `depth` derivado de la cadena (resuelve P2 por construcción).
2. Colgar cada `TopicGroup` bajo la sección cuyo `sectionPath` mejor coincide (prefijo exacto → cosine como desempate). Sin LLM.
3. Refinamiento por capas (opcional, formato numerado Chain-of-Layer) **solo** para: secciones sin contenido que colapsar, grupos huérfanos sin sección clara, y consolidación de secciones redundantes. Una llamada acotada, no una jerarquía de cero.
4. **Construir versión N+1 completa en memoria → `createNodesBatch` por nivel → borrar versión vieja al final** (resuelve P4 y P5).

**Merge incremental** (`IncrementalMerger`): prompt de merge propio que devuelva `{action, parentRef}` (resuelve P7), y formalizar cosine-primero/LLM-para-dudas (RAKG). Reusa `sectionPath` del material nuevo para colgar bajo la sección correcta.

### 8.4 Modelo de concurrencia

`IBoundedPool` es la única pieza de infra nueva relevante. Implementación: worker-pool clásico (N promesas que consumen de una cola compartida). Requisitos no negociables:
- **Límite** configurable (arranque conservador: 5-6, por el rate-limit de OpenRouter).
- **Cancelación**: `AbortSignal`; al abortar, no arranca nuevas tasks y espera a las en curso (no deja llamadas colgando).
- **Errores**: recoge el primer error, deja terminar las en vuelo, luego rechaza (fail-fast sin dejar huérfanos).
- **Se apoya** en el `circuit-breaker` y `retry` existentes por llamada (no los reimplementa).

### 8.5 Cambios de datos

Mínimos y aditivos:
- `SemanticUnit.sectionPath` — nuevo campo. En schema Prisma, `SemanticUnit` ya tiene `sectionRef`; se puede reutilizar/extender a un path JSON sin migración disruptiva.
- `TopicGroup.sourceUnitIds` ya existe (hoy infrautilizado) — pasa a usarse.
- Ningún borrado de columnas. Retrocompatible con cursos ya procesados (si no hay `sectionPath`, el árbol cae al camino LLM actual como fallback).

### 8.6 Estrategia de tests

- **Unit, dominio puro**: `tree-skeleton` (headings → esqueleto, depth derivado, sin ciclos), `BoundedPool` (límite respetado, aborta limpio, propaga error tras drenar), `TreeBuilder` nuevo (esqueleto + colgado + refinamiento con LLM fake).
- **Regresión**: los 17 casos de `tree-builder` actuales deben seguir verdes con el camino de fallback (sin `sectionPath`).
- **Integración**: `pipeline-queue`/e2e ya cubren el flujo; añadir un caso con secciones reales de docling.
- **Propiedad**: el árbol resultante nunca tiene ciclos, `depth ≤ MAX_DEPTH` real, y todo `TopicGroup` acaba colgado de exactamente un padre.

### 8.7 Feature flag y rollout

Detrás de un flag (`AIZEA_TREE_STRATEGY = "structure" | "llm"`, default `structure` con fallback automático a `llm` cuando no hay estructura). Permite comparar calidad A/B sobre los mismos materiales y revertir sin desplegar. El camino `llm` actual se conserva intacto como red de seguridad hasta validar el nuevo en cursos reales.

### 8.8 Orden de implementación (encaja con la hoja de ruta §7)

1. `IBoundedPool` + extracción concurrente (E1). Aislado, alto impacto en tiempo, tests propios. **Primer PR.**
2. `sectionPath` en segmentación + `ITreeSkeletonBuilder` (S1/E4). **Segundo PR.**
3. `TreeBuilder` reescrito: esqueleto → colgado → refinamiento; persistencia por niveles; construir-antes-de-borrar (R2/R3/R4/P1). **Tercer PR.**
4. Integración ANN vía LanceDB (P3) + prompt de merge propio (P7). **Cuarto PR.**

Cada PR deja el árbol verde y es reversible por el flag. Ninguno rompe contratos existentes.

---

### Referencias
- Chain-of-Layer: Iteratively Prompting LLMs for Taxonomy Induction — arXiv 2402.07386
- E2GraphRAG: Streamlining Graph-based RAG — arXiv 2505.24226
- RAKG: Document-level Retrieval Augmented KG Construction — arXiv 2504.09823
- Hierarchical Concept Map Generation from Course Data — Stamper 2023
- Concept Hierarchy Extraction from Textbooks (Wikipedia-based, local+global features)
- Leveraging LLMs for Automated Extraction of Educational Concepts — MDPI 2025
- Microsoft GraphRAG · DocKG (structure-as-ground-truth) · RAPTOR (resumen recursivo)
