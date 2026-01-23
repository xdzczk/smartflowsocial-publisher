import type { RelayUrl } from './types';

/**
 * Base error class for all custom errors
 * Provides consistent error structure with HTTP status code mapping
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- V8-specific API check
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Validation error for input validation failures
 * Used when request data doesn't meet requirements
 */
export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
  readonly httpStatus = 400;
  readonly field?: string;
  readonly suggestion?: string;

  constructor(
    message: string,
    field?: string,
    details?: Record<string, unknown>,
    suggestion?: string
  ) {
    super(message, details);
    this.field = field;
    this.suggestion = suggestion;

    // Add helpful suggestions for common errors
    if (!this.suggestion && field) {
      if (field.includes('event.id')) {
        this.suggestion = 'Event ID must be a 64-character hexadecimal string';
      } else if (field.includes('event.sig')) {
        this.suggestion = 'Event signature must be a 128-character hexadecimal string';
      } else if (field.includes('event.pubkey')) {
        this.suggestion = 'Pubkey must be a 64-character hexadecimal string or bech32 encoded (npub...)';
      } else if (field.includes('relays')) {
        this.suggestion = 'Relays must be an array of valid WebSocket URLs (wss://...)';
      }
    }
  }
}

/**
 * Relay-specific error with context
 * Used when relay operations fail
 */
export class RelayError extends AppError {
  readonly code = 'RELAY_ERROR';
  readonly httpStatus = 502; // Bad Gateway
  readonly relay: RelayUrl;
  readonly reason?: string;

  constructor(
    message: string,
    relay: RelayUrl,
    reason?: string,
    details?: Record<string, unknown>
  ) {
    super(message, details);
    this.relay = relay;
    this.reason = reason;
  }
}

/**
 * Timeout error for timeout scenarios
 * Used when operations exceed time limits
 */
export class TimeoutError extends AppError {
  readonly code = 'TIMEOUT_ERROR';
  readonly httpStatus = 504; // Gateway Timeout
  readonly timeoutMs?: number;

  constructor(
    message: string,
    timeoutMs?: number,
    details?: Record<string, unknown>
  ) {
    super(message, details);
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Configuration error for policy/configuration issues
 * Used when policies or configuration are invalid
 */
export class ConfigurationError extends AppError {
  readonly code = 'CONFIGURATION_ERROR';
  readonly httpStatus = 500;

  constructor(
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message, details);
  }
}

/**
 * Replay protection error
 * Used when an event has already been published (replay attack prevention)
 */
export class ReplayError extends AppError {
  readonly code = 'REPLAY_ERROR';
  readonly httpStatus = 409; // Conflict
  readonly eventId?: string;
  readonly suggestion = 'Event has already been published. Replay protection prevents duplicate publishing for 24 hours.';

  constructor(
    message: string,
    eventId?: string,
    details?: Record<string, unknown>
  ) {
    super(message, {
      ...details,
      eventId,
      ttlHours: 24,
      replayProtection: true,
    });
    this.eventId = eventId;
  }
}
