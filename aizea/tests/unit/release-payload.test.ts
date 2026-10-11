import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// CJS helper exports are intentionally plain Node APIs so the MSI script can
// use them without coupling the release pipeline to the application build.
const {
  assertStandalonePayload,
  copyReleasePublicAssets,
  inspectStandalonePayload,
} = require("../../scripts/release-payload.cjs") as {
  assertStandalonePayload: (root: string) => unknown;
  copyReleasePublicAssets: (source: string, destination: string) => string[];
  inspectStandalonePayload: (root: string) => {
    totalBytes: number;
    violations: string[];
  };
};

describe("release payload staging", () => {
  it("copies only immutable public assets and replaces stale output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aizea-release-public-"));
    const source = path.join(root, "public");
    const destination = path.join(root, "standalone", "public");
    try {
      await mkdir(path.join(source, "icons"), { recursive: true });
      await mkdir(path.join(source, "uploads"), { recursive: true });
      await writeFile(path.join(source, "manifest.webmanifest"), "manifest");
      await writeFile(path.join(source, "offline.html"), "offline");
      await writeFile(path.join(source, "sw.js"), "sw");
      await writeFile(path.join(source, "workbox-a1b2c3.js"), "workbox");
      await writeFile(path.join(source, "icons", "icon.png"), "icon");
      await writeFile(path.join(source, "icons", "apple-touch-icon.png"), "apple");
      await writeFile(path.join(source, "icons", "pwa-192x192.png"), "192");
      await writeFile(path.join(source, "icons", "pwa-512x512.png"), "512");
      await writeFile(path.join(source, "uploads", "private.pdf"), "private");
      await mkdir(destination, { recursive: true });
      await writeFile(path.join(destination, "stale.log"), "stale");

      expect(copyReleasePublicAssets(source, destination)).toEqual([
        "manifest.webmanifest",
        "offline.html",
        "sw.js",
        "workbox-a1b2c3.js",
        "icons/",
      ]);
      const report = inspectStandalonePayload(path.join(root, "standalone"));
      expect(report.violations).toEqual([]);
      expect(report.totalBytes).toBe(
        "manifest".length +
          "offline".length +
          "sw".length +
          "workbox".length +
          "icon".length +
          "apple".length +
          "192".length +
          "512".length
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects source maps, test artifacts, and development databases", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aizea-release-payload-"));
    try {
      await mkdir(path.join(root, "test-results"), { recursive: true });
      await writeFile(path.join(root, "server.js"), "server");
      await writeFile(path.join(root, "server.js.map"), "map");
      await writeFile(path.join(root, "test-results", "result.json"), "test");
      await writeFile(path.join(root, "dev.db"), "database");

      expect(() => assertStandalonePayload(root)).toThrow(/Forbidden payload entries/);
      expect(inspectStandalonePayload(root).violations).toEqual([
        "dev.db",
        "server.js.map",
        "test-results/result.json",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
