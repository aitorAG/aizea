// format-time — small, dependency-free helpers used by the pipeline
// progress UI to turn a millisecond duration into a compact, human
// string ("0:45", "1m 23s") and to estimate time-to-completion from
// the current progress percentage.
//
// Conventions:
//   - < 2 minutes  →  "M:SS"   (e.g. "0:45", "1:30")
//   - >= 2 minutes →  "Xm YYs" (e.g. "2m 5s", "60m 0s")
//   - Negative or NaN inputs are clamped to 0 so the UI never shows
//     "-1:00" or "NaN:NaN".
//
// Both helpers are pure — they never touch Date.now() or the DOM, so
// they're trivial to unit-test and to compose.

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;

/**
 * Format a positive millisecond duration as a short human-readable
 * string. See the module header for the format conventions.
 */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const totalSeconds = Math.floor(ms / SECOND_MS);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 2) {
    // Compact M:SS form for the first two minutes. The header is at
    // line 1 so "0:45" stays readable while the job is fresh; the
    // verbose form kicks in once the job is clearly long-running.
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}m ${seconds}s`;
}

/**
 * Estimate the time remaining for a job given how long it has already
 * been running and its current progress percentage. Returns `null`
 * when no estimate is possible yet (e.g. progress is 0 or negative),
 * and `"0:00"` when the job is already at 100 %.
 *
 * Formula: remaining = elapsed * (100 - progress) / progress
 */
export function calculateETA(
  elapsedMs: number,
  progressPercent: number
): string | null {
  if (
    !Number.isFinite(progressPercent) ||
    progressPercent <= 0 ||
    progressPercent > 100
  ) {
    return null;
  }
  if (progressPercent === 100) {
    return "0:00";
  }
  const safeElapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : 0;
  const remainingMs = (safeElapsed * (100 - progressPercent)) / progressPercent;
  return formatElapsed(remainingMs);
}

// Exposed for unit tests — keeps the magic numbers in one place.
export const FORMAT_TIME_CONSTANTS = {
  SECOND_MS,
  MINUTE_MS,
} as const;
