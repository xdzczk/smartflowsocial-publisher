# HTTP to Nostr Cloudflare worker (Vibe version)

This [Cloudflare worker](https://workers.cloudflare.com/) exposes a HTTP interface to publish events to specified Nostr relays.
The HTTP request is non-blocking and will immediatelly return. The events will be published asynchronously.

The goal of this worker is to make it easier to integrate publishing events into any application.
Using this worker applications do not need to integrate websockets and can publish events through a non-blocking HTTP request.

## API

### POST /publish

Send a JSON body with the event and the relays that the event should be published to.

**Request Body:**
```json
{
  "relays": ["wss://relay.damus.io", "wss://relay.snort.social"],
  "event": {
    "id": "event-id",
    "pubkey": "pubkey",
    "kind": 1,
    "sig": "signature",
    ...
  },
  "correlationId": "optional-correlation-id",
  "returnPerRelayResults": true
}
```

**Request Fields:**
- `relays` (required): Array of relay URLs. Must use `wss://` scheme. URLs are normalized (trimmed, deduplicated, max 12 relays).
- `event` (required): Signed Nostr event JSON with required fields: `id`, `pubkey`, `kind`, `sig`.
- `correlationId` (optional): Correlation ID for tracking.
- `returnPerRelayResults` (optional): Default `true`. If `true`, returns per-relay results.

**Response:**

The endpoint returns synchronously with per-relay publish results. Returns HTTP 200 with JSON body:

```json
{
  "results": [
    {
      "relay": "wss://relay.damus.io",
      "ok": true,
      "latencyMs": 123
    },
    {
      "relay": "wss://relay.snort.social",
      "ok": false,
      "latencyMs": 2500,
      "error": "TIMEOUT"
    }
  ]
}
```

**Response Fields:**
- `results`: Array of per-relay results, one per relay in the request order.
- Each result contains:
  - `relay`: The relay URL that was attempted.
  - `ok`: `true` if relay accepted (ACK), `false` otherwise.
  - `latencyMs`: Time taken in milliseconds.
  - `error`: Optional error message (e.g., "TIMEOUT", "RELAY_REJECTED", "CONNECTION_ERROR").

**Error Responses:**

Invalid request returns HTTP 400 with JSON:
```json
{
  "error": "Error message describing the issue"
}
```

**Query Parameters:**
- `?policy=conservative` - Use conservative policy (fewer retries, longer timeouts)
- `?policy=aggressive` - Use aggressive policy (more retries, shorter timeouts)
- `?policy=default` or omitted - Use default policy (balanced)

**Notes:**
- Relay URLs are normalized: `wss://` scheme enforced, whitespace trimmed, trailing slashes removed, deduplicated, capped at 12 relays.
- Per-relay timeout: ~3000ms
- Overall request timeout: 5000ms hard cap (Cloudflare Workers have a 30s absolute limit)
- Concurrency limit: 8 concurrent publishes
- Request size limit: 1MB
- Results are returned even if some relays fail (as long as request is valid).
- Response includes `X-Request-ID` header with correlation ID for tracing

### POST /batch

Publish multiple events to multiple relays in a single request.

**Request Body:**
```json
{
  "events": [
    {
      "id": "event-id-1",
      "pubkey": "pubkey",
      "kind": 1,
      "sig": "signature-1",
      ...
    },
    {
      "id": "event-id-2",
      "pubkey": "pubkey",
      "kind": 1,
      "sig": "signature-2",
      ...
    }
  ],
  "relays": ["wss://relay.damus.io", "wss://relay.snort.social"]
}
```

**Request Fields:**
- `events` (required): Array of signed Nostr events. Maximum 200 events per batch.
- `relays` (required): Array of relay URLs. Same normalization rules as `/publish`.

**Response:**

Returns HTTP 200 with JSON body:
```json
{
  "results": [
    {
      "eventId": "event-id-1",
      "outcome": {
        "status": "success",
        "relays": [...]
      }
    },
    {
      "eventId": "event-id-2",
      "outcome": {
        "status": "partial",
        "relays": [...]
      }
    }
  ],
  "totalEvents": 2,
  "successfulEvents": 1,
  "failedEvents": 1
}
```

**Query Parameters:**
- Same as `/publish`: `?policy=conservative|aggressive|default`

**Notes:**
- Maximum 200 events per batch request
- Request size limit: 10MB (10x single request limit)
- All events are published concurrently with concurrency limits applied
- Each event's outcome is tracked independently

### POST /profile

Retrieve the profile for a pubkey.

```json
{
  "relays": ["relay.damus.io", "relay.snort.social"],
  "pubkey": "profile-pubkey"
}
```

If a profile is already cached it will return with `HTTP status 200`.

If a profile is NOT already cached it will return with `HTTP status 202` and query the profile asynchronously.

## Configuration

#### Cloudflare KV

The profile data is cached in a [worker KV](https://developers.cloudflare.com/workers/runtime-apis/kv/) (a global, low-latency, key-value data store).

Configure the KV:

```
$ wrangler kv:namespace create PROFILES
$ wrangler kv:namespace create PROFILES --preview
```

and add the `kv_namespaces` array to the wrangler.toml

#### API Token

To protect your worker you can set a `API_TOKEN` environment variable.

Clients then need to send this token in a `API-TOKEN` HTTP header.

#### CORS

To enable CORS support for browser-based clients:

```
CORS_ENABLED=true
CORS_ORIGINS=https://example.com,https://app.example.com
```

#### Rate Limiting

Configure rate limiting per IP/API token:

```
RATE_LIMIT_REQUESTS=100        # Max requests per window (default: 100)
RATE_LIMIT_WINDOW_MS=60000     # Window size in milliseconds (default: 60000 = 1 minute)
```

#### Metrics Export

Enable metrics export to Cloudflare Analytics:

```
METRICS_EXPORT_ENABLED=true
METRICS_EXPORT_INTERVAL_MS=60000  # Export interval in milliseconds (default: 60000)
```

## Deployment

Refer to the [Cloudflare docs](https://developers.cloudflare.com/workers/get-started/guide/) Learn more about Cloudflare workers and how to publish workers

```
$ wrangler publish
```

## Architecture

### System Overview

The worker implements a layered architecture:

1. **Transport Layer** (`src/transport/http/`): HTTP request/response handling, validation, mapping
2. **Core Layer** (`src/core/`): Business logic for publishing, profile fetching, relay management
3. **Adapters** (`src/adapters/`): Protocol-specific adapters (Nostr WebSocket)
4. **Policies** (`src/policies/`): Configurable retry, timeout, and concurrency policies
5. **Observability** (`src/observability/`): Logging, metrics, tracing
6. **Security** (`src/security/`): Input sanitization and validation
7. **Middleware** (`src/middleware/`): Rate limiting, CORS

### Key Components

- **PublishEngine**: Orchestrates concurrent publishing to multiple relays with timeout handling
- **RelayPublisher**: Handles individual relay connections with retry logic and circuit breakers
- **HealthCheckManager**: Tracks relay health and filters unhealthy relays
- **CircuitBreakerManager**: Prevents cascading failures by opening circuits on repeated failures
- **RateLimiter**: Sliding window rate limiting per client identifier
- **EventValidator**: Validates Nostr event structure using Valibot schemas

### Data Flow

**Publish Flow:**
1. HTTP request → Request validation & sanitization
2. Relay URL normalization
3. Health check filtering (optional)
4. Concurrent publishing with concurrency limits
5. Retry logic with exponential backoff
6. Circuit breaker checks
7. Result aggregation and classification
8. HTTP response with per-relay results

**Profile Flow:**
1. HTTP request → Validation
2. KV cache check
3. If cached: return immediately (200)
4. If not cached: trigger async fetch (202)
5. Background fetch from relays
6. Cache result for future requests

### Design Patterns

- **Circuit Breaker**: Prevents cascading failures when relays are down
- **Retry with Backoff**: Handles transient failures gracefully
- **Health Checks**: Proactive relay monitoring
- **Concurrency Control**: Limits simultaneous operations to prevent resource exhaustion
- **Policy Pattern**: Configurable behavior via policy objects

### Timeout Handling

Cloudflare Workers have a hard 30-second timeout limit. The system:
- Configures overall timeouts well below 30s (default: 5s)
- Warns when operations approach 25s threshold
- Uses per-relay timeouts to prevent individual relays from blocking
- Implements abort signals for cancellation

## Development

```
$ wrangler dev
```
