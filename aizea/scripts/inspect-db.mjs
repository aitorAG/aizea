// @ts-check
//
// Quick DB inspection: dump courses, materials, semantic units, and
// the on-disk status of every material's file. The point of this
// script is to make the *current* runtime state observable in a few
// seconds so we can pinpoint why "Generar árbol" says sin contenido.

import { PrismaClient } from "@prisma/client";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const db = new PrismaClient();
const UPLOADS_DIR = join(process.cwd(), "public", "uploads");

async function main() {
  const courses = await db.course.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    include: {
      _count: { select: { materials: true, topicNodes: true, slides: true } },
    },
  });

  console.log(`\n=== COURSES (${courses.length}) ===`);
  for (const c of courses) {
    console.log(
      `  ${c.id}  "${c.name}"  materials=${c._count.materials}  nodes=${c._count.topicNodes}  slides=${c._count.slides}`
    );
  }

  const materials = await db.material.findMany({
    orderBy: { createdAt: "desc" },
    take: 12,
    include: {
      course: { select: { id: true, name: true } },
      _count: { select: { semanticUnits: true, chunks: true } },
    },
  });

  console.log(`\n=== MATERIALS (${materials.length}, latest first) ===`);
  for (const m of materials) {
    const onDisk = existsSync(join(UPLOADS_DIR, m.filename));
    const size = onDisk ? statSync(join(UPLOADS_DIR, m.filename)).size : -1;
    console.log(
      `  ${m.id}  course=${m.courseId.slice(0, 8)}  file="${m.filename}"  pageCount=${m.pageCount}  fileSize=${m.fileSize}B  units=${m._count.semanticUnits}  chunks=${m._count.chunks}  onDisk=${onDisk} (${size}B)`
    );
  }

  // Pick the most recent course with materials and dump everything
  // for it.
  const recentCourse = courses.find((c) => c._count.materials > 0);
  if (recentCourse) {
    const courseMaterials = await db.material.findMany({
      where: { courseId: recentCourse.id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { semanticUnits: true } } },
    });
    const units = await db.semanticUnit.findMany({
      where: { material: { courseId: recentCourse.id } },
      orderBy: [{ materialId: "asc" }, { order: "asc" }],
      take: 8,
    });
    const nodes = await db.topicNode.findMany({
      where: { courseId: recentCourse.id },
      orderBy: { depth: "asc" },
      take: 8,
    });
    const jobs = await db.processingJob.findMany({
      where: { courseId: recentCourse.id },
      orderBy: { createdAt: "asc" },
      take: 12,
    });

    console.log(`\n=== COURSE INSPECT: ${recentCourse.id}  "${recentCourse.name}" ===`);
    console.log(`  materials: ${courseMaterials.length}`);
    for (const m of courseMaterials) {
      const onDisk = existsSync(join(UPLOADS_DIR, m.filename));
      const size = onDisk ? statSync(join(UPLOADS_DIR, m.filename)).size : -1;
      console.log(
        `    ${m.id}  "${m.filename}"  pageCount=${m.pageCount}  units=${m._count.semanticUnits}  onDisk=${onDisk} (${size}B)`
      );
    }
    console.log(`  semantic units (first 8 of total): ${units.length}`);
    for (const u of units) {
      console.log(
        `    unit=${u.id.slice(0, 8)}  material=${u.materialId.slice(0, 8)}  order=${u.order}  page=${u.pageStart}-${u.pageEnd}  content="${u.content.slice(0, 60).replace(/\n/g, "\\n")}..."`
      );
    }
    console.log(`  topic nodes (first 8 of ${nodes.length}):`);
    for (const n of nodes) {
      console.log(
        `    node=${n.id.slice(0, 8)}  depth=${n.depth}  name="${n.name}"  isLeaf=${n.isLeaf}`
      );
    }
    console.log(`  processing jobs: ${jobs.length}`);
    for (const j of jobs) {
      console.log(
        `    ${j.id}  type=${j.type}  status=${j.status}  progress=${j.progress}%  currentStep="${j.currentStep}"  err=${j.error ?? "-"}`
      );
    }
  }

  await db.$disconnect();
}

main().catch((err) => {
  console.error("inspect-db failed:", err);
  process.exit(1);
});
