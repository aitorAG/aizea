const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const jobs = await p.processingJob.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 5,
    select: { id: true, status: true, type: true, updatedAt: true, courseId: true },
  });
  console.log(JSON.stringify(jobs, null, 2));
  await p.$disconnect();
})();
