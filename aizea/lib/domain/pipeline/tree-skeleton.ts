// TreeSkeletonBuilder — implementación de ITreeSkeletonBuilder (PR2).
//
// Deriva un esqueleto jerárquico de los breadcrumbs de sección, sin LLM.
// Dos señales de parentesco combinadas:
//   1. Adyacencia en el breadcrumb (prioritaria): en ["A","B"], A es padre de B.
//   2. Numeración del título (respaldo): "3.2 X" cuelga de "3 …".
//
// Todo el diseño es defensivo: nunca crea ciclos (guarda explícita), deriva
// `depth` recorriendo la cadena real de padres, y emite en orden topológico.

import {
  type ITreeSkeletonBuilder,
  type SkeletonNode,
} from "@/lib/application/ports/tree-skeleton.port";

/** Captura el prefijo de numeración de un título: "3.2 Entropía" → "3.2". */
const NUMBERING_REGEX = /^(\d+(?:\.\d+)*)\.?\s/;

interface MutableNode {
  ref: string;
  name: string;
  parentRef: string | null;
  numbering: string | null;
}

export class TreeSkeletonBuilder implements ITreeSkeletonBuilder {
  fromSectionPaths(
    paths: ReadonlyArray<readonly string[]>
  ): SkeletonNode[] {
    // 1. Recolecta títulos únicos (cada uno = un nodo; el ref es el título).
    const byRef = new Map<string, MutableNode>();
    const numberingToRef = new Map<string, string>();

    const ensureNode = (title: string): MutableNode | null => {
      const name = title.trim();
      if (name.length === 0) return null;
      let node = byRef.get(name);
      if (!node) {
        const numbering = this.extractNumbering(name);
        node = { ref: name, name, parentRef: null, numbering };
        byRef.set(name, node);
        // El primer título que reclama una numeración se queda con ella.
        if (numbering && !numberingToRef.has(numbering)) {
          numberingToRef.set(numbering, name);
        }
      }
      return node;
    };

    for (const path of paths) {
      for (const title of path) ensureNode(title);
    }

    if (byRef.size === 0) return [];

    // 2. Parentesco por adyacencia en el breadcrumb (señal prioritaria).
    for (const path of paths) {
      const clean = path.map((t) => t.trim()).filter((t) => t.length > 0);
      for (let i = 1; i < clean.length; i++) {
        const child = byRef.get(clean[i]);
        const parentRef = clean[i - 1];
        if (!child || child.parentRef !== null) continue;
        if (parentRef === child.ref) continue;
        if (!byRef.has(parentRef)) continue;
        if (this.wouldCycle(byRef, child.ref, parentRef)) continue;
        child.parentRef = parentRef;
      }
    }

    // 3. Parentesco por numeración (respaldo para nodos aún sin padre).
    //    "3.2.1" → padre "3.2"; "3.2" → padre "3"; "3" → raíz.
    for (const node of byRef.values()) {
      if (node.parentRef !== null || !node.numbering) continue;
      const parentNumbering = this.parentNumbering(node.numbering);
      if (!parentNumbering) continue;
      const parentRef = numberingToRef.get(parentNumbering);
      if (!parentRef || parentRef === node.ref) continue;
      if (this.wouldCycle(byRef, node.ref, parentRef)) continue;
      node.parentRef = parentRef;
    }

    // 4. Deriva depth de la cadena REAL de padres + orden topológico (DFS:
    //    padres antes que hijos).
    return this.emitTopological(byRef);
  }

  // ----- helpers -----

  private extractNumbering(title: string): string | null {
    const m = NUMBERING_REGEX.exec(title);
    return m ? m[1] : null;
  }

  /** "3.2.1" → "3.2"; "3" → null (una raíz no tiene numeración padre). */
  private parentNumbering(numbering: string): string | null {
    const idx = numbering.lastIndexOf(".");
    return idx === -1 ? null : numbering.slice(0, idx);
  }

  /** ¿Asignar `candidateParent` como padre de `childRef` crearía un ciclo?
   *  Se cumple si `childRef` es un ancestro (o el mismo) de `candidateParent`. */
  private wouldCycle(
    byRef: Map<string, MutableNode>,
    childRef: string,
    candidateParent: string
  ): boolean {
    let cursor: string | null = candidateParent;
    const seen = new Set<string>();
    while (cursor !== null) {
      if (cursor === childRef) return true;
      if (seen.has(cursor)) return true; // ciclo preexistente (defensivo)
      seen.add(cursor);
      cursor = byRef.get(cursor)?.parentRef ?? null;
    }
    return false;
  }

  private depthOf(
    byRef: Map<string, MutableNode>,
    ref: string
  ): number {
    let depth = 0;
    let cursor = byRef.get(ref)?.parentRef ?? null;
    const seen = new Set<string>([ref]);
    while (cursor !== null && !seen.has(cursor)) {
      depth += 1;
      seen.add(cursor);
      cursor = byRef.get(cursor)?.parentRef ?? null;
    }
    return depth;
  }

  private emitTopological(
    byRef: Map<string, MutableNode>
  ): SkeletonNode[] {
    const ordered: SkeletonNode[] = [];
    const visited = new Set<string>();

    const visit = (ref: string): void => {
      if (visited.has(ref)) return;
      const node = byRef.get(ref);
      if (!node) return;
      if (node.parentRef) visit(node.parentRef); // padre primero
      if (visited.has(ref)) return;
      visited.add(ref);
      ordered.push({
        ref: node.ref,
        name: node.name,
        parentRef: node.parentRef,
        depth: this.depthOf(byRef, ref),
      });
    };

    for (const ref of byRef.keys()) visit(ref);
    return ordered;
  }
}
