/** Service-layer errors that the Admin API maps onto HTTP status codes. */
export class ServiceError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409 | 502,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends ServiceError {
  constructor(code: string, message: string, details?: unknown) {
    super(400, code, message, details);
  }
}

export class NotFoundError extends ServiceError {
  constructor(code: string, message: string, details?: unknown) {
    super(404, code, message, details);
  }
}

export class ConflictError extends ServiceError {
  constructor(code: string, message: string, details?: unknown) {
    super(409, code, message, details);
  }
}

export class ForbiddenError extends ServiceError {
  constructor(code: string, message: string, details?: unknown) {
    super(403, code, message, details);
  }
}

/** Stored secrets that the current master key cannot decrypt (ADR-0016). */
export class SecretsUnreadableError extends ConflictError {
  constructor() {
    super('secrets_unreadable', 'The stored secrets cannot be read with the current master key. Enter them again.');
  }
}

/** A plugin or upstream answered, but with something core cannot use. */
export class BadGatewayError extends ServiceError {
  constructor(code: string, message: string, details?: unknown) {
    super(502, code, message, details);
  }
}
