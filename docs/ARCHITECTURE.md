# Architecture Documentation

## System Overview

The HTTP to Nostr Publisher is a Cloudflare Worker that provides an HTTP interface for publishing Nostr events to multiple relays concurrently. The system is designed for reliability, observability, and performance.

## Architecture Layers

```
┌─────────────────────────────────────────┐
│         HTTP Transport Layer            │
│  (handlers, mappers, validation)       │
└─────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────┐
│         Core Business Logic             │
│  (PublishEngine, ProfileEngine)         │
└─────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────┐
│         Adapter Layer                   │
│  (NostrRelayAdapter)                   │
└─────────────────────────────────────────┘
                    │
┌─────────────────────────────────────────┐
│         Infrastructure                  │
│  (Circuit Breaker, Health Checks,       │
│   Retry Logic, Rate Limiting)           │
└─────────────────────────────────────────┘
```

## Component Responsibilities

### Transport Layer (`src/transport/http/`)

**handlers.ts**
- HTTP request/response handling
- Request parsing and validation
- Error response formatting
- Policy selection from query parameters

**mappers.ts**
- Request/response transformation
- Error to HTTP response mapping
- Response header creation

### Core Layer (`src/core/`)

**PublishEngine.ts**
- Orchestrates concurrent publishing to multiple relays
- Manages overall timeouts and concurrency limits
- Aggregates results and classifies outcomes
- Health check integration

**RelayPublisher.ts**
- Individual relay connection management
- Retry logic with exponential backoff
- Timeout handling (connection and publish)
- Circuit breaker integration

**ProfileEngine.ts**
- Profile fetching from relays
- KV cache management
- Async refresh logic

**BatchPublisher.ts**
- Batch event publishing coordination
- Concurrent event processing

**EventValidator.ts**
- Nostr event structure validation
- Signature validation
- Uses Valibot schemas

**RelayUrl.ts**
- Relay URL normalization
- Validation and deduplication

### Adapter Layer (`src/adapters/nostr/`)

**relayAdapter.ts**
- WebSocket connection management
- Nostr protocol message handling
- Connection lifecycle

### Infrastructure (`src/core/`, `src/middleware/`)

**circuitBreaker.ts**
- Tracks relay failure rates
- Opens/closes circuits dynamically
- Prevents cascading failures

**healthCheck.ts**
- Periodic relay health monitoring
- Health status tracking
- Influences relay selection

**retry.ts**
- Exponential backoff implementation
- Configurable retry attempts

**rateLimiter.ts**
- Sliding window rate limiting
- Per-client tracking (IP or API token)

**cors.ts** (middleware)
- CORS header management
- Origin validation
- Preflight handling

### Policies (`src/policies/`)

Configurable behavior objects:
- **defaultPolicy**: Balanced approach
- **conservativePolicy**: Reliability-focused
- **aggressivePolicy**: Speed-focused
- **ProfilePolicy**: Profile-specific settings

### Observability (`src/observability/`)

**logger.ts**
- Structured logging with correlation IDs
- Multiple logger implementations

**metrics.ts**
- Counter, histogram, gauge metrics
- Metrics export interface

**tracing.ts**
- Span-based tracing (interface)

### Security (`src/security/`)

**sanitizer.ts**
- Content size limits
- Tag validation
- XSS prevention

### Validation (`src/validation/`)

**schemas.ts**
- Valibot schema definitions
- Request validation
- Error field extraction

## Data Flow

### Publish Flow

```
HTTP Request
    │
    ├─> Request Size Validation
    │
    ├─> JSON Parsing
    │
    ├─> Schema Validation (Valibot)
    │
    ├─> Event Sanitization
    │
    ├─> Relay URL Normalization
    │
    ├─> Health Check Filtering (optional)
    │
    ├─> Concurrent Publishing
    │   │
    │   ├─> Relay 1 ──> Retry Logic ──> Circuit Breaker ──> Result
    │   ├─> Relay 2 ──> Retry Logic ──> Circuit Breaker ──> Result
    │   └─> Relay N ──> Retry Logic ──> Circuit Breaker ──> Result
    │
    ├─> Result Aggregation
    │
    ├─> Outcome Classification
    │
    └─> HTTP Response
```

### Profile Flow

```
HTTP Request
    │
    ├─> Validation
    │
    ├─> KV Cache Check
    │   │
    │   ├─> Cached? ──> Return 200
    │   │
    │   └─> Not Cached ──> Return 202
    │                      │
    │                      └─> Background Fetch
    │                          │
    │                          ├─> Try Relay 1
    │                          ├─> Try Relay 2
    │                          └─> Try Relay N
    │                          │
    │                          └─> Cache Result
```

## Design Patterns

### Circuit Breaker

Prevents cascading failures by:
1. Tracking failure rates per relay
2. Opening circuit after threshold failures
3. Blocking requests to open circuits
4. Attempting recovery (half-open state)
5. Closing circuit after successful operations

### Retry with Exponential Backoff

Handles transient failures:
1. Configurable max attempts
2. Exponential delay: `backoffMs * 2^attempt`
3. Jitter to prevent thundering herd
4. Abort signal support for cancellation

### Health Checks

Proactive relay monitoring:
1. Tracks consecutive failures
2. Marks relays as unhealthy after threshold
3. Filters unhealthy relays from publishing
4. Periodic health status updates

### Policy Pattern

Configurable behavior via policy objects:
- Different policies for different use cases
- Query parameter selection
- Consistent interface across policies

## Concurrency Model

The system uses a concurrency limiter that:
1. Processes items up to the limit concurrently
2. Waits for completion when at limit
3. Cleans up completed promises
4. Prevents memory leaks

## Error Handling

Structured error hierarchy:
- `AppError`: Base error class
- `ValidationError`: Input validation failures
- `RelayError`: Relay-specific errors
- `TimeoutError`: Timeout scenarios
- `ConfigurationError`: Configuration issues

All errors include:
- Message
- HTTP status code
- Optional field (for validation errors)
- Optional suggestion
- Optional details object

## Timeout Strategy

Multi-level timeout handling:
1. **Connection Timeout**: Time to establish WebSocket connection
2. **Per-Relay Timeout**: Total time for a single relay operation
3. **Overall Timeout**: Total time for all relays
4. **Worker Timeout**: Cloudflare's 30s hard limit (warned at 25s)

## Security Considerations

1. **Input Validation**: Valibot schemas validate all inputs
2. **Sanitization**: Content and tag size limits, structure validation
3. **Rate Limiting**: Per-client request limits
4. **Authentication**: Optional API token protection
5. **Request Size Limits**: Prevents DoS via large payloads

## Observability

### Logging
- Structured logging with correlation IDs
- Request/response logging
- Error logging with context

### Metrics
- Counter metrics (success/failure counts)
- Histogram metrics (latency distributions)
- Gauge metrics (current state)

### Tracing
- Span-based tracing interface
- Operation timing
- Child span support

## Configuration

Environment variables control:
- API token authentication
- Rate limiting thresholds
- CORS origins
- Metrics export settings
- KV namespace binding

## Testing Strategy

- **Unit Tests**: Core logic validation
- **Integration Tests**: HTTP handlers
- **Property Tests**: Validation edge cases
- **Chaos Tests**: Failure scenarios, timeouts, concurrency

## Performance Characteristics

- **Concurrent Publishing**: Up to 8-12 relays simultaneously (policy-dependent)
- **Timeout Handling**: Fast failure for unhealthy relays
- **Health Filtering**: Skips known-bad relays
- **Circuit Breakers**: Prevents wasted requests to failing relays
- **Request Size Validation**: Early rejection of oversized requests
