import { describe, it, expect, vi } from "vitest";
import { ApiClient } from "@/lib/client/api-client";

// Unit test for the Fase 4 typed API client. Uses an injected fetch stub and a
// controllable clock so cache TTL / dedup / invalidation are deterministic.

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("ApiClient (Fase 4 data layer)", () => {
  it("listCourses returns typed data on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, courses: [{ id: "c-1", name: "T", slideCount: 0, materialCount: 1, updatedAt: "x" }] })
    );
    const client = new ApiClient({ fetchImpl });
    const res = await client.listCourses();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data[0].id).toBe("c-1");
  });

  it("serves a second GET from cache within the TTL (no second fetch)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true, courses: [] }));
    let clock = 1000;
    const client = new ApiClient({ fetchImpl, cacheTtlMs: 5000, now: () => clock });

    await client.listCourses();
    await client.listCourses();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // After the TTL expires, a new fetch is made.
    clock += 6000;
    await client.listCourses();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent identical GETs into one request", async () => {
    let resolve: (r: Response) => void = () => {};
    const fetchImpl = vi.fn().mockImplementation(
      () => new Promise<Response>((r) => { resolve = r; })
    );
    const client = new ApiClient({ fetchImpl });

    const p1 = client.listCourses();
    const p2 = client.listCourses();
    resolve(jsonResponse({ ok: true, courses: [] }));
    await Promise.all([p1, p2]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("createCourse invalidates the course list cache", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, courses: [] }))       // list #1
      .mockResolvedValueOnce(jsonResponse({ ok: true, id: "c-new" }, 201))  // create
      .mockResolvedValueOnce(jsonResponse({ ok: true, courses: [{ id: "c-new" }] })); // list #2
    const client = new ApiClient({ fetchImpl, cacheTtlMs: 60000 });

    await client.listCourses();
    await client.createCourse("Nuevo");
    await client.listCourses(); // must re-fetch (cache invalidated)

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("maps an HTTP error body to ok:false with status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ ok: false, error: "Curso no encontrado" }, 404)
    );
    const client = new ApiClient({ fetchImpl });
    const res = await client.getCourse("ghost");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(404);
      expect(res.error).toMatch(/no encontrado/i);
    }
  });

  it("maps a network throw to ok:false status 0", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new ApiClient({ fetchImpl });
    const res = await client.listCourses();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(0);
  });

  it("getJobStatus bypasses the cache (always fetches)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ id: "j-1", phase: "extraction", status: "running", progress: 50, total: 100, currentStep: null, error: null, courseId: "c-1", materialId: null })
    );
    const client = new ApiClient({ fetchImpl, cacheTtlMs: 60000 });
    await client.getJobStatus("j-1");
    await client.getJobStatus("j-1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("startRun posts the courseId and returns the enqueue result", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, empty: false, enqueued: true, runId: "run-1" })
    );
    const client = new ApiClient({ fetchImpl });
    const res = await client.startRun("c-1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.enqueued).toBe(true);
      expect(res.data.runId).toBe("run-1");
    }
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ courseId: "c-1" });
  });
});
