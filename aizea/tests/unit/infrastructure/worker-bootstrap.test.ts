import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  bootstrapWorker,
  bootstrapWorkerOnce,
  __resetBootstrapGuardForTests,
} from "@/lib/infrastructure/queue/worker-bootstrap";

beforeEach(() => {
  __resetBootstrapGuardForTests();
});

describe("bootstrapWorker (Fase 3-B)", () => {
  it("recovers stale runs then kicks the pump", async () => {
    const recover = vi.fn().mockResolvedValue(2);
    const pump = vi.fn().mockResolvedValue(undefined);
    const log = vi.fn();

    await bootstrapWorker({ recover, pump, log });
    // Let the fire-and-forget pump microtask settle.
    await new Promise((r) => setTimeout(r, 0));

    expect(recover).toHaveBeenCalledOnce();
    expect(pump).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/recovered 2 stale/));
  });

  it("does not log recovery when nothing was stale", async () => {
    const log = vi.fn();
    await bootstrapWorker({
      recover: vi.fn().mockResolvedValue(0),
      pump: vi.fn().mockResolvedValue(undefined),
      log,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/recovered/));
  });

  it("never throws when recover fails (startup must not crash)", async () => {
    const log = vi.fn();
    await expect(
      bootstrapWorker({
        recover: vi.fn().mockRejectedValue(new Error("db down")),
        pump: vi.fn().mockResolvedValue(undefined),
        log,
      })
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/bootstrap failed.*db down/));
  });

  it("swallows a rejected pump without crashing", async () => {
    const log = vi.fn();
    await bootstrapWorker({
      recover: vi.fn().mockResolvedValue(0),
      pump: vi.fn().mockRejectedValue(new Error("pump boom")),
      log,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/pump failed.*pump boom/));
  });
});

describe("bootstrapWorkerOnce (Fase 3-B guard)", () => {
  it("runs at most once per process", async () => {
    const recover = vi.fn().mockResolvedValue(0);
    const pump = vi.fn().mockResolvedValue(undefined);

    await bootstrapWorkerOnce({ recover, pump });
    await bootstrapWorkerOnce({ recover, pump });
    await bootstrapWorkerOnce({ recover, pump });

    expect(recover).toHaveBeenCalledOnce();
  });
});
