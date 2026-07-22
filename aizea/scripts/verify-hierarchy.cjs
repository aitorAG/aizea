const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const course = await db.course.findFirst({ where: { name: 'v1.5 #4.1 Slide Hierarchy Demo' } });
  if (!course) { console.log('No demo course'); return; }
  const slides = await db.slide.findMany({
    where: { courseId: course.id },
    orderBy: { order: 'asc' },
    select: { id: true, title: true, order: true, parentSlideId: true, sourceNodeId: true },
  });
  console.log(`Course: ${course.name} (${course.id})`);
  console.log(`Slides: ${slides.length}\n`);

  const byId = new Map(slides.map((s) => [s.id, s]));
  function findRoot(id) {
    let cur = byId.get(id);
    while (cur && cur.parentSlideId) cur = byId.get(cur.parentSlideId);
    return cur;
  }
  // Render as tree
  const childrenOf = new Map();
  for (const s of slides) {
    const key = s.parentSlideId ?? '__root__';
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(s);
  }
  function render(parentId, depth) {
    const list = childrenOf.get(parentId) ?? [];
    for (const s of list) {
      console.log(`${'  '.repeat(depth)}${s.order + 1}. ${s.title} [${s.parentSlideId ? 'child' : 'root'}]`);
      render(s.id, depth + 1);
    }
  }
  render('__root__', 0);
  await db.$disconnect();
})();
