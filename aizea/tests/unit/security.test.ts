import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "lib");
const SK_OR_PATTERN = /sk-or-v1-[a-f0-9]{8,}/i;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

describe("security", () => {
  test("no hardcoded OpenRouter API keys in lib/", () => {
    const files = walk(ROOT);
    const offenders: { file: string; line: number; text: string }[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (SK_OR_PATTERN.test(lines[i])) {
          offenders.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
