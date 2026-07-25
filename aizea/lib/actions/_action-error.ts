// Action error boundary — serialises typed errors into a stable wire shape
// the client can reason about (code, message, statusCode, recoverable).
//
// Usage in a server action:
//   return safeAction(async () => {
//     const slide = await db.slide.findUnique({ where: { id } });
//     if (!slide) throw new NotFoundError("Slide", id);
//     ...
//   });

import {
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
  UnauthorizedError,
} from "@/lib/infrastructure/errors";

export interface ActionError {
  code: string;
  message: string;
  statusCode: number;
  recoverable: boolean;
}

/**
 * Convert any thrown value into a structured `ActionError` that is safe
 * to send to the client (no stack traces in production).
 */
export function toActionError(err: unknown): ActionError {
  if (err instanceof AppError) {
    return {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
      recoverable: err.recoverable,
    };
  }

  // Unknown error: hide internals in production.
  const message =
    process.env.NODE_ENV === "development"
      ? err instanceof Error
        ? err.message
        : String(err)
      : "Se produjo un error inesperado.";

  return { code: "UNKNOWN", message, statusCode: 500, recoverable: false };
}

/**
 * Wrap a server action body so any thrown `AppError` (or unknown error)
 * is returned as a structured `{ data, error }` discriminated union instead
 * of propagating an unhandled exception.
 *
 * Useful for actions that return `Result`-style responses rather than
 * throwing to the client.
 */
export async function safeAction<T>(
  fn: () => Promise<T>
): Promise<{ data: T; error: null } | { data: null; error: ActionError }> {
  try {
    const data = await fn();
    return { data, error: null };
  } catch (err) {
    return { data: null, error: toActionError(err) };
  }
}

export { NotFoundError, ValidationError, ConflictError, UnauthorizedError, AppError };
