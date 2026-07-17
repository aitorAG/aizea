-- CreateTable
CREATE TABLE "TopicGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "importance" REAL NOT NULL DEFAULT 0.5,
    "concepts" TEXT NOT NULL DEFAULT '[]',
    "sourceUnitIds" TEXT NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TopicGroup_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TopicGroup_courseId_version_idx" ON "TopicGroup"("courseId", "version");
