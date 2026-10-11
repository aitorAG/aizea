import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("upload route security contract", () => {
  it("uses centralized storage and generated filenames", async () => {
    const source = await readFile(
      path.join(process.cwd(), "app/api/upload/route.ts"),
      "utf8"
    );
    expect(source).toContain("getUploadsDir");
    expect(source).toContain("uuidv4");
    expect(source).toContain("MAX_UPLOAD_BYTES");
    expect(source).toContain("instanceof File");
  });

  it("hardens the course material upload endpoint against user filename paths", async () => {
    const source = await readFile(
      path.join(process.cwd(), "app/api/courses/[id]/materials/upload/route.ts"),
      "utf8"
    );
    expect(source).toContain("MAX_UPLOAD_BYTES");
    expect(source).toContain("ALLOWED_EXTENSIONS");
    expect(source).toContain("crypto.randomUUID");
    expect(source).not.toContain("${Date.now()}_${file.name}");
  });
});
