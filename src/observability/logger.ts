/**
 * Logger interface for structured logging
 * Replaces console.log with injectable, testable logging
 */
export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /**
   * Set correlation ID for this logger instance
   * @param correlationId The correlation ID to use for subsequent log entries
   */
  setCorrelationId(correlationId: string | undefined): void;
  /**
   * Get current correlation ID
   */
  getCorrelationId(): string | undefined;
}

/**
 * Structured log entry format
 */
interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  correlationId?: string;
  context?: Record<string, unknown>;
}

// Shared helper functions for log formatting
function extractMessageAndContext(args: unknown[]): {
  message: string;
  context?: Record<string, unknown>;
} {
  if (args.length === 0) {
    return { message: '' };
  }

  if (args.length === 1) {
    const message =
      typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0]);
    return { message };
  }

  // First arg is message, rest is context
  const message = String(args[0]);
  const context: Record<string, unknown> = {};
  for (let i = 1; i < args.length; i++) {
    if (typeof args[i] === 'object' && args[i] !== null) {
      Object.assign(context, args[i] as Record<string, unknown>);
    } else {
      context[`arg${i}`] = args[i];
    }
  }
  return { message, context };
}

function buildLogEntry(
  level: 'info' | 'warn' | 'error',
  message: string,
  // correlationId is used below to set entry.correlationId
  correlationId?: string,
  context?: Record<string, unknown>
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (correlationId) {
    entry.correlationId = correlationId;
  }

  if (context) {
    entry.context = context;
  }

  return entry;
}

/**
 * Console logger implementation
 * Wraps console methods for structured logging
 * Outputs pretty-printed JSON in development
 */
export class ConsoleLogger implements Logger {
  private correlationId?: string;

  setCorrelationId(correlationId: string | undefined): void {
    this.correlationId = correlationId;
  }

  getCorrelationId(): string | undefined {
    return this.correlationId;
  }

  private formatLog(level: 'info' | 'warn' | 'error', args: unknown[]): void {
    const { message, context } = extractMessageAndContext(args);
    const entry = buildLogEntry(level, message, this.correlationId, context);

    // Output as pretty-printed JSON for development
    const output = JSON.stringify(entry, null, 2);
    if (level === 'info') {
      console.info(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.error(output);
    }
  }

  info(...args: unknown[]): void {
    this.formatLog('info', args);
  }

  warn(...args: unknown[]): void {
    this.formatLog('warn', args);
  }

  error(...args: unknown[]): void {
    this.formatLog('error', args);
  }
}

/**
 * JSON logger implementation
 * Outputs compact JSON for production environments
 */
export class JsonLogger implements Logger {
  private correlationId?: string;

  setCorrelationId(correlationId: string | undefined): void {
    this.correlationId = correlationId;
  }

  getCorrelationId(): string | undefined {
    return this.correlationId;
  }

  private formatLog(level: 'info' | 'warn' | 'error', args: unknown[]): void {
    const { message, context } = extractMessageAndContext(args);
    const entry = buildLogEntry(level, message, this.correlationId, context);

    // Output as compact JSON for production
    const output = JSON.stringify(entry);
    if (level === 'info') {
      console.info(output);
    } else if (level === 'warn') {
      console.warn(output);
    } else {
      console.error(output);
    }
  }

  info(...args: unknown[]): void {
    this.formatLog('info', args);
  }

  warn(...args: unknown[]): void {
    this.formatLog('warn', args);
  }

  error(...args: unknown[]): void {
    this.formatLog('error', args);
  }
}

/**
 * Null logger implementation
 * Discards all log messages (useful for testing)
 */
export class NullLogger implements Logger {
  private correlationId?: string;

  setCorrelationId(correlationId: string | undefined): void {
    this.correlationId = correlationId;
  }

  getCorrelationId(): string | undefined {
    return this.correlationId;
  }

  info(..._args: unknown[]): void {
    // No-op
  }

  warn(..._args: unknown[]): void {
    // No-op
  }

  error(..._args: unknown[]): void {
    // No-op
  }
}

/**
 * Creates a logger instance based on environment
 * @param env Optional environment object (e.g., from Cloudflare Workers)
 * @returns Logger instance (JsonLogger for production, ConsoleLogger for development)
 */
export function createLogger(env?: { NODE_ENV?: string }): Logger {
  const isProduction = env?.NODE_ENV === 'production';
  return isProduction ? new JsonLogger() : new ConsoleLogger();
}
