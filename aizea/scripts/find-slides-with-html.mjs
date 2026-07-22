import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const s = await p.slide.findMany({
  where: { htmlDesign: { not: null } },
  select: { id: true, courseId: true, title: true, htmlDesign: true },
  take: 5,
});
s.forEach((x) =>
  console.log(x.courseId, x.id, `"${x.title}"`, `htmllen=${x.htmlDesign?.length || 0}`)
);
await p.$disconnect();
