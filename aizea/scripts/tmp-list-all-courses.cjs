const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const courses = await db.course.findMany({
    include: { slides: { orderBy: { order: 'asc' }, select: { id: true, title: true, order: true, parentSlideId: true } } }
  });
  for (const c of courses) {
    console.log('Course:', c.name, 'slides:', c.slides.length);
    for (const s of c.slides) console.log(' ', s.order + 1, s.title, 'parent:', s.parentSlideId || '(root)');
  }
  await db.$disconnect();
})();
