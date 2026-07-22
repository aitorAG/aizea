const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const allCourses = await db.course.findMany({
    select: {
      id: true,
      name: true,
      _count: { select: { slides: true, topicNodes: true } },
    },
  });
  console.log('All courses:');
  allCourses.forEach((cc) => console.log(`  ${cc.name}: ${cc._count.slides} slides, ${cc._count.topicNodes} nodes`));
  // Pick a course with both slides and nodes
  const c = allCourses.find((cc) => cc.name === 'v1.5 #3.2 Fullscreen Tree');
  if (!c) {
    console.log('No test course found');
    await db.$disconnect();
    return;
  }
  console.log('Using course:', c);
  const slides = await db.slide.findMany({
    where: { courseId: c.id },
    select: { id: true, title: true, parentSlideId: true, sourceNodeId: true, order: true },
    orderBy: { order: 'asc' },
  });
  console.log('Slides count:', slides.length);
  console.log('First 5 slides:', slides.slice(0, 5));
  const nodes = await db.topicNode.findMany({
    where: { courseId: c.id },
    select: { id: true, name: true, parentId: true, depth: true },
  });
  console.log('Nodes count:', nodes.length);
  console.log('First 5 nodes:', nodes.slice(0, 5));
  // Check name overlap
  const slideTitles = new Set(slides.map((s) => s.title));
  const nodeNames = new Set(nodes.map((n) => n.name));
  const intersection = [...slideTitles].filter((t) => nodeNames.has(t));
  console.log('Title-name matches:', intersection.length, 'sample:', intersection.slice(0, 5));
  await db.$disconnect();
})();
