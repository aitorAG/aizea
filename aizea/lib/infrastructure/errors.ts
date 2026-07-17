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
