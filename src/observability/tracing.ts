/**
 * Trace span for tracking operation timing
 */
export interface Span {
  /**
   * Span name
   */
  name: string;

  /**
   * Start time in milliseconds
   */
  startTime: number;

  /**
   * End time in milliseconds (set when span ends)
   */
  endTime?: number;

  /**
   * Span attributes/tags
   */
  attributes: Record<string, string | number | boolean>;

  /**
   * Child spans
   */
  children: Span[];
}

/**
 * Tracer for creating and managing spans
 */
export class Tracer {
  private spans: Span[] = [];

  /**
   * Creates a new span
   * @param name Span name
   * @param attributes Optional attributes
   * @returns Span object
   */
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): Span {
    const span: Span = {
      name,
      startTime: Date.now(),
      attributes: attributes ?? {},
      children: [],
    };
    this.spans.push(span);
    return span;
  }

  /**
   * Ends a span
   * @param span The span to end
   */
  endSpan(span: Span): void {
    span.endTime = Date.now();
  }

  /**
   * Gets duration of a span in milliseconds
   * @param span The span
   * @returns Duration in milliseconds, or null if span not ended
   */
  getDuration(span: Span): number | null {
    if (!span.endTime) {
      return null;
    }
    return span.endTime - span.startTime;
  }

  /**
   * Gets all spans
   */
  getSpans(): Span[] {
    return this.spans;
  }

  /**
   * Clears all spans (useful for testing)
   */
  clear(): void {
    this.spans = [];
  }
}

/**
 * Creates a tracer instance
 * @returns Tracer instance
 */
export function createTracer(): Tracer {
  return new Tracer();
}
