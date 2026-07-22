// Standalone script: dump every Slide row to a JSON file so the
// Playwright runner can pick a real slide id without needing
// sqlite3 on the host.
//
// Runs as plain JavaScript (no tsx needed) via ts-node? No, the
// project has neither tsx nor ts-node installed. So we use a
// transpiled .mjs script: Next.js ships with @swc/core, so we can
// transpile manually. Simpler: write the same script in plain JS.
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient();

async function main() {
  const slides = await prisma.slide.findMany({
    select: { id: true, courseId: true, title: true, order: true },
    orderBy: { order: "asc" },
  });
  const courses = await prisma.course.findMany({
    select: {
      id: true,
      name: true,
      _count: { select: { slides: true, materials: true } },
    },
  });
  const out = {
    courses: courses.map((c) => ({
      id: c.id,
      name: c.name,
      slideCount: c._count.slides,
      materialCount: c._count.materials,
    })),
    slides,
  };
  const outPath = process.argv[2] ?? "scripts/.course-snapshot.json";
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  for (const s of slides) {
    console.log(`${s.courseId} ${s.id} "${s.title}"`);
  }
  console.error(`Wrote ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
