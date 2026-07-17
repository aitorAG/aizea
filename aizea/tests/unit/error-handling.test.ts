import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AppError,
  LLMError,
  PDFParseError,
  ExportError,
  ValidationError,
} from "@/lib/infrastructure/errors";
import { retry } from "@/lib/infrastructure/retry";
import { CircuitBreaker } from "@/lib/infrastructure/circuit-breaker";

describe("Error classes", () => {
  it("AppError has correct properties", () => {
    const err = new AppError("Something went wrong", "ERR_001", 500, true);
    expect(err.message).toBe("Something went wrong");
    expect(err.code).toBe("ERR_001");
    expect(err.statusCode).toBe(500);
    expect(err.recoverable).toBe(true);
    expect(err.name).toBe("AppError");
    expect(err instanceof Error).toBe(true);
    expect(err instanceof AppError).toBe(true);
  });

  it("LLMError extends AppError with retryable flag", () => {
    const err = new LLMError("OpenRouter failed", 429, true);
    expect(err.message).toBe("OpenRouter failed");
    expect(err.code).toBe("LLM_ERROR");
    expect(err.statusCode).toBe(429);
    expect(err.retryable).toBe(true);
    expect(err.recoverable).toBe(true);
    expect(err instanceof AppError).toBe(true);
    expect(err instanceof LLMError).toBe(true);
  });

  it("LLMError defaults to retryable=true and statusCode=502", () => {
    const err = new LLMError("Generic LLM failure");
    expect(err.statusCode).toBe(502);
    expect(err.retryable).toBe(true);
    expect(err.recoverable).toBe(true);
  });

  it("PDFParseError is not recoverable", () => {
    const err = new PDFParseError("Failed to parse PDF");
    expect(err.message).toBe("Failed to parse PDF");
    expect(err.code).toBe("PDF_PARSE_ERROR");
    expect(err.statusCode).toBe(500);
    expect(err.recoverable).toBe(false);
    expect(err instanceof AppError).toBe(true);
    expect(err instanceof PDFParseError).toBe(true);
  });

  it("ExportError is not recoverable", () => {
    const err = new ExportError("Export failed");
    expect(err.message).toBe("Export failed");
    expect(err.code).toBe("EXPORT_ERROR");
    expect(err.statusCode).toBe(500);
    expect(err.recoverable).toBe(false);
    expect(err instanceof AppError).toBe(true);
    expect(err instanceof ExportError).toBe(true);
  });

  it("ValidationError has statusCode 400 and is not recoverable", () => {
    const err = new ValidationError("Invalid input");
    expect(err.message).toBe("Invalid input");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.statusCode).toBe(400);
    expect(err.recoverable).toBe(false);
    expect(err instanceof AppError).toBe(true);
    expect(err instanceof ValidationError).toBe(true);
  });
});

describe("retry", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns result on first successful attempt", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries recoverable errors with exponential backoff", async () => {
    const error = new AppError("transient", "ERR", 500, true);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue("success");

    const promise = retry(fn, { maxAttempts: 3, baseDelay: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-recoverable errors", async () => {
    const error = new ValidationError("bad request");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(retry(fn, { maxAttempts: 3 })).rejects.toThrow("bad request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after max attempts exhausted", async () => {
    const error = new AppError("persistent", "ERR", 500, true);
    const fn = vi.fn().mockImplementation(() => {
      throw error;
    });

    const promise = retry(fn, { maxAttempts: 3, baseDelay: 1000 });
    const timerPromise = vi
      .advanceTimersByTimeAsync(1000)
      .then(() => vi.advanceTimersByTimeAsync(2000));
    const [, retryResult] = await Promise.allSettled([timerPromise, promise]);

    expect(retryResult.status).toBe("rejected");
    if (retryResult.status === "rejected") {
      expect(retryResult.reason.message).toBe("persistent");
    }
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("uses linear backoff when configured", async () => {
    const error = new AppError("transient", "ERR", 500, true);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue("success");

    const promise = retry(fn, {
      maxAttempts: 3,
      baseDelay: 1000,
      backoff: "linear",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry plain Errors without recoverable flag", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("plain error"));

    await expect(retry(fn, { maxAttempts: 3 })).rejects.toThrow("plain error");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("CircuitBreaker", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts in closed state", () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe("closed");
  });

  it("executes successfully in closed state", async () => {
    const cb = new CircuitBreaker();
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await cb.execute(fn);
    expect(result).toBe("ok");
    expect(cb.getState()).toBe("closed");
  });

  it("opens after failure threshold reached", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 30000 });
    const error = new Error("fail");
    const fn = vi.fn().mockRejectedValue(error);

    await expect(cb.execute(fn)).rejects.toThrow("fail");
    await expect(cb.execute(fn)).rejects.toThrow("fail");
    await expect(cb.execute(fn)).rejects.toThrow("fail");

    expect(cb.getState()).toBe("open");
  });

  it("rejects calls while open", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 30000 });
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(cb.execute(fn)).rejects.toThrow("fail");
    expect(cb.getState()).toBe("open");

    await expect(cb.execute(() => Promise.resolve("ok"))).rejects.toThrow(
      "Circuit breaker is OPEN"
    );
  });

  it("transitions to half-open after reset timeout", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 30000 });
    const fn = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(cb.execute(fn)).rejects.toThrow("fail");
    expect(cb.getState()).toBe("open");

    await vi.advanceTimersByTimeAsync(30000);
    expect(cb.getState()).toBe("half-open");
  });

  it("closes on success in half-open state", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 30000 });
    const failFn = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(cb.execute(failFn)).rejects.toThrow("fail");
    await vi.advanceTimersByTimeAsync(30000);
    expect(cb.getState()).toBe("half-open");

    const okFn = vi.fn().mockResolvedValue("ok");
    const result = await cb.execute(okFn);
    expect(result).toBe("ok");
    expect(cb.getState()).toBe("closed");
  });

  it("opens again on failure in half-open state", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 30000 });
    const failFn = vi.fn().mockRejectedValue(new Error("fail"));

    await expect(cb.execute(failFn)).rejects.toThrow("fail");
    await vi.advanceTimersByTimeAsync(30000);
    expect(cb.getState()).toBe("half-open");

    await expect(cb.execute(failFn)).rejects.toThrow("fail");
    expect(cb.getState()).toBe("open");
  });

  it("resets failure count on success before threshold", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 30000 });
    const error = new Error("fail");

    await expect(cb.execute(() => Promise.reject(error))).rejects.toThrow(
      "fail"
    );
    await expect(cb.execute(() => Promise.reject(error))).rejects.toThrow(
      "fail"
    );

    const okFn = vi.fn().mockResolvedValue("ok");
    await cb.execute(okFn);
    expect(cb.getState()).toBe("closed");

    await expect(cb.execute(() => Promise.reject(error))).rejects.toThrow(
      "fail"
    );
    await expect(cb.execute(() => Promise.reject(error))).rejects.toThrow(
      "fail"
    );
    await expect(cb.execute(() => Promise.reject(error))).rejects.toThrow(
      "fail"
    );

    expect(cb.getState()).toBe("open");
  });
});
