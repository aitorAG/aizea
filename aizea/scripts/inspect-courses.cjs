// Quick DB inspection: list courses + node counts.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

(async () => {
  try {
    const courses = await db.course.findMany({
      select: {
        id: true,
        name: true,
        _count: { select: { topicNodes: true } },
      },
    });
    console.log('ALL_COURSES:');
    console.log(JSON.stringify(courses, null, 2));
    const noTree = courses.filter((c) => c._count.topicNodes === 0);
    console.log('COURSES_WITH_ZERO_NODES:');
    console.log(JSON.stringify(noTree, null, 2));
  } catch (e) {
    console.error('ERR:', e);
  } finally {
    await db.$disconnect();
  }
})();
