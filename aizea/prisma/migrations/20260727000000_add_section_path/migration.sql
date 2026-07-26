-- PR2 — add SemanticUnit.sectionPath (JSON breadcrumb of heading titles).
-- Nullable-with-default so existing rows and text-only fallback stay valid.
ALTER TABLE "SemanticUnit" ADD COLUMN "sectionPath" TEXT NOT NULL DEFAULT '[]';
