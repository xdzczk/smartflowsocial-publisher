# API Specification

Complete API reference for the HTTP to Nostr Publisher service.

> 📖 **See Also**: [README.md](../README.md) for quick start and overview. [ARCHITECTURE.md](ARCHITECTURE.md) for system design details.

## Base URL

All endpoints are relative to the worker deployment URL.

## Authentication

If `API_TOKEN` environment variable is set, include it in the `API-TOKEN` header:

```
API-TOKEN: your-secret-token
```

## Endpoints

### POST /publish

Publishes a single signed Nostr event to multiple relays.

#### Request

**Headers:**
- `Content-Type: application/json`
- `API-TOKEN: <token>` (optional, required if API_TOKEN env var is set)
- `X-Request-ID: <id>` (optional, for request tracking)

**Query Parameters:**
- `policy` (optional): `conservative` | `aggressive` | `default`

**Body:**
```json
{
  "relays": ["wss://relay.damus.io", "wss://relay.snort.social"],
  "event": {
    "id": "64-character-hex-string",
    "pubkey": "64-character-hex-string",
    "kind": 1,
    "created_at": 1234567890,
    "content": "Event content",
    "tags": [],
    "sig": "128-character-hex-signature"
  },
  "correlationId": "optional-correlation-id"
}
```

**Field Descriptions:**
- `relays` (required, array): Array of relay WebSocket URLs. Maximum 12 relays. URLs are normalized (trimmed, deduplicated, `wss://` scheme enforced).
- `event` (required, object): Signed Nostr event. Must include `id`, `pubkey`, `kind`, `sig`, `created_at`, `content`, `tags`.
- `correlationId` (optional, string): Correlation ID for request tracking.

#### Response

**Success (200 OK):**
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

**Error (400 Bad Request):**
```json
{
  "error": "Invalid publish request: events must be an array",
  "code": "VALIDATION_ERROR",
  "field": "body"
}
```

**Error (409 Conflict - Replay Protection):**
```json
{
  "error": "Event abc123... has already been published. Replay protection prevents duplicate publishing.",
  "code": "REPLAY_ERROR",
  "details": {
    "eventId": "abc123..."
  }
}
```

**Error (429 Too Many Requests):**
```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 60
}
```

## Request/Response Headers

### Request Headers

| Header | Required | Description | Example |
|--------|----------|-------------|---------|
| `Content-Type` | Yes | Must be `application/json` | `Content-Type: application/json` |
| `API-TOKEN` | Conditional | Required if `API_TOKEN` env var is set | `API-TOKEN: your-secret-token` |
| `X-Request-ID` | No | Correlation ID for request tracking | `X-Request-ID: req-12345` |
| `X-Correlation-ID` | No | Alternative correlation ID header | `X-Correlation-ID: req-12345` |

### Response Headers

| Header | Description | Example |
|--------|-------------|---------|
| `X-Request-ID` | Correlation ID for request tracking (echoed from request or generated) | `X-Request-ID: req-12345` |
| `X-Response-Time` | Response time in milliseconds | `X-Response-Time: 145ms` |
| `Content-Type` | Response content type (always `application/json`) | `Content-Type: application/json` |
| `Retry-After` | Seconds until rate limit resets (only on 429 responses) | `Retry-After: 60` |

### Header Validation

- **Content-Type**: Must be exactly `application/json` for POST requests
- **API-TOKEN**: Must match `API_TOKEN` environment variable if set
- **X-Request-ID / X-Correlation-ID**: Any string value accepted, used for tracing

#### Streaming Mode (SSE)

To enable Server-Sent Events (SSE) streaming, add `?stream=true` to the query string or include `Accept: text/event-stream` header.

**Streaming Response:**
The response is sent as Server-Sent Events with the following event types:
- `result`: Individual relay publish result
- `progress`: Progress update with completion count
- `complete`: Final outcome with all results
- `error`: Error event if publishing fails

