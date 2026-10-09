/**
 * Tree numbering utilities
 * 
 * Assigns hierarchical numbers (1, 1.1, 1.2, 1.2.1, etc.) to tree nodes
 * using DFS pre-order traversal.
 */

export interface Numberable {
  id: string;
  parentId: string | null;
  numericPath?: string | null;
  displayOrder?: number | null;
  /** Manual sibling ordering (TopicNode.orderIndex). Optional so plain
   *  { id, parentId } nodes remain valid inputs. */
  orderIndex?: number | null;
}

export interface NumberingResult {
  id: string;
  numericPath: string;
  displayOrder: number;
}

/**
 * Assigns hierarchical numbers to a flat list of nodes with parent-child relationships.
 * 
 * Example output:
 * - Root nodes: "1", "2", "3"
 * - Children of "1": "1.1", "1.2", "1.3"
 * - Grandchildren of "1.2": "1.2.1", "1.2.2"
 * 
 * @param nodes Flat array of nodes with id and parentId
 * @returns Array of { id, numericPath, displayOrder } mappings
 */
export function assignnumericPaths<T extends Numberable>(
  nodes: T[]
): NumberingResult[] {
  if (nodes.length === 0) return [];

  // Build parent-child map
  const childrenMap = new Map<string | null, T[]>();
  
  for (const node of nodes) {
    const parent = node.parentId;
    if (!childrenMap.has(parent)) {
      childrenMap.set(parent, []);
    }
    childrenMap.get(parent)!.push(node);
  }

  const results: NumberingResult[] = [];
  let globalOrder = 0;

  /**
   * DFS pre-order traversal with number stack
   * @param parentId Parent node ID (null for roots)
   * @param numberStack Array of level counters [1, 2, 3] => "1.2.3"
   */
  function traverse(parentId: string | null, numberStack: number[]): void {
    const children = childrenMap.get(parentId) || [];
    
    // Sort children by existing orderIndex if available (preserves manual ordering)
    children.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

    let siblingCounter = 1;

    for (const child of children) {
      // Build number for this node: append sibling counter to parent's stack
      const newStack = [...numberStack, siblingCounter];
      const numericPath = newStack.join('.');
      
      results.push({
        id: child.id,
        numericPath,
        displayOrder: globalOrder++,
      });

      // Recurse into children with the new stack
      traverse(child.id, newStack);
      
      // Increment sibling counter for next child at this level
      siblingCounter++;
    }
  }

  // Start from root nodes (parentId = null) with empty stack
  traverse(null, []);

  return results;
}

/**
 * Natural sort comparator for hierarchical numbers.
 * Correctly orders: "1", "1.1", "1.2", "1.10", "2", "2.1"
 * 
 * @param a First numeric path
 * @param b Second numeric path
 * @returns Negative if a < b, positive if a > b, 0 if equal
 */
export function comparenumericPaths(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  if (!a && !b) return 0;
  if (!a) return 1; // nulls last
  if (!b) return -1;

  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  const maxLen = Math.max(aParts.length, bParts.length);

  for (let i = 0; i < maxLen; i++) {
    const aVal = aParts[i] ?? 0;
    const bVal = bParts[i] ?? 0;

    if (aVal !== bVal) {
      return aVal - bVal;
    }
  }

  return 0;
}

/**
 * Sorts an array of items by their numericPath field.
 * 
 * @param items Array of items with numericPath property
 * @returns Sorted array (new copy)
 */
export function sortBynumericPath<T extends { numericPath?: string | null }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) =>
    comparenumericPaths(a.numericPath, b.numericPath)
  );
}

/** A tree node with recursively-typed children. */
export type TreeNode<T extends Numberable> = T & { children: TreeNode<T>[] };

/**
 * Rebuilds a tree structure from flat list and assigns hierarchical numbers.
 * Returns both the tree and the numbering results.
 * 
 * @param nodes Flat array of nodes
 * @returns Tree structure with hierarchical numbers assigned
 */
export function buildTreeWithNumbers<T extends Numberable>(
  nodes: T[]
): {
  tree: TreeNode<T>[];
  numbering: NumberingResult[];
} {
  const numbering = assignnumericPaths(nodes);
  const numberingMap = new Map(numbering.map(n => [n.id, n]));

  // Build tree structure
  const nodeMap = new Map<string, TreeNode<T>>();
  
  for (const node of nodes) {
    nodeMap.set(node.id, { ...node, children: [] });
  }

  const roots: TreeNode<T>[] = [];

  for (const node of nodes) {
    const treeNode = nodeMap.get(node.id)!;
    const nodeNumbering = numberingMap.get(node.id);
    
    if (nodeNumbering) {
      treeNode.numericPath = nodeNumbering.numericPath;
      treeNode.displayOrder = nodeNumbering.displayOrder;
    }

    if (node.parentId === null) {
      roots.push(treeNode);
    } else {
      const parent = nodeMap.get(node.parentId);
      if (parent) {
        parent.children.push(treeNode);
      }
    }
  }

  return { tree: roots, numbering };
}
