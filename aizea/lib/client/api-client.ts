// Typed API client with cache (Fase 4 — data layer).
//
// The strangler-fig SPA data layer talks to the Fase 3-D / 4-A REST endpoints
// through THIS client instead of scattering `fetch("/api/...")` calls across
// components. It provides three things the raw fetch does not:
//
//   1. TYPED responses — every endpoint returns a discriminated `ApiResult<T>`
//      so callers branch on `ok` and never touch `any`.
//   2. A small TTL CACHE for GETs — repeated reads of the same resource within
//      the TTL window are served from memory (no network), and mutations
//      invalidate the relevant keys.
//   3. IN-FLIGHT DEDUPLICATION — concurrent GETs of the same key share ONE
//      network request (prevents a render storm from firing N identical GETs).
//
// Kept framework-agnostic (no React) and injectable (`fetchImpl`, `now`) so it
// is unit-testable without a browser or a running server.

import type { CourseSummary } from "@/lib/types";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

export interface CourseDetail {
  course: { id: string; name: string; createdAt: string; updatedAt: string };
  slides: Array<Record<string, unknown>>;
  materials: Array<Record<string, unknown>>;
  figures: Array<Record<string, unknown>>;
}

export interface JobStatus {
  id: string;
  phase: string;
  status: string;
  progress: number;
  total: number;
  currentStep: string | null;
  error: string | null;
  courseId: string | null;
  materialId: string | null;
}

export interface StartRunResult {
  empty: boolean;
  reason?: string;
  message?: string;
  enqueued?: boolean;
  runId?: string;
}

export interface ApiClientOptions {
  /** Base URL for the API (default ""). The desktop build serves the API on
   *  the same origin, so "" is correct there; tests inject a stub. */
  baseUrl?: string;
  /** Injected fetch (default global fetch). Tests pass a stub. */
  fetchImpl?: typeof fetch;
  /** GET cache TTL in ms (default 5000). Set 0 to disable caching. */
  cacheTtlMs?: number;
  /** Injected clock (default Date.now). Tests control time. */
  now?: () => number;
}

interface CacheEntry {
  expires: number;
  value: unknown;
}

const DEFAULT_TTL_MS = 5_000;

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<ApiResult<unknown>>>();

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  // --- public API -----------------------------------------------------

  listCourses(): Promise<ApiResult<CourseSummary[]>> {
    return this.getCached<CourseSummary[]>("/api/courses", (body) => body.courses);
  }

  getCourse(id: string): Promise<ApiResult<CourseDetail>> {
    return this.getCached<CourseDetail>(`/api/courses/${id}`, (body) => ({
      course: body.course,
      slides: body.slides,
      materials: body.materials,
      figures: body.figures,
    }));
  }

  async createCourse(name: string): Promise<ApiResult<{ id: string }>> {
    const res = await this.mutate<{ id: string }>("/api/courses", "POST", { name }, (b) => ({
      id: b.id,
    }));
    if (res.ok) this.invalidate("/api/courses");
    return res;
  }

  async updateCourse(
    id: string,
    data: { name?: string; llmContext?: string }
  ): Promise<ApiResult<{ course: unknown }>> {
    const res = await this.mutate<{ course: unknown }>(
      `/api/courses/${id}`,
      "PATCH",
      data,
      (b) => ({ course: b.course })
    );
    if (res.ok) {
      this.invalidate("/api/courses");
      this.invalidate(`/api/courses/${id}`);
    }
    return res;
  }

  async deleteCourse(id: string): Promise<ApiResult<null>> {
    const res = await this.mutate<null>(`/api/courses/${id}`, "DELETE", undefined, () => null);
    if (res.ok) {
      this.invalidate("/api/courses");
      this.invalidate(`/api/courses/${id}`);
    }
    return res;
  }

  async startRun(courseId: string): Promise<ApiResult<StartRunResult>> {
    // Never cached: a run start is a mutation with side effects.
    return this.mutate<StartRunResult>("/api/pipeline/start", "POST", { courseId }, (b) => ({
      empty: b.empty,
      reason: b.reason,
      message: b.message,
      enqueued: b.enqueued,
      runId: b.runId,
    }));
  }

  getJobStatus(jobId: string): Promise<ApiResult<JobStatus>> {
    // Job status is polled frequently and changes fast → bypass the cache.
    return this.request<JobStatus>(
      `/api/pipeline/${jobId}/status`,
      { method: "GET" },
      (b) => b as unknown as JobStatus
    );
  }

  async cancelRun(jobId: string): Promise<ApiResult<{ jobId: string; status: string }>> {
    return this.mutate<{ jobId: string; status: string }>(
      `/api/pipeline/${jobId}/cancel`,
      "POST",
      undefined,
      (b) => ({ jobId: b.jobId, status: b.status })
    );
  }

  /** Clear the entire cache (e.g. on course switch). */
  clearCache(): void {
    this.cache.clear();
  }

  // --- internals ------------------------------------------------------

  private async getCached<T>(
    path: string,
    extract: (body: any) => T
  ): Promise<ApiResult<T>> {
    // Serve from cache when fresh.
    if (this.cacheTtlMs > 0) {
      const hit = this.cache.get(path);
      if (hit && hit.expires > this.now()) {
        return { ok: true, data: hit.value as T };
      }
    }
    // Deduplicate concurrent identical GETs.
    const existing = this.inflight.get(path);
    if (existing) return existing as Promise<ApiResult<T>>;

    const promise = this.request<T>(path, { method: "GET" }, extract).then((res) => {
      if (res.ok && this.cacheTtlMs > 0) {
        this.cache.set(path, { expires: this.now() + this.cacheTtlMs, value: res.data });
      }
      this.inflight.delete(path);
      return res;
    });
    this.inflight.set(path, promise as Promise<ApiResult<unknown>>);
    return promise;
  }

  private async mutate<T>(
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body: unknown,
    extract: (body: any) => T
  ): Promise<ApiResult<T>> {
    return this.request<T>(
      path,
      {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      extract
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit,
    extract: (body: any) => T
  ): Promise<ApiResult<T>> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fallo de red";
      return { ok: false, error: message, status: 0 };
    }

    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (!res.ok || (body && body.ok === false)) {
      const error =
        (body && typeof body.error === "string" && body.error) ||
        `HTTP ${res.status}`;
      return { ok: false, error, status: res.status };
    }

    return { ok: true, data: extract(body ?? {}) };
  }

  invalidate(path: string): void {
    this.cache.delete(path);
  }
}