**Example SSE Response:**
```
event: result
data: {"relay":"wss://relay.damus.io","ok":true,"latencyMs":145}

event: progress
data: {"completed":1,"total":2,"successCount":1}

event: result
data: {"relay":"wss://relay.snort.social","ok":true,"latencyMs":203}

event: progress
data: {"completed":2,"total":2,"successCount":2}

event: complete
data: {"results":[...],"status":"success"}
```

**Note:** Replay protection applies to both standard and SSE streaming modes.

#### Limits

- Request size: 1MB maximum
- Relay count: 12 maximum (after normalization)
- Per-relay timeout: 10s (default policy)
- Overall timeout: 15s (default policy)
- Concurrency: 8 concurrent publishes (default policy)
- Replay protection: 24-hour TTL for event IDs

---

### POST /batch

Publishes multiple events to multiple relays in a single request.

#### Request

**Headers:**
- `Content-Type: application/json`
- `API-TOKEN: <token>` (optional)
- `X-Request-ID: <id>` (optional)

**Query Parameters:**
- `policy` (optional): `conservative` | `aggressive` | `default`

**Body:**
```json
{
  "events": [
    {
      "id": "64-character-hex-string-1",
      "pubkey": "64-character-hex-string",
      "kind": 1,
      "created_at": 1234567890,
      "content": "Event 1 content",
      "tags": [],
      "sig": "128-character-hex-signature-1"
    },
    {
      "id": "64-character-hex-string-2",
      "pubkey": "64-character-hex-string",
      "kind": 1,
      "created_at": 1234567891,
      "content": "Event 2 content",
      "tags": [],
      "sig": "128-character-hex-signature-2"
    }
  ],
  "relays": ["wss://relay.damus.io", "wss://relay.snort.social"]
}
```

**Field Descriptions:**
- `events` (required, array): Array of signed Nostr events. Maximum 200 events per batch.
- `relays` (required, array): Array of relay WebSocket URLs. Same rules as `/publish`.

**Note:** Replay protection is checked for all events in the batch. If any event is a replay, the entire batch request is rejected with HTTP 409 Conflict.

#### Response

**Success (200 OK):**
```json
{
  "results": [
    {
      "eventId": "64-character-hex-string-1",
      "outcome": {
        "status": "success",
        "relays": [
          {
            "relay": "wss://relay.damus.io",
            "status": "success",
            "latencyMs": 123
          }
        ]
      }
    },
    {
      "eventId": "64-character-hex-string-2",
      "outcome": {
        "status": "partial",
        "relays": [
          {
            "relay": "wss://relay.damus.io",
            "status": "success",
            "latencyMs": 150
          },
          {
            "relay": "wss://relay.snort.social",
            "status": "failure",
            "reason": "timeout",
            "latencyMs": 10000,
            "error": "TIMEOUT"
          }
        ]
      }
    }
  ],
  "totalEvents": 2,
  "successfulEvents": 1,
  "failedEvents": 1
}
```

**Error (400 Bad Request):**
```json
{
  "error": "Maximum 200 events per batch request, received 250",
  "code": "VALIDATION_ERROR",
  "field": "events"
}
```

#### Limits

- Request size: 10MB maximum
- Event count: 200 events maximum
- Relay count: 12 maximum (after normalization)
- All events published concurrently with concurrency limits applied

---

### POST /profile

Fetches a Nostr profile (kind 0 event) for a given pubkey.

#### Request

**Headers:**
- `Content-Type: application/json`
- `API-TOKEN: <token>` (optional)
- `X-Request-ID: <id>` (optional)

**Body:**
```json
{
  "relays": ["wss://relay.damus.io", "wss://relay.snort.social"],
  "pubkey": "npub1..." // or hex pubkey
}
```

**Field Descriptions:**
- `relays` (required, array): Array of relay WebSocket URLs.
- `pubkey` (required, string): Pubkey in hex or bech32 (npub) format.

#### Response

**Cached (200 OK):**
Returns the cached profile event immediately as a Nostr event JSON object:

