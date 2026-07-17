import { describe, it, expect } from "vitest";
import { POST } from "@/app/api/upload/route";
import { NextRequest } from "next/server";

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
});
