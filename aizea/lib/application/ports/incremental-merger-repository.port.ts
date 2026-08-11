// Puerto del repositorio que necesita IncrementalMerger.
//
// Encapsula las 3 operaciones Prisma que el servicio de dominio usa al mezclar
// una nueva material en el árbol de TopicNode existente (cargar el árbol,
// resolver la versión más alta, crear nodos), para que `IncrementalMerger` NO
// importe Prisma (`@/lib/db`) directamente (gate de Fase 1: cero imports de
// infra en domain/). La implementación Prisma vive en
// `lib/infrastructure/persistence/prisma-incremental-merger.repository.ts`.

/** Datos para crear un TopicNode durante la mezcla. `id` es opcional: los
 *  nodos raíz lo fijan (randomUUID) y los hijos dejan que la BD lo asigne. */
export interface MergeCreateNodeInput {
  id?: string;
  courseId: string;
  parentId: string | null;
  name: string;
  summary: string | null;
  depth: number;
  /** v1.0 — orden entre hermanos (menor = antes). */
  orderIndex: number;
  isLeaf: boolean;
  version: number;
  sourceMaterialId: string | null;
}

/** Fila de TopicNode devuelta tras persistir / cargar. */
export interface MergeTopicNodeRow {
  id: string;
  courseId: string;
  parentId: string | null;
  name: string;
  summary: string | null;
  depth: number;
  orderIndex: number;
  isLeaf: boolean;
  version: number;
  sourceMaterialId: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IIncrementalMergerRepository {
  /** Todos los TopicNode del curso (árbol existente). */
  findNodesByCourse(courseId: string): Promise<MergeTopicNodeRow[]>;

  /** Versión más alta de TopicNode del curso, o null si no hay ninguno. */
  findLatestVersion(courseId: string): Promise<number | null>;

  /** Persiste un TopicNode (raíz o hijo) y devuelve la fila resultante. */
  createNode(data: MergeCreateNodeInput): Promise<MergeTopicNodeRow>;
}