```json
{
  "id": "64-character-hex-string",
  "pubkey": "64-character-hex-string",
  "kind": 0,
  "created_at": 1234567890,
  "content": "{\"name\":\"Alice\",\"about\":\"Developer\",\"picture\":\"https://example.com/avatar.jpg\"}",
  "tags": [],
  "sig": "128-character-hex-signature"
}
```

The `content` field contains a JSON string with profile metadata (name, about, picture, etc.).

**Not Cached (202 Accepted):**
Returns empty body. Profile is fetched asynchronously and cached for future requests. Retry the request after a few seconds to get the cached profile.

**Error (400 Bad Request):**
```json
{
  "error": "Invalid pubkey format",
  "code": "VALIDATION_ERROR",
  "field": "pubkey"
}
```

---

### GET /health

Returns health status of all known relays.

#### Request

No body required.

#### Response

**Success (200 OK):**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "relays": [
    {
      "relay": "wss://relay.damus.io",
      "healthy": true,
      "lastChecked": 1234567890,
      "consecutiveFailures": 0
    }
  ]
}
```

---

## Error Codes

| Code | HTTP Status | Description | Troubleshooting | Retry Recommended |
|------|-------------|-------------|-----------------|-------------------|
| `VALIDATION_ERROR` | 400 | Request validation failed | Check request format, required fields, and data types. See error message for specific field issues. | No - fix request first |
| `REPLAY_ERROR` | 409 | Event has already been published | The event ID has been seen within the last 24 hours. Replay protection prevents duplicate publishing. | No - event already published |
| `RATE_LIMIT_EXCEEDED` | 429 | Rate limit exceeded | Wait for rate limit window to reset. Check `Retry-After` header for wait time. | Yes - after waiting |
| `INTERNAL_ERROR` | 500 | Internal server error | Server-side issue. Check worker logs. If persistent, contact support. | Yes - with exponential backoff |
| `CONFIGURATION_ERROR` | 500 | Server configuration error | Worker misconfigured. Check environment variables and KV bindings. | No - requires admin fix |
| `UNKNOWN_ERROR` | 500 | Unexpected error | Unexpected server error. Check logs for details. | Yes - with exponential backoff |

### Error Response Format

All error responses follow this structure:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "field": "field-name",
  "suggestion": "Optional suggestion for fixing the error",
  "details": {
    "additional": "context"
  }
}
```

### Common Validation Errors

**Invalid Event Format:**
```json
{
  "error": "Invalid event: id: Must be 64-character hex string",
  "code": "VALIDATION_ERROR",
  "field": "event.id"
}
```
**Solution**: Ensure event `id` is exactly 64 hexadecimal characters.

**Invalid Relay URL:**
```json
{
  "error": "Invalid relay URL: Must use wss://, ws://, https://, or http:// scheme",
  "code": "VALIDATION_ERROR",
  "field": "relays"
}
```
**Solution**: Use `wss://` scheme for relay URLs.

**Missing Required Field:**
```json
{
  "error": "Invalid publish request: event is required",
  "code": "VALIDATION_ERROR",
  "field": "body"
}
```
**Solution**: Include all required fields in request body.

**Replay Protection Error:**
```json
{
  "error": "Event abc123... has already been published. Replay protection prevents duplicate publishing.",
  "code": "REPLAY_ERROR",
  "details": {
    "eventId": "abc123..."
  }
}
```
**Solution**: The event has already been published within the last 24 hours. Replay protection prevents duplicate publishing to prevent abuse. If you need to republish, wait 24 hours or use a different event ID.

### Replay Protection

The service implements replay protection to prevent duplicate event publishing:

- **TTL**: Event IDs are tracked for 24 hours
- **Storage**: Uses Cloudflare KV (reuses PROFILES namespace)
- **Scope**: Applied to standard publish, SSE streaming, and batch requests
- **Response**: HTTP 409 Conflict for replay attempts
- **Thread-Safe**: Uses KV atomic operations to handle concurrent requests

**How It Works:**
1. Before publishing, the service checks if the event ID exists in KV
2. If found, the request is rejected with HTTP 409 Conflict
3. If not found, the event ID is recorded with a 24-hour TTL
4. After 24 hours, the record expires and the event can be published again

