// /jobs — dedicated page that hosts the full Jobs panel outside
// the right-side drawer. The drawer is the primary entry point
// (it's reachable from every page via the nav button), but the
// /jobs page gives the user more room to scan, copy / read row
// data, and run the Stop / Retry / Remove actions without
// covering the underlying page content.
//
// We render the page entirely on the client (`JobsPageClient`)
// because the panel polls every 1.5s and the data is reactive.
// A server wrapper still ships so the page has a stable URL
// that Next can pre-render and link to.

import type { Metadata } from "next";
import { JobsPageClient } from "./jobs-page-client";

export const metadata: Metadata = {
  title: "Trabajos — AIzea",
  description:
    "Estado de los pipelines y trabajos de generación en curso.",
};

// `dynamic = "force-dynamic"` so the page is never statically
// pre-rendered — the panel needs fresh data on every visit.
export const dynamic = "force-dynamic";

export default function JobsPage() {
  return <JobsPageClient />;
}
