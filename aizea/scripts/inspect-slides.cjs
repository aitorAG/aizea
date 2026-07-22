const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const courses = await db.course.findMany({ select: { id: true, name: true } });
  console.log('Courses:', JSON.stringify(courses, null, 2));
  for (const c of courses) {
    const slides = await db.slide.findMany({
      where: { courseId: c.id },
      select: { id: true, title: true, order: true },
      orderBy: { order: 'asc' },
    });
    const nodes = await db.topicNode.findMany({
      where: { courseId: c.id },
      select: { id: true, name: true, parentId: true, depth: true },
      orderBy: [{ depth: 'asc' }, { name: 'asc' }],
    });
    console.log(`\nCourse "${c.name}" (${c.id}): ${slides.length} slides, ${nodes.length} nodes`);
    console.log('  Slides:', slides.map((s) => s.title).join(' | '));
    console.log('  Nodes depth distribution:');
    const byDepth = {};
    for (const n of nodes) {
      byDepth[n.depth] = (byDepth[n.depth] || 0) + 1;
    }
    console.log('   ', byDepth);
  }
  await db.$disconnect();
})();
