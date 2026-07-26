import { describe, it, expect, vi, beforeEach } from "vitest";

// Integration test for the Fase 4-A REST courses bridge. The routes delegate
// to the course server actions; we mock that module so we assert the HTTP
// status mapping + JSON shape without a DB.

const {
  mockGetCourses,
  mockCreateCourse,
  mockGetCourse,
  mockUpdateCourse,
  mockDeleteCourse,
} = vi.hoisted(() => ({
  mockGetCourses: vi.fn(),
  mockCreateCourse: vi.fn(),
  mockGetCourse: vi.fn(),
  mockUpdateCourse: vi.fn(),
  mockDeleteCourse: vi.fn(),
}));

vi.mock("@/lib/actions/course", () => ({
  getCourses: mockGetCourses,
  createCourse: mockCreateCourse,
  getCourse: mockGetCourse,
  updateCourse: mockUpdateCourse,
  deleteCourse: mockDeleteCourse,
}));

let listGet: typeof import("@/app/api/courses/route").GET;
let listPost: typeof import("@/app/api/courses/route").POST;
let detailGet: typeof import("@/app/api/courses/[id]/route").GET;
let detailPatch: typeof import("@/app/api/courses/[id]/route").PATCH;
let detailDelete: typeof import("@/app/api/courses/[id]/route").DELETE;

beforeEach(async () => {
  vi.clearAllMocks();
  listGet = (await import("@/app/api/courses/route")).GET;
  listPost = (await import("@/app/api/courses/route")).POST;
  const detail = await import("@/app/api/courses/[id]/route");
  detailGet = detail.GET;
  detailPatch = detail.PATCH;
  detailDelete = detail.DELETE;
});

function postJson(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
function patchJson(body: unknown): Request {
  return new Request("http://localhost/api/courses/c-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET/POST /api/courses (Fase 4-A)", () => {
  it("GET returns 200 with the course list", async () => {
    mockGetCourses.mockResolvedValue([{ id: "c-1", name: "Test", slideCount: 0, materialCount: 1, updatedAt: "x" }]);
    const res = await listGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.courses).toHaveLength(1);
  });

  it("GET returns 500 when the action throws", async () => {
    mockGetCourses.mockRejectedValue(new Error("db down"));
    const res = await listGet();
    expect(res.status).toBe(500);
  });

  it("POST creates and returns 201 with the id", async () => {
    mockCreateCourse.mockResolvedValue({ id: "c-new" });
    const res = await listPost(postJson("http://localhost/api/courses", { name: "Nuevo" }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, id: "c-new" });
  });

  it("POST returns 400 when name is missing/empty", async () => {
    const res = await listPost(postJson("http://localhost/api/courses", { name: "  " }));
    expect(res.status).toBe(400);
    expect(mockCreateCourse).not.toHaveBeenCalled();
  });

  it("POST returns 400 on invalid JSON", async () => {
    const req = new Request("http://localhost/api/courses", { method: "POST", body: "x{" });
    const res = await listPost(req);
    expect(res.status).toBe(400);
  });
});

describe("GET/PATCH/DELETE /api/courses/[id] (Fase 4-A)", () => {
  it("GET returns 200 with the detail", async () => {
    mockGetCourse.mockResolvedValue({
      course: { id: "c-1", name: "T", createdAt: new Date(), updatedAt: new Date() },
      slides: [], materials: [], figures: [],
    });
    const res = await detailGet(new Request("http://localhost/x"), idParams("c-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.course.id).toBe("c-1");
  });

  it("GET returns 404 when the course is absent", async () => {
    mockGetCourse.mockRejectedValue(new Error("Curso no encontrado"));
    const res = await detailGet(new Request("http://localhost/x"), idParams("ghost"));
    expect(res.status).toBe(404);
  });

  it("PATCH updates name and returns 200", async () => {
    mockUpdateCourse.mockResolvedValue({ id: "c-1", name: "Updated" });
    const res = await detailPatch(patchJson({ name: "Updated" }), idParams("c-1"));
    expect(res.status).toBe(200);
    expect(mockUpdateCourse).toHaveBeenCalledWith("c-1", { name: "Updated" });
  });

  it("PATCH returns 400 when nothing to update", async () => {
    const res = await detailPatch(patchJson({}), idParams("c-1"));
    expect(res.status).toBe(400);
    expect(mockUpdateCourse).not.toHaveBeenCalled();
  });

  it("PATCH returns 400 when name is empty string", async () => {
    const res = await detailPatch(patchJson({ name: "" }), idParams("c-1"));
    expect(res.status).toBe(400);
  });

  it("DELETE returns 200 on success", async () => {
    mockDeleteCourse.mockResolvedValue(undefined);
    const res = await detailDelete(new Request("http://localhost/x", { method: "DELETE" }), idParams("c-1"));
    expect(res.status).toBe(200);
    expect(mockDeleteCourse).toHaveBeenCalledWith("c-1");
  });
});
