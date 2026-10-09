// job-labels — single source of truth for the user-facing name and
// icon of every ProcessingJob.type the app emits.
//
// Both the global pipeline banner and the v1.11 jobs panel need to
// surface jobs in a way the user can understand. The banner's PHASES
// table is hard-coded to the four pipeline phases (segmentation /
// extraction / integration / tree-building), but the panel also
// needs to recognise the per-material jobs the orchestrator creates
// (material upload / per-slide generation). This module owns the
// mapping so every consumer agrees on the wording and the icon.
//
// Job-type vocabulary (matches what the pipeline writes to
// ProcessingJob.type):
//   - "segmentation"     → dividing the document into semantic units
//   - "extraction"       → pulling concepts/figures/formulas per unit
//   - "integration"      → clustering units into topic groups
//   - "tree-building"    → building the hierarchical topic tree
//   - "material-upload"  → uploading a single PDF material
//   - "slide-generation" → generating one or more slides (batch)
//   - "slide-content"    → generating the content of a single slide
//   - "slide-html"       → rendering a single slide's HTML
//   - "ppt-export"       → exporting an editable PowerPoint presentation
//   - "merge"            → merging two trees (rare, admin-only)
//
// Anything unknown falls through to a "Trabajo en curso" placeholder
// so a future job type never crashes the panel.

import {
  Sparkles,
  Upload,
  FileText,
  Presentation,
  GitMerge,
  CircleDashed,
  type LucideIcon,
} from "lucide-react";
import { DEFAULT_LOCALE, dictionaries, type Locale, type TranslationKey } from "@/lib/i18n";

export interface JobTypeMeta {
  /** Short human label, e.g. "Generación de árbol". */
  label: TranslationKey;
  /** Lucide icon for the job type. Stable across renders. */
  icon: LucideIcon;
  /** True for the four "phase" jobs of a pipeline run — these are
   *  grouped under the same `runId` and render as a single row in
   *  the global banner. The panel still shows each one as its own
   *  row because the user wants to see which phase is running. */
  isPipelinePhase: boolean;
}

const TABLE: Record<string, JobTypeMeta> = {
  segmentation: {
    label: "jobSegmentation",
    icon: CircleDashed,
    isPipelinePhase: true,
  },
  extraction: {
    label: "jobExtraction",
    icon: FileText,
    isPipelinePhase: true,
  },
  integration: {
    label: "jobIntegration",
    icon: Sparkles,
    isPipelinePhase: true,
  },
  "tree-building": {
    label: "jobTreeBuilding",
    icon: GitMerge,
    isPipelinePhase: true,
  },
  merge: {
    label: "jobMerge",
    icon: GitMerge,
    isPipelinePhase: false,
  },
  "material-upload": {
    label: "jobMaterialUpload",
    icon: Upload,
    isPipelinePhase: false,
  },
  "slide-generation": {
    label: "jobSlideGeneration",
    icon: Presentation,
    isPipelinePhase: false,
  },
  "slide-content": {
    label: "jobSlideContent",
    icon: FileText,
    isPipelinePhase: false,
  },
  "slide-html": {
    label: "jobSlideHtml",
    icon: Presentation,
    isPipelinePhase: false,
  },
  "ppt-export": {
    label: "jobPptExport",
    icon: Presentation,
    isPipelinePhase: false,
  },
};

const FALLBACK: JobTypeMeta = {
  label: "jobUnknown",
  icon: CircleDashed,
  isPipelinePhase: false,
};

/** Resolve the user-facing label and icon for a job type. Falls
 *  back to a generic "Trabajo en curso" for unknown types so a
 *  future job type never crashes the panel. */
export function getJobTypeMeta(type: string | null | undefined): JobTypeMeta {
  if (!type) return FALLBACK;
  return TABLE[type] ?? FALLBACK;
}

/** Convenience accessor used in places that only need the label. */
export function getJobTypeLabel(
  type: string | null | undefined,
  locale: Locale = DEFAULT_LOCALE
): string {
  const key = getJobTypeMeta(type).label;
  return dictionaries[locale][key] ?? dictionaries[DEFAULT_LOCALE][key];
}

/** Convenience accessor used in places that only need the icon. */
export function getJobTypeIcon(type: string | null | undefined): LucideIcon {
  return getJobTypeMeta(type).icon;
}
