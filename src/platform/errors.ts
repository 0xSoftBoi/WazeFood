// Domain error with an HTTP-friendly status. Used for unexpected/terminal failures;
// expected branches use Result instead.

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "payment_required"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  payment_required: 402,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError("bad_request", message, details);
}
export function notFound(message: string): AppError {
  return new AppError("not_found", message);
}
export function paymentRequired(message: string): AppError {
  return new AppError("payment_required", message);
}
export function rateLimited(message: string): AppError {
  return new AppError("rate_limited", message);
}
