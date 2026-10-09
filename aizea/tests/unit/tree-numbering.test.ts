import { describe, it, expect } from 'vitest';
import {
  assignnumericPaths,
  comparenumericPaths,
  sortBynumericPath,
  buildTreeWithNumbers,
  type Numberable,
} from '@/lib/domain/tree/tree-numbering';

describe('tree-numbering', () => {
  describe('assignnumericPaths', () => {
    it('assigns numbers to flat tree structure', () => {
      const nodes: Numberable[] = [
        { id: '1', parentId: null },
        { id: '1.1', parentId: '1' },
        { id: '1.2', parentId: '1' },
        { id: '1.2.1', parentId: '1.2' },
        { id: '1.2.2', parentId: '1.2' },
        { id: '2', parentId: null },
        { id: '2.1', parentId: '2' },
      ];

      const result = assignnumericPaths(nodes);

      expect(result).toHaveLength(7);
      
      // Root 1
      expect(result.find(r => r.id === '1')).toMatchObject({
        numericPath: '1',
        displayOrder: 0,
      });

      // Children of 1
      expect(result.find(r => r.id === '1.1')).toMatchObject({
        numericPath: '1.1',
        displayOrder: 1,
      });
      
      expect(result.find(r => r.id === '1.2')).toMatchObject({
        numericPath: '1.2',
        displayOrder: 2,
      });

      // Grandchildren of 1
      expect(result.find(r => r.id === '1.2.1')).toMatchObject({
        numericPath: '1.2.1',
        displayOrder: 3,
      });
      
      expect(result.find(r => r.id === '1.2.2')).toMatchObject({
        numericPath: '1.2.2',
        displayOrder: 4,
      });

      // Root 2
      expect(result.find(r => r.id === '2')).toMatchObject({
        numericPath: '2',
        displayOrder: 5,
      });

      // Child of 2
      expect(result.find(r => r.id === '2.1')).toMatchObject({
        numericPath: '2.1',
        displayOrder: 6,
      });
    });

    it('handles empty array', () => {
      expect(assignnumericPaths([])).toEqual([]);
    });

    it('handles single root', () => {
      const nodes: Numberable[] = [{ id: 'root', parentId: null }];
      const result = assignnumericPaths(nodes);

      expect(result).toEqual([
        { id: 'root', numericPath: '1', displayOrder: 0 },
      ]);
    });

    it('respects orderIndex when present', () => {
      const nodes = [
        { id: '1', parentId: null, orderIndex: 1 },
        { id: '2', parentId: null, orderIndex: 0 }, // Should come first
        { id: '3', parentId: null, orderIndex: 2 },
      ] as (Numberable & { orderIndex: number })[];

      const result = assignnumericPaths(nodes);

      expect(result[0]).toMatchObject({ id: '2', numericPath: '1' });
      expect(result[1]).toMatchObject({ id: '1', numericPath: '2' });
      expect(result[2]).toMatchObject({ id: '3', numericPath: '3' });
    });

    it('assigns displayOrder in DFS pre-order', () => {
      const nodes: Numberable[] = [
        { id: 'A', parentId: null },
        { id: 'A1', parentId: 'A' },
        { id: 'A1a', parentId: 'A1' },
        { id: 'A2', parentId: 'A' },
        { id: 'B', parentId: null },
      ];

      const result = assignnumericPaths(nodes);

      // DFS pre-order: A -> A1 -> A1a -> A2 -> B
      expect(result.map(r => r.id)).toEqual(['A', 'A1', 'A1a', 'A2', 'B']);
      expect(result.map(r => r.displayOrder)).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe('comparenumericPaths', () => {
    it('sorts correctly in natural order', () => {
      const numbers = ['1.10', '1.2', '2', '1', '1.1', '1.2.1'];
      const sorted = numbers.sort(comparenumericPaths);

      expect(sorted).toEqual(['1', '1.1', '1.2', '1.2.1', '1.10', '2']);
    });

    it('handles nulls and undefined', () => {
      expect(comparenumericPaths(null, null)).toBe(0);
      expect(comparenumericPaths(undefined, undefined)).toBe(0);
      expect(comparenumericPaths('1', null)).toBeLessThan(0);
      expect(comparenumericPaths(null, '1')).toBeGreaterThan(0);
    });

    it('handles deep hierarchies', () => {
      expect(comparenumericPaths('1.2.3.4', '1.2.3.5')).toBeLessThan(0);
      expect(comparenumericPaths('1.2.3', '1.2.3.1')).toBeLessThan(0);
    });
  });

  describe('sortBynumericPath', () => {
    it('sorts array of objects by numericPath', () => {
      const items = [
        { id: 'd', numericPath: '1.10' },
        { id: 'b', numericPath: '1.2' },
        { id: 'c', numericPath: '2' },
        { id: 'a', numericPath: '1' },
      ];

      const sorted = sortBynumericPath(items);

      expect(sorted.map(i => i.id)).toEqual(['a', 'b', 'd', 'c']);
    });

    it('does not mutate original array', () => {
      const items = [
        { id: 'b', numericPath: '2' },
        { id: 'a', numericPath: '1' },
      ];

      const sorted = sortBynumericPath(items);

      expect(items[0].id).toBe('b'); // Original unchanged
      expect(sorted[0].id).toBe('a'); // Sorted copy
    });
  });

  describe('buildTreeWithNumbers', () => {
    it('builds tree structure with hierarchical numbers', () => {
      const nodes: Numberable[] = [
        { id: 'root1', parentId: null },
        { id: 'child1', parentId: 'root1' },
        { id: 'child2', parentId: 'root1' },
        { id: 'grandchild1', parentId: 'child1' },
        { id: 'root2', parentId: null },
      ];

      const { tree, numbering } = buildTreeWithNumbers(nodes);

      expect(tree).toHaveLength(2); // 2 roots
      expect(tree[0].id).toBe('root1');
      expect(tree[0].numericPath).toBe('1');
      expect(tree[0].children).toHaveLength(2);
      
      expect(tree[0].children[0].numericPath).toBe('1.1');
      expect(tree[0].children[1].numericPath).toBe('1.2');
      
      expect(tree[0].children[0].children[0].numericPath).toBe('1.1.1');

      expect(tree[1].id).toBe('root2');
      expect(tree[1].numericPath).toBe('2');

      expect(numbering).toHaveLength(5);
    });

    it('assigns both numericPath and displayOrder', () => {
      const nodes: Numberable[] = [
        { id: 'A', parentId: null },
        { id: 'A1', parentId: 'A' },
      ];

      const { tree } = buildTreeWithNumbers(nodes);

      expect(tree[0].displayOrder).toBe(0);
      expect(tree[0].children[0].displayOrder).toBe(1);
    });
  });
});
