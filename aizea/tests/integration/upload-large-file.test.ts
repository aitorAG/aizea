import { describe, it, expect, vi, afterEach } from "vitest";
import { join } from "node:path";

vi.mock("fs/promises", () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

import { POST } from "@/app/api/upload/route";
import { mkdir, writeFile } from "fs/promises";
import { NextRequest } from "next/server";
import { getUploadsDir } from "@/lib/paths";

afterEach(() => {
  delete process.env.AIZEA_DATA_DIR;
  vi.clearAllMocks();
});

describe("POST /api/upload", () => {
  it("responds with 400 when no file is provided", async () => {
    const formData = new FormData();
    const req = new NextRequest("http://localhost:3000/api/upload", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("No file provided");
  });

  it("writes to the centralized uploads directory", async () => {
    process.env.AIZEA_DATA_DIR = join("C:", "aizea-test-data");
    const formData = new FormData();
    formData.append("file", new File(["%PDF-test"], "document.pdf", {
      type: "application/pdf",
    }));
    const req = new NextRequest("http://localhost:3000/api/upload", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    const uploadsDir = getUploadsDir();
    expect(mkdir).toHaveBeenCalledWith(uploadsDir, { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      join(uploadsDir, json.filename),
      expect.any(Buffer)
    );
    expect(writeFile).not.toHaveBeenCalledWith(
      expect.stringContaining(join(process.cwd(), "public", "uploads")),
      expect.anything()
    );
  });
});
