/**
 * Logger interface for structured logging
 * Replaces console.log with injectable, testable logging
 */
export interface Logger {
  // eslint-disable-next-line no-unused-vars
  info(...args: unknown[]): void;
  // eslint-disable-next-line no-unused-vars
  warn(...args: unknown[]): void;
  // eslint-disable-next-line no-unused-vars
  error(...args: unknown[]): void;
}

/**
 * Console logger implementation
 * Wraps console methods for structured logging
 */
export class ConsoleLogger implements Logger {
  info(...args: unknown[]): void {
    console.info(...args);
  }

  warn(...args: unknown[]): void {
    console.warn(...args);
  }

  error(...args: unknown[]): void {
    console.error(...args);
  }
}

/**
 * Null logger implementation
 * Discards all log messages (useful for testing)
 */
export class NullLogger implements Logger {
  // eslint-disable-next-line no-unused-vars
  info(..._args: unknown[]): void {
    // No-op
  }

  // eslint-disable-next-line no-unused-vars
  warn(..._args: unknown[]): void {
    // No-op
  }

  // eslint-disable-next-line no-unused-vars
  error(..._args: unknown[]): void {
    // No-op
  }
}
