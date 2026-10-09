-- AlterTable
ALTER TABLE "Course" ADD COLUMN "generationInstructions" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProcessingJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 100,
    "currentStep" TEXT,
    "error" TEXT,
    "courseId" TEXT,
    "materialId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProcessingJob_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProcessingJob" ("courseId", "createdAt", "currentStep", "error", "id", "materialId", "progress", "status", "total", "type", "updatedAt") SELECT "courseId", "createdAt", "currentStep", "error", "id", "materialId", "progress", "status", "total", "type", "updatedAt" FROM "ProcessingJob";
DROP TABLE "ProcessingJob";
ALTER TABLE "new_ProcessingJob" RENAME TO "ProcessingJob";
CREATE INDEX "ProcessingJob_type_status_idx" ON "ProcessingJob"("type", "status");
CREATE INDEX "ProcessingJob_courseId_createdAt_idx" ON "ProcessingJob"("courseId", "createdAt");
CREATE INDEX "ProcessingJob_status_updatedAt_idx" ON "ProcessingJob"("status", "updatedAt");
CREATE TABLE "new_Slide" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "hierarchicalNumber" TEXT,
    "displayOrder" INTEGER,
    "figureRefs" TEXT NOT NULL DEFAULT '[]',
    "htmlDesign" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'concept',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "parentSlideId" TEXT,
    "sourceNodeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Slide_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Slide_parentSlideId_fkey" FOREIGN KEY ("parentSlideId") REFERENCES "Slide" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Slide" ("courseId", "createdAt", "description", "figureRefs", "htmlDesign", "id", "kind", "order", "status", "title", "updatedAt") SELECT "courseId", "createdAt", "description", "figureRefs", "htmlDesign", "id", "kind", "order", "status", "title", "updatedAt" FROM "Slide";
DROP TABLE "Slide";
ALTER TABLE "new_Slide" RENAME TO "Slide";
CREATE INDEX "Slide_courseId_order_idx" ON "Slide"("courseId", "order");
CREATE INDEX "Slide_courseId_displayOrder_idx" ON "Slide"("courseId", "displayOrder");
CREATE INDEX "Slide_courseId_status_idx" ON "Slide"("courseId", "status");
CREATE INDEX "Slide_courseId_parentSlideId_idx" ON "Slide"("courseId", "parentSlideId");
CREATE INDEX "Slide_sourceNodeId_idx" ON "Slide"("sourceNodeId");
CREATE TABLE "new_TopicNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "hierarchicalNumber" TEXT,
    "displayOrder" INTEGER,
    "sourceMaterialIds" TEXT NOT NULL DEFAULT '[]',
    "isLeaf" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceMaterialId" TEXT,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TopicNode_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TopicNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TopicNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TopicNode" ("courseId", "createdAt", "depth", "id", "isLeaf", "name", "orderIndex", "pageEnd", "pageStart", "parentId", "sourceMaterialId", "summary", "updatedAt", "version") SELECT "courseId", "createdAt", "depth", "id", "isLeaf", "name", "orderIndex", "pageEnd", "pageStart", "parentId", "sourceMaterialId", "summary", "updatedAt", "version" FROM "TopicNode";
DROP TABLE "TopicNode";
ALTER TABLE "new_TopicNode" RENAME TO "TopicNode";
CREATE INDEX "TopicNode_courseId_parentId_idx" ON "TopicNode"("courseId", "parentId");
CREATE INDEX "TopicNode_courseId_version_idx" ON "TopicNode"("courseId", "version");
CREATE INDEX "TopicNode_courseId_isLeaf_idx" ON "TopicNode"("courseId", "isLeaf");
CREATE INDEX "TopicNode_courseId_displayOrder_idx" ON "TopicNode"("courseId", "displayOrder");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
