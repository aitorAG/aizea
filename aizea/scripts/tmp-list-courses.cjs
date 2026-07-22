// @ts-check
// Helper: print the most recently created courses with their TopicNode
// counts so the Playwright script can pick a 0-nodes course to test
// the auto-refresh against.

const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

(async () => {
  const courses = await db.course.findMany({
    include: {
      _count: { select: { topicNodes: true, materials: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const zeroNode = courses.filter((c) => c._count.topicNodes === 0);
  console.log("All zero-node courses:");
  for (const c of zeroNode) {
    console.log(`  ${c.id}  name=${c.name}  materials=${c._count.materials}`);
  }
  await db.$disconnect();
})();
