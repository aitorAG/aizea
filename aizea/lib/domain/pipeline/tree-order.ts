// DFS pre-order traversal of a TopicNode tree (v1.0).
//
// The tree is stored flat as (parentId, orderIndex) rows. Slides, the tree
// visual and the slides list must all present the SAME "top-to-bottom" order,
// which is a DEPTH-FIRST PRE-ORDER walk: a parent immediately before its
// children, siblings ordered by `orderIndex` (then a deterministic tiebreak).
//
// Pure and dependency-free so it can be unit-tested and reused by both the
// slide-generation path and the tree read path.

import type { TopicNode } from "@/lib/types/pipeline";

/** Minimal shape needed to order a tree. Anything with these fields works. */
export interface OrderableNode {
  id: string;
  parentId: string | null;
  orderIndex: number;
  /** Tiebreak when two siblings share orderIndex (stable, deterministic). */
  name: string;
}

/**
 * Return `nodes` reordered as a DFS pre-order traversal of the tree they form
 * via parentId. Roots (parentId null OR parentId not present in the set) come
 * first, ordered by orderIndex then name; each node is immediately followed by
 * its subtree. Deterministic for a given tree.
 *
 * Nodes whose parentId points outside the set are treated as roots (defensive:
 * partial selections, orphaned rows). Cycle-safe via a visited guard.
 */
export function dfsPreorder<T extends OrderableNode>(nodes: T[]): T[] {
  if (nodes.length === 0) return [];

  const byId = new Map<string, T>(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string | null, T[]>();

  for (const n of nodes) {
    // A node is a root when it has no parent OR its parent is not in the set.
    const key = n.parentId !== null && byId.has(n.parentId) ? n.parentId : null;
    const bucket = childrenOf.get(key);
    if (bucket) bucket.push(n);
    else childrenOf.set(key, [n]);
  }

  const sortSiblings = (a: T, b: T): number =>
    a.orderIndex !== b.orderIndex
      ? a.orderIndex - b.orderIndex
      : a.name.localeCompare(b.name);

  for (const bucket of childrenOf.values()) bucket.sort(sortSiblings);

  const result: T[] = [];
  const visited = new Set<string>();

  const walk = (node: T): void => {
    if (visited.has(node.id)) return; // cycle guard
    visited.add(node.id);
    result.push(node);
    const kids = childrenOf.get(node.id);
    if (kids) for (const child of kids) walk(child);
  };

  for (const root of childrenOf.get(null) ?? []) walk(root);

  // Safety net: if a cycle left nodes unvisited, append them deterministically
  // so no node is silently dropped.
  if (result.length < nodes.length) {
    for (const n of [...nodes].sort(sortSiblings)) {
      if (!visited.has(n.id)) {
        visited.add(n.id);
        result.push(n);
      }
    }
  }

  return result;
}

/** Convenience: DFS pre-order specifically for TopicNode[]. */
export function orderTopicNodes(nodes: TopicNode[]): TopicNode[] {
  return dfsPreorder(nodes);
}
