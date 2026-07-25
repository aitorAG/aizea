export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly recoverable: boolean = false
  ) {
    super(message);
    this.name = "AppError";
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class LLMError extends AppError {
  constructor(
    message: string,
    statusCode: number = 502,
    public readonly retryable: boolean = true
  ) {
    super(message, "LLM_ERROR", statusCode, retryable);
    this.name = "LLMError";
    Object.setPrototypeOf(this, LLMError.prototype);
  }
}

export class PDFParseError extends AppError {
  constructor(message: string) {
    super(message, "PDF_PARSE_ERROR", 500, false);
    this.name = "PDFParseError";
    Object.setPrototypeOf(this, PDFParseError.prototype);
  }
}

export class ExportError extends AppError {
  constructor(message: string) {
    super(message, "EXPORT_ERROR", 500, false);
    this.name = "ExportError";
    Object.setPrototypeOf(this, ExportError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400, false);
    this.name = "ValidationError";
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, "NOT_FOUND", 404, false);
    this.name = "NotFoundError";
    this.resource = resource;
    this.resourceId = id;
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
  readonly resource: string;
  readonly resourceId: string;
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "CONFLICT", 409, false);
    this.name = "ConflictError";
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, "UNAUTHORIZED", 401, false);
    this.name = "UnauthorizedError";
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

export class NotImplementedError extends AppError {
  constructor(feature: string) {
    super(`${feature} is not implemented yet`, "NOT_IMPLEMENTED", 501, false);
    this.name = "NotImplementedError";
    Object.setPrototypeOf(this, NotImplementedError.prototype);
  }
}
