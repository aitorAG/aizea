"use client";

import { usePathname } from "next/navigation";
import { GlobalPipelineBanner } from "@/components/PipelineProgress/GlobalPipelineBanner";

/**
 * v0.11.0 — Confine the global pipeline progress banner to the Jobs tab.
 *
 * Previously the banner was mounted in the root layout and appeared on every
 * page. Per R5 the Jobs tab is the single source of truth for process
 * visibility, so we only render the banner when the user is on `/jobs`. The
 * banner's own store hydration/logic is unchanged — we only gate its mount.
 */
export function JobsOnlyPipelineBanner() {
  const pathname = usePathname();
  if (pathname !== "/jobs") return null;
  return <GlobalPipelineBanner />;
}
