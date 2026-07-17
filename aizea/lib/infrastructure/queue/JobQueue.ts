import { Queue, Job } from "bullmq";
import IORedis, { type Redis } from "ioredis";
import { config } from "@/lib/config";

export type JobName =
  | "generate-outline"
  | "generate-slide-content"
  | "generate-all-slides"
  | "extract-unit";

export interface JobData {
  "generate-outline": { courseId: string; selectedNodeIds: string[] };
  "generate-slide-content": { slideId: string };
  "generate-all-slides": { courseId: string };
  "extract-unit": { unitId: string; materialId: string };
}

/**
 * JobQueue — thin wrapper around BullMQ that falls back to a no-op when
 * Redis is not reachable. The fallback is critical for the dev workflow:
 * if the user hasn't started Redis (or the docker container's port is not
 * exposed to the host), the pipeline must still run instead of throwing
 * ECONNREFUSED on every enqueue.
 *
 * The previous version only checked that the Queue constructor did not
 * throw, but `new Queue(...)` is a no-op that does not actually open a
 * connection — so the constructor always reported `redisAvailable=true`
 * even when Redis was down, and the failure surfaced as a runtime
 * ECONNREFUSED inside the pipeline. The fix is to probe Redis explicitly
 * before flipping the availability flag.
 */
export class JobQueue {
  private queue: Queue | null = null;
  private probeClient: Redis | null = null;
  private redisAvailable = true;
  private probeSettled = true;
  private probePromise: Promise<boolean>;

  constructor(
    redisUrl?: string,
    options: { probeTimeoutMs?: number; skipProbe?: boolean } = {}
  ) {
    const url = redisUrl ?? config.redis.url;

    if (options.skipProbe) {
      // Tests + callers that explicitly want to skip the probe. The
      // queue is treated as available, mirroring the previous
      // behaviour.
      this.probePromise = Promise.resolve(true);
      this.queue = new Queue("aizea-jobs", {
        connection: { url },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 1000,
          },
        },
      });
      return;
    }

    // Probe Redis asynchronously; assume "down" until the probe
    // settles. The probe is the only thing that may flip the flag.
    this.redisAvailable = false;
    this.probeSettled = false;
    this.probePromise = this.probeRedis(url, options.probeTimeoutMs ?? 1500);
  }

  private async probeRedis(url: string, timeoutMs: number): Promise<boolean> {
    let probe: IORedis;
    try {
      probe = new IORedis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });
    } catch (err) {
      this.probeSettled = true;
      this.redisAvailable = false;
      return false;
    }

    this.probeClient = probe;
    probe.on("error", () => {
      // Swallow — the .ping() rejection below drives the flag.
    });

    const settle = (ok: boolean): boolean => {
      if (this.probeSettled) return this.redisAvailable;
      this.probeSettled = true;
      this.redisAvailable = ok;
      try {
        probe.disconnect();
      } catch {
        // ignore
      }
      this.probeClient = null;
      if (ok) {
        this.queue = new Queue("aizea-jobs", {
          connection: { url },
          defaultJobOptions: {
            attempts: 3,
            backoff: {
              type: "exponential",
              delay: 1000,
            },
          },
        });
      } else {
        console.warn(
          "[JobQueue] Redis unreachable at " +
            url +
            " — queue is a no-op. Extraction will run in-process via UnitExtractor."
        );
      }
      return ok;
    };

    // Race the PING against a hard timeout. ioredis's `lazyConnect:
    // true` means .ping() will trigger the underlying connect.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(settle(false)), timeoutMs);
    });
    const pingPromise = probe
      .ping()
      .then(() => settle(true))
      .catch(() => settle(false));
    try {
      return await Promise.race([pingPromise, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Synchronous read of the availability flag. The probe is best-effort
   * and may still be in flight on the first call; callers that need a
   * hard guarantee should `await this.waitForProbe()` first.
   */
  isAvailable(): boolean {
    return this.redisAvailable;
  }

  /**
   * Wait until the initial probe has resolved. Returns the final
   * availability flag. Idempotent: subsequent calls return the cached
   * result immediately. This is the preferred entry point for the
   * pipeline — it lets us decide in-process vs queued before doing
   * any work.
   */
  async waitForProbe(): Promise<boolean> {
    return await this.probePromise;
  }

  async enqueue<T extends JobName>(
    name: T,
    data: JobData[T]
  ): Promise<{ jobId: string }> {
    if (!this.redisAvailable || !this.queue) {
      console.warn(`[JobQueue] Skipping enqueue("${name}") — Redis unavailable`);
      return { jobId: "local-noredis" };
    }
    const job = await this.queue.add(name, data);
    return { jobId: job.id! };
  }

  async getStatus(jobId: string): Promise<{ status: string; progress: number }> {
    if (!this.redisAvailable || !this.queue) {
      return { status: "unavailable", progress: 0 };
    }
    const job = await Job.fromId(this.queue, jobId);
    if (!job) {
      throw new Error("Trabajo no encontrado");
    }

    const state = await job.getState();
    const progress = job.progress ?? 0;

    return { status: state, progress: typeof progress === "number" ? progress : 0 };
  }

  async close(): Promise<void> {
    if (this.probeClient) {
      this.probeClient.disconnect();
      this.probeClient = null;
    }
    if (this.queue) {
      await this.queue.close();
    }
  }
}