**Note**: Replay protection uses a fail-open design. If KV operations fail, publishing continues to prevent blocking all publishing if KV is temporarily unavailable.

### Rate Limiting

When rate limit is exceeded, the response includes a `Retry-After` header:

```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 60
}
```

**Headers:**
- `Retry-After: 60` - Seconds until rate limit resets

**Handling**: Wait for the specified time before retrying, or implement exponential backoff.

## Policies

Policies control retry behavior, timeouts, and concurrency for publishing operations. Select a policy via the `policy` query parameter.

### Policy Comparison

| Setting | Default | Conservative | Aggressive |
|---------|---------|--------------|-----------|
| **Concurrency** | 8 | 4 | 12 |
| **Per-relay timeout** | 10s | 20s | 5s |
| **Connection timeout** | 5s | 10s | 2s |
| **Overall timeout** | 15s | 30s | 10s |
| **Retry attempts** | 1 | 2 | 0 |
| **Backoff delay** | 1000ms | 2000ms | 500ms |
| **Min success relays** | 1 | 2 | 1 |

### When to Use Each Policy

**Default Policy** (Recommended for most use cases)
- Balanced approach between speed and reliability
- Good for general-purpose event publishing
- Use when: You need reliable delivery but don't want to wait too long

**Conservative Policy** (Maximum reliability)
- More retries and longer timeouts
- Requires at least 2 successful relays
- Use when:
  - Publishing critical events (financial transactions, important announcements)
  - Relays are known to be unreliable
  - You prioritize delivery over speed

**Aggressive Policy** (Maximum speed)
- No retries, fast timeouts
- Higher concurrency for throughput
- Use when:
  - Publishing high-volume, non-critical events (social media posts, status updates)
  - Relays are known to be reliable
  - You prioritize speed over guaranteed delivery

### Policy Details

#### Default Policy
- **Concurrency**: 8 concurrent publishes
- **Per-relay timeout**: 10 seconds
- **Connection timeout**: 5 seconds
- **Overall timeout**: 15 seconds
- **Retries**: 1 attempt
- **Backoff**: 1000ms exponential backoff
- **Min success relays**: 1

#### Conservative Policy
- **Concurrency**: 4 concurrent publishes
- **Per-relay timeout**: 20 seconds
- **Connection timeout**: 10 seconds
- **Overall timeout**: 30 seconds
- **Retries**: 2 attempts
- **Backoff**: 2000ms exponential backoff
- **Min success relays**: 2

#### Aggressive Policy
- **Concurrency**: 12 concurrent publishes
- **Per-relay timeout**: 5 seconds
- **Connection timeout**: 2 seconds
- **Overall timeout**: 10 seconds
- **Retries**: 0 attempts (no retries)
- **Backoff**: 500ms (not used, no retries)
- **Min success relays**: 1

## Rate Limiting

Rate limiting is applied per client identifier (IP address or API token).

**Default Limits:**
- 100 requests per 60 seconds (1 minute window)

**Headers:**
- `Retry-After`: Seconds until rate limit resets (on 429 responses)

## CORS

If `CORS_ENABLED=true` and `CORS_ORIGINS` is configured:

**Allowed Methods:** GET, POST, OPTIONS

**Allowed Headers:** Content-Type, API-TOKEN, X-Correlation-ID, X-Request-ID

**Exposed Headers:** X-Request-ID, X-Response-Time

## Examples

### Publish Event

**Basic Request:**
```bash
curl -X POST https://your-worker.workers.dev/publish \
  -H "Content-Type: application/json" \
  -H "API-TOKEN: your-secret-token" \
  -H "X-Request-ID: req-12345" \
  -d '{
    "relays": ["wss://relay.damus.io", "wss://relay.snort.social"],
    "event": {
      "id": "a1b2c3d4e5f6789012345678901234567890123456789012345678901234567890",
      "pubkey": "b2c3d4e5f6789012345678901234567890123456789012345678901234567890ab",
      "kind": 1,
      "created_at": 1704067200,
      "content": "Hello Nostr! This is my first post.",
      "tags": [],
      "sig": "c3d4e5f6789012345678901234567890123456789012345678901234567890abcdef123456789012345678901234567890123456789012345678901234567890"
    },
    "correlationId": "my-correlation-id-123"
  }'
```

