import { describe, it, expect, vi } from "vitest";
import { checkHealth } from "@/lib/application/health";

describe("checkHealth (Fase 3-A readiness)", () => {
  it("reports ok when the DB ping succeeds", async () => {
    const report = await checkHealth({
      pingDb: vi.fn().mockResolvedValue(undefined),
      version: "1.2.3",
    });
    expect(report.status).toBe("ok");
    expect(report.db).toBe(true);
    expect(report.version).toBe("1.2.3");
    expect(typeof report.timestamp).toBe("number");
  });

  it("reports unavailable (without throwing) when the DB ping fails", async () => {
    const report = await checkHealth({
      pingDb: vi.fn().mockRejectedValue(new Error("db locked")),
      version: "1.2.3",
    });
    expect(report.status).toBe("unavailable");
    expect(report.db).toBe(false);
  });

  it("defaults version to 'unknown' when not provided", async () => {
    const report = await checkHealth({
      pingDb: vi.fn().mockResolvedValue(undefined),
    });
    expect(report.version).toBe("unknown");
  });
});
