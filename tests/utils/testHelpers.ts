import { MockLogger, MockRelay } from './mocks';

/**
 * Creates a mock logger
 */
export function createMockLogger(): MockLogger {
  return new MockLogger();
}

/**
 * Creates a mock relay
 */
export function createMockRelay(
  url: string,
  options?: {
    connectionDelay?: number;
    shouldFailCreateConnection?: boolean;
    createConnectionError?: Error;
  }
): MockRelay {
  return new MockRelay(url, options);
}

/**
 * Creates multiple mock relays
 */
export function createMockRelays(urls: string[]): MockRelay[] {
  return urls.map((url) => createMockRelay(url));
}

/**
 * Waits for a condition to be true
 */
export async function waitFor(
  condition: () => boolean,
  timeout = 1000,
  interval = 10
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Condition not met within ${timeout}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Advances fake timers by the specified milliseconds
 */
// eslint-disable-next-line no-unused-vars
export function advanceTimers(_ms: number): void {
  // This will be used with vi.advanceTimersByTime
  // The actual implementation depends on Vitest's fake timers
}

/**
 * Asserts that a logger logged a specific message
 */
export function assertLoggerLogged(
  logger: MockLogger,
  level: 'info' | 'warn' | 'error',
  message: string | RegExp
): void {
  const logs = logger[`${level}Logs` as keyof MockLogger] as unknown[][];
  const found = logs.some((log) => {
    const logStr = log.join(' ');
    return typeof message === 'string' ? logStr.includes(message) : message.test(logStr);
  });
  if (!found) {
    throw new Error(
      `Expected logger to have logged ${level} message matching ${message}, but found: ${JSON.stringify(logs)}`
    );
  }
}

/**
 * Creates a delay promise (for testing timeouts)
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