**Success Response:**
```json
{
  "results": [
    {
      "relay": "wss://relay.damus.io",
      "ok": true,
      "latencyMs": 145
    },
    {
      "relay": "wss://relay.snort.social",
      "ok": true,
      "latencyMs": 203
    }
  ]
}
```

**Partial Success Response:**
```json
{
  "results": [
    {
      "relay": "wss://relay.damus.io",
      "ok": true,
      "latencyMs": 145
    },
    {
      "relay": "wss://relay.snort.social",
      "ok": false,
      "latencyMs": 10000,
      "error": "TIMEOUT"
    }
  ]
}
```

### Batch Publish

**Request:**
```bash
curl -X POST "https://your-worker.workers.dev/batch?policy=conservative" \
  -H "Content-Type: application/json" \
  -H "API-TOKEN: your-secret-token" \
  -d '{
    "events": [
      {
        "id": "event-id-1-hex-64-chars",
        "pubkey": "pubkey-hex-64-chars",
        "kind": 1,
        "created_at": 1704067200,
        "content": "Event 1 content",
        "tags": [],
        "sig": "signature-hex-128-chars"
      },
      {
        "id": "event-id-2-hex-64-chars",
        "pubkey": "pubkey-hex-64-chars",
        "kind": 1,
        "created_at": 1704067201,
        "content": "Event 2 content",
        "tags": [],
        "sig": "signature-hex-128-chars"
      }
    ],
    "relays": ["wss://relay.damus.io", "wss://relay.snort.social"]
  }'
```

**Response:**
```json
{
  "results": [
    {
      "eventId": "event-id-1-hex-64-chars",
      "outcome": {
        "status": "success",
        "relays": [
          {
            "relay": "wss://relay.damus.io",
            "status": "success",
            "latencyMs": 150
          },
          {
            "relay": "wss://relay.snort.social",
            "status": "success",
            "latencyMs": 180
          }
        ]
      }
    },
    {
      "eventId": "event-id-2-hex-64-chars",
      "outcome": {
        "status": "partial",
        "relays": [
          {
            "relay": "wss://relay.damus.io",
            "status": "success",
            "latencyMs": 155
          },
          {
            "relay": "wss://relay.snort.social",
            "status": "failure",
            "reason": "timeout",
            "latencyMs": 20000,
            "error": "TIMEOUT"
          }
        ]
      }
    }
  ],
  "totalEvents": 2,
  "successfulEvents": 1,
  "failedEvents": 0
}
```

### Fetch Profile

**Request:**
```bash
curl -X POST https://your-worker.workers.dev/profile \
  -H "Content-Type: application/json" \
  -H "API-TOKEN: your-secret-token" \
  -d '{
    "relays": ["wss://relay.damus.io", "wss://relay.snort.social"],
    "pubkey": "npub1abc123def456..."
  }'
```

**Cached Response (200 OK):**
```json
{
  "id": "profile-event-id-hex-64-chars",
  "pubkey": "pubkey-hex-64-chars",
  "kind": 0,
  "created_at": 1704067200,
  "content": "{\"name\":\"Alice\",\"about\":\"Developer\",\"picture\":\"https://example.com/avatar.jpg\"}",
  "tags": [],
  "sig": "signature-hex-128-chars"
}
```

**Not Cached Response (202 Accepted):**
Empty body. Profile is being fetched asynchronously.

### Health Check

**Request:**
```bash
curl https://your-worker.workers.dev/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "relays": [
    {
      "relay": "wss://relay.damus.io",
      "healthy": true,
      "lastChecked": 1704067200000,
      "consecutiveFailures": 0
    },
    {
      "relay": "wss://relay.snort.social",
      "healthy": false,
      "lastChecked": 1704067100000,
      "consecutiveFailures": 3
    }
  ]
}
```
