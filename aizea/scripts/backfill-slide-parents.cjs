// One-off backfill: for every course, match its slides to TopicNodes
// by title and populate parentSlideId (and sourceNodeId) based on the
// source node's parent in the conceptual tree. Safe to re-run.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

(async () => {
  const courses = await db.course.findMany({
    select: { id: true, name: true, _count: { select: { slides: true, topicNodes: true } } },
  });

  let totalUpdated = 0;
  for (const c of courses) {
    if (c._count.slides === 0) continue;
    const nodes = await db.topicNode.findMany({
      where: { courseId: c.id },
      select: { id: true, name: true, parentId: true, depth: true },
    });
    if (nodes.length === 0) continue;
    const nodeByName = new Map();
    for (const n of nodes) {
      if (!nodeByName.has(n.name)) nodeByName.set(n.name, n);
    }
    const slides = await db.slide.findMany({
      where: { courseId: c.id },
      select: { id: true, title: true, parentSlideId: true, sourceNodeId: true, order: true },
      orderBy: { order: 'asc' },
    });

    // Build nodeId -> slideId map. If a node name appears multiple times
    // among slides (or vice versa), map them by order to keep consistency.
    const matchedNodeIds = new Set();
    const matchedSlideIds = new Set();
    const nodeIdToSlideId = new Map();

    // First pass: greedy name match in order
    for (const slide of slides) {
      const node = nodeByName.get(slide.title);
      if (node && !matchedNodeIds.has(node.id)) {
        nodeIdToSlideId.set(node.id, slide.id);
        matchedNodeIds.add(node.id);
        matchedSlideIds.add(slide.id);
      }
    }

    // Second pass: parent update
    let updated = 0;
    for (const node of nodes) {
      const slideId = nodeIdToSlideId.get(node.id);
      if (!slideId) continue;
      const parentSlideId = node.parentId ? nodeIdToSlideId.get(node.parentId) ?? null : null;
      await db.slide.update({
        where: { id: slideId },
        data: { parentSlideId, sourceNodeId: node.id },
      });
      updated += 1;
    }
    totalUpdated += updated;
    console.log(
      `Course "${c.name}" (${c.id.slice(0, 8)}): matched ${nodeIdToSlideId.size}/${slides.length} slides, updated ${updated}`
    );
  }
  console.log(`\nTotal slides updated: ${totalUpdated}`);
  await db.$disconnect();
})();
