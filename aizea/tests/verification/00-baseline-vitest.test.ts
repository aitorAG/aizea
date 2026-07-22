// @ts-check
//
// 00-baseline-vitest.test.ts — HISTORICAL "before" measurement.
//
// This test captured the upload time BEFORE the v1.5 finding 1.7
// decoupling fix. The use case used to call `pipeline.processCourse()`
// inside the upload, which made the upload take 30+ seconds and
// created multiple ProcessingJob rows.
//
// The test is now SKIPPED because its assertion (`jobs > 0`) is
// no longer true after the fix. The "after" measurement lives in
// `01-after-fix-vitest.test.ts` and asserts:
//   - elapsedMs < 2000
//   - jobs.length === 0
//   - units.length === 0
//   - nodes.length === 0
//
// The original "before" measurement is preserved in
// `.test-artifacts/evidence/upload-decoupling/00-baseline.txt`.

import { describe, it } from "vitest";

describe("Baseline (BEFORE v1.5 finding 1.7 fix) — HISTORICAL, SKIPPED", () => {
  it.skip(
    "historical measurement: upload used to trigger the pipeline (see 01-after-fix for the new behavior)",
    () => {
      // Original implementation removed. See git history for the
      // pre-fix version of this test. The historical evidence is
      // in `.test-artifacts/evidence/upload-decoupling/00-baseline.txt`.
    }
  );
});
