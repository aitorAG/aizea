const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.topicNode
  .groupBy({
    by: ["courseId"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 5,
  })
  .then(async (rows) => {
    const out = [];
    for (const r of rows) {
      const c = await p.course.findUnique({
        where: { id: r.courseId },
        select: { name: true },
      });
      out.push({ courseId: r.courseId, courseName: c?.name, nodeCount: r._count.id });
    }
    console.log(JSON.stringify(out, null, 2));
    return p.$disconnect();
  });
