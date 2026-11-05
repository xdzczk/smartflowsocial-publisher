import type { Event, Filter } from 'nostr-tools';

import type { Relay, RelayConnection, RelaySubscription } from '../../src/core/Relay';
import type { RelayUrl } from '../../src/core/types';
import type { Logger } from '../../src/observability/logger';

/**
 * Mock logger that captures all log calls
 */
export class MockLogger implements Logger {
  public infoLogs: unknown[][] = [];
  public warnLogs: unknown[][] = [];
  public errorLogs: unknown[][] = [];
  private correlationId?: string;

  setCorrelationId(correlationId: string | undefined): void {
    this.correlationId = correlationId;
  }

  getCorrelationId(): string | undefined {
    return this.correlationId;
  }

  info(...args: unknown[]): void {
    this.infoLogs.push(args);
  }

  warn(...args: unknown[]): void {
    this.warnLogs.push(args);
  }

  error(...args: unknown[]): void {
    this.errorLogs.push(args);
  }

  clear(): void {
    this.infoLogs = [];
    this.warnLogs = [];
    this.errorLogs = [];
  }
}

/**
 * Mock relay connection with controllable behavior
 */
export class MockRelayConnection implements RelayConnection {
  public connected = false;
  public closed = false;
  public connectDelay = 0;
  public publishDelay = 0;
  public shouldFailConnect = false;
  public shouldFailPublish = false;
  public connectError: Error | null = null;
  public publishError: Error | null = null;

  constructor(options?: {
    connectDelay?: number;
    publishDelay?: number;
    shouldFailConnect?: boolean;
    shouldFailPublish?: boolean;
    connectError?: Error;
    publishError?: Error;
  }) {
    if (options) {
      this.connectDelay = options.connectDelay ?? 0;
      this.publishDelay = options.publishDelay ?? 0;
      this.shouldFailConnect = options.shouldFailConnect ?? false;
      this.shouldFailPublish = options.shouldFailPublish ?? false;
      this.connectError = options.connectError ?? null;
      this.publishError = options.publishError ?? null;
    }
  }

  async connect(): Promise<void> {
    if (this.connectDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.connectDelay));
    }
    if (this.shouldFailConnect) {
      throw this.connectError ?? new Error('Connection failed');
    }
    this.connected = true;
  }

  async publish(_event: Event): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected');
    }
    if (this.publishDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.publishDelay));
    }
    if (this.shouldFailPublish) {
      throw this.publishError ?? new Error('Publish failed');
    }
  }

  subscribe(
    _filters: Filter[],
    callbacks: {
      onevent: (_event: Event) => void;
      onclose?: (_reason: string) => void;
    }
  ): RelaySubscription {
    return {
      close: () => {
        if (callbacks.onclose) {
          callbacks.onclose('closed');
        }
      },
    };
  }

  close(): void {
    this.connected = false;
    this.closed = true;
  }

  get isConnected(): boolean {
    return this.connected;
  }
}

/**
 * Mock relay with controllable behavior
 */
export class MockRelay implements Relay {
  public readonly url: RelayUrl;
  public connectionDelay = 0;
  private connection: MockRelayConnection | null = null;
  public shouldFailCreateConnection = false;
  public createConnectionError: Error | null = null;

  constructor(
    url: string,
    options?: {
      connectionDelay?: number;
      shouldFailCreateConnection?: boolean;
      createConnectionError?: Error;
      connection?: MockRelayConnection;
    }
  ) {
    this.url = url as RelayUrl;
    if (options) {
      this.connectionDelay = options.connectionDelay ?? 0;
      this.shouldFailCreateConnection = options.shouldFailCreateConnection ?? false;
      this.createConnectionError = options.createConnectionError ?? null;
      this.connection = options.connection ?? null;
    }
  }

  async createConnection(): Promise<RelayConnection> {
    if (this.connectionDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.connectionDelay));
    }
    if (this.shouldFailCreateConnection) {
      throw this.createConnectionError ?? new Error('Failed to create connection');
    }
    this.connection ??= new MockRelayConnection();
    return this.connection;
  }

  getConnection(): MockRelayConnection | null {
    return this.connection;
  }
}
