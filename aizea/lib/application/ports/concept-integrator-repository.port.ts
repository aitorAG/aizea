// Puerto del repositorio que necesita ConceptIntegrator.
//
// Encapsula las 3 operaciones de persistencia que el servicio de dominio usa
// al integrar conceptos en TopicGroups, para que `ConceptIntegrator` NO importe
// Prisma (`@/lib/db`) directamente (gate de Fase 1: cero imports de infra en
// domain/). La implementación Prisma vive en
// `lib/infrastructure/persistence/prisma-concept-integrator.repository.ts`.

/** Fila mínima de TopicGroup que el integrador necesita tras persistir. */
export interface CreatedTopicGroupRow {
  id: string;
  name: string;
  description: string;
  importance: number;
}

/** Datos para crear un TopicGroup. `concepts` y `sourceUnitIds` van
 *  JSON-codificados (el esquema los guarda como String). */
export interface CreateTopicGroupInput {
  id: string;
  courseId: string;
  name: string;
  description: string;
  importance: number;
  concepts: string;
  sourceUnitIds: string;
  version: number;
}

/** Representación de unidad reducida a lo que el integrador consume:
 *  el id de la unidad y sus conceptos JSON-codificados. */
export interface ConceptRepresentationRow {
  unitId: string;
  /** JSON-encoded Concept[] (tal y como lo guarda Prisma). */
  concepts: string;
}

export interface IConceptIntegratorRepository {
  /** Ids de todas las SemanticUnit del curso (vía Material→Course). */
  findUnitIdsByCourse(courseId: string): Promise<string[]>;

  /** UnitRepresentations de las unidades dadas (reducidas a unitId+concepts). */
  findRepresentationsByUnitIds(
    unitIds: string[]
  ): Promise<ConceptRepresentationRow[]>;

  /** Persiste un TopicGroup y devuelve la fila mínima resultante. */
  createTopicGroup(data: CreateTopicGroupInput): Promise<CreatedTopicGroupRow>;
}
