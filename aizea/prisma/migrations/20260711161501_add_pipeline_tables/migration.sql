-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "llmContext" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "fileSize" INTEGER,
    "fileType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Material_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Slide" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "figureRefs" TEXT NOT NULL DEFAULT '[]',
    "htmlDesign" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Slide_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SlideBox" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slideId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    CONSTRAINT "SlideBox_slideId_fkey" FOREIGN KEY ("slideId") REFERENCES "Slide" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TextChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "materialId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" TEXT,
    "tokenCount" INTEGER NOT NULL,
    CONSTRAINT "TextChunk_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Figure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "caption" TEXT,
    "pageNum" INTEGER,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Figure_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SemanticUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "materialId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "sectionRef" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SemanticUnit_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UnitRepresentation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "unitId" TEXT NOT NULL,
    "concepts" TEXT NOT NULL DEFAULT '[]',
    "mainIdeas" TEXT NOT NULL DEFAULT '[]',
    "formulas" TEXT NOT NULL DEFAULT '[]',
    "figures" TEXT NOT NULL DEFAULT '[]',
    "prerequisites" TEXT NOT NULL DEFAULT '[]',
    "introduces" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UnitRepresentation_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "SemanticUnit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TopicNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "isLeaf" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceMaterialId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TopicNode_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TopicNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TopicNode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "openrouterApiKey" TEXT,
    "chatModel" TEXT NOT NULL DEFAULT 'deepseek/deepseek-chat',
    "embedModel" TEXT NOT NULL DEFAULT 'openai/text-embedding-3-small',
    "doclingBaseUrl" TEXT NOT NULL DEFAULT 'http://127.0.0.1:5001',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProcessingJob" (
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Material_courseId_createdAt_idx" ON "Material"("courseId", "createdAt");

-- CreateIndex
CREATE INDEX "Slide_courseId_order_idx" ON "Slide"("courseId", "order");

-- CreateIndex
CREATE INDEX "Slide_courseId_status_idx" ON "Slide"("courseId", "status");

-- CreateIndex
CREATE INDEX "SlideBox_slideId_type_idx" ON "SlideBox"("slideId", "type");

-- CreateIndex
CREATE INDEX "TextChunk_materialId_chunkIndex_idx" ON "TextChunk"("materialId", "chunkIndex");

-- CreateIndex
CREATE INDEX "Figure_courseId_createdAt_idx" ON "Figure"("courseId", "createdAt");

-- CreateIndex
CREATE INDEX "SemanticUnit_materialId_order_idx" ON "SemanticUnit"("materialId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "UnitRepresentation_unitId_key" ON "UnitRepresentation"("unitId");

-- CreateIndex
CREATE INDEX "TopicNode_courseId_parentId_idx" ON "TopicNode"("courseId", "parentId");

-- CreateIndex
CREATE INDEX "TopicNode_courseId_version_idx" ON "TopicNode"("courseId", "version");

-- CreateIndex
CREATE INDEX "ProcessingJob_type_status_idx" ON "ProcessingJob"("type", "status");

-- CreateIndex
CREATE INDEX "ProcessingJob_courseId_createdAt_idx" ON "ProcessingJob"("courseId", "createdAt");
