// ISemanticUnitRepository — port for SemanticUnit persistence.

export interface SemanticUnitRow {
  id: string;
  materialId: string;
  content: string;
  order: number;
  pageStart: number | null;
  pageEnd: number | null;
  sectionRef: string | null;
  createdAt: Date;
}

export interface ISemanticUnitRepository {
  findByMaterialId(materialId: string): Promise<SemanticUnitRow[]>;
  findById(id: string): Promise<SemanticUnitRow | null>;
  createMany(units: Omit<SemanticUnitRow, "id" | "createdAt">[]): Promise<void>;
  hasUnitsForMaterial(materialId: string): Promise<boolean>;
}
