// Puerto del constructor de esqueleto del árbol (PR2 — estructura como
// ground-truth). Transforma los breadcrumbs de sección (sectionPath de cada
// SemanticUnit) en un esqueleto jerárquico SIN LLM.
//
// Es la columna vertebral del árbol: en vez de pedir al LLM que invente una
// jerarquía de cero (caro, no determinista, propenso a ciclos), derivamos la
// estructura de los headings del propio documento. El LLM, más tarde, solo
// refina/etiqueta sobre esta base.

/** Nodo del esqueleto. `depth` es SIEMPRE derivado de la cadena de padres
 *  (nunca declarado por un tercero) → imposible declarar una profundidad
 *  falsa. */
export interface SkeletonNode {
  /** Id local estable derivado del título de la sección. */
  ref: string;
  /** Título del heading. */
  name: string;
  /** Ref del padre, o null si es raíz. */
  parentRef: string | null;
  /** Profundidad 0-based derivada de la cadena parentRef (0 = raíz). */
  depth: number;
}

export interface ITreeSkeletonBuilder {
  /**
   * Construye el esqueleto a partir de los breadcrumbs de sección de las
   * unidades. Cada `path` es la ruta de headings de una unidad, p. ej.
   * `["3. Termodinámica"]` o `["Cap 3", "3.2 Entropía"]`.
   *
   * Señales de parentesco (en orden de prioridad):
   *   1. Adyacencia en el breadcrumb: path[i] es padre de path[i+1].
   *   2. Numeración del título: "3.2" cuelga de "3".
   *
   * Garantías: sin ciclos, sin refs huérfanas, `depth` real, orden topológico
   * (padres antes que hijos).
   */
  fromSectionPaths(paths: ReadonlyArray<readonly string[]>): SkeletonNode[];
}
