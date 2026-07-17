// @ts-check
//
// Verify the segmenter fix by calling it directly on a real buffer.
// This bypasses the dev server / Prisma stack to isolate the
// segmenter behavior.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { SegmenterService } from "../lib/domain/pipeline/SegmenterService.ts";

const db = new PrismaClient();
const UPLOADS_DIR = join(process.cwd(), "public", "uploads");

async function main() {
  const materialId = process.argv[2];
  if (!materialId) {
    console.error("usage: node scripts/inspect-segmenter-fix.mjs <materialId>");
    process.exit(1);
  }
  const material = await db.material.findUnique({ where: { id: materialId } });
  if (!material) {
    console.error(`material ${materialId} not found`);
    process.exit(1);
  }
  const buffer = readFileSync(join(UPLOADS_DIR, material.filename));
  console.log(`material=${material.id}  filename="${material.filename}"  buffer=${buffer.length}B`);

  // Use a stub db so the segmenter doesn't try to create rows (we
  // already have the material, we just want to see how many units
  // it WOULD create).
  const stubDb = {
    semanticUnit: {
      create: async ({ data }) => ({
        id: `stub-${Date.now()}-${Math.random()}`,
        materialId: data.materialId,
        content: data.content,
        order: data.order,
        pageStart: data.pageStart,
        pageEnd: data.pageEnd,
        sectionRef: data.sectionRef,
        createdAt: new Date(),
      }),
    },
  };
  // @ts-ignore
  globalThis.db = stubDb;
  // Override the @/lib/db import
  const mod = await import("../lib/db.ts");
  // @ts-ignore
  mod.db = stubDb;

  const segmenter = new SegmenterService();
  console.log("calling segmenter.segment()...");
  const units = await segmenter.segment(buffer, material.id);
  console.log(`  segmenter returned ${units.length} SemanticUnit(s)`);
  for (const u of units.slice(0, 5)) {
    console.log(
      `    order=${u.order}  page=${u.pageStart}-${u.pageEnd}  content="${u.content.slice(0, 80).replace(/\n/g, "\\n")}..."`
    );
  }

  await db.$disconnect();
}

main().catch((err) => {
  console.error("inspect-segmenter-fix failed:", err);
  process.exit(1);
});
