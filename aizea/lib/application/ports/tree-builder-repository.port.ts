// Puerto del repositorio que necesita TreeBuilder.
//
// Encapsula las 4 operaciones de persistencia que el servicio de dominio usa
// al construir el árbol de TopicNode desde los TopicGroups, para que
// `TreeBuilder` NO importe Prisma (`@/lib/db`) directamente (gate de Fase 1:
// cero imports de infra en domain/). La implementación Prisma vive en
// `lib/infrastructure/persistence/prisma-tree-builder.repository.ts`.

/** Fila de TopicGroup reducida a lo que TreeBuilder consume. `concepts` y
 *  `sourceUnitIds` van JSON-codificados (el esquema los guarda como String). */
export interface TreeBuilderGroupRow {
  id: string;
  name: string;
  description: string;
  importance: number;
  concepts: string;
  sourceUnitIds: string;
}

/** Datos para crear un TopicNode durante la construcción del árbol. */
export interface CreateTopicNodeInput {
  courseId: string;
  parentId: string | null;
  name: string;
  summary: string;
  depth: number;
  isLeaf: boolean;
  version: number;
  sourceMaterialId: string | null;
}

/** Fila de TopicNode devuelta tras persistir. */
export interface CreatedTopicNodeRow {
  id: string;
  courseId: string;
  parentId: string | null;
  name: string;
  summary: string | null;
  depth: number;
  isLeaf: boolean;
  version: number;
  sourceMaterialId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITreeBuilderRepository {
  /** TopicGroups del curso (reducidos a lo que el builder necesita). */
  findTopicGroupsByCourse(courseId: string): Promise<TreeBuilderGroupRow[]>;

  /** Versión más alta de TopicNode del curso, o null si no hay ninguno. */
  findLatestVersion(courseId: string): Promise<number | null>;

  /** Borra todos los TopicNode del curso (rebuild completo). */
  deleteNodesByCourse(courseId: string): Promise<void>;

  /** Persiste un TopicNode y devuelve la fila resultante. */
  createNode(data: CreateTopicNodeInput): Promise<CreatedTopicNodeRow>;
}
