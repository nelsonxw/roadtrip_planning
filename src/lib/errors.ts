export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export type ProviderErrorKind =
  | "timeout"
  | "rate_limited"
  | "unauthorized"
  | "not_found"
  | "invalid_response"
  | "network"
  | "unavailable";

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }

  get retryable() {
    return this.kind === "timeout" || this.kind === "rate_limited" || this.kind === "network" || this.kind === "unavailable";
  }
}

export function toErrorResponse(error: unknown): { status: number; body: { error: string; code: string; details?: unknown } } {
  if (error instanceof AppError) {
    return { status: error.status, body: { error: error.message, code: error.code, details: error.details } };
  }
  if (error instanceof ProviderError) {
    const status = error.kind === "not_found" ? 404 : error.kind === "rate_limited" ? 429 : 502;
    return { status, body: { error: error.message, code: `provider_${error.kind}` } };
  }
  console.error(error);
  return { status: 500, body: { error: "Something went wrong. Please try again.", code: "internal_error" } };
}
