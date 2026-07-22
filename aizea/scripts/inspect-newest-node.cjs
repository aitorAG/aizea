// Inspect the TopicNode rows to find the one we just created.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

(async () => {
  try {
    const COURSE = "eb18c671-5184-4461-b01e-c0cf800cccb6";
    const nodes = await db.topicNode.findMany({
      where: { courseId: COURSE },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    console.log("5 most recent nodes for course " + COURSE + ":");
    for (const n of nodes) {
      console.log(
        `  ${n.id}  name="${n.name}"  parentId=${n.parentId}  depth=${n.depth}  createdAt=${n.createdAt.toISOString()}`
      );
    }

    // Also: count roots
    const roots = await db.topicNode.findMany({
      where: { courseId: COURSE, parentId: null },
      orderBy: { createdAt: "desc" },
    });
    console.log("\nAll roots (parentId=null) for the course:");
    for (const r of roots) {
      console.log(
        `  ${r.id}  name="${r.name}"  depth=${r.depth}  createdAt=${r.createdAt.toISOString()}`
      );
    }
  } catch (e) {
    console.error(e);
  } finally {
    await db.$disconnect();
  }
})();
