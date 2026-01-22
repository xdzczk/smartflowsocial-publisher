# API Specification

Complete API reference for the HTTP to Nostr Publisher service.

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
  "correlationId": "optional-correlation-id",
  "returnPerRelayResults": true
}
```

**Field Descriptions:**
- `relays` (required, array): Array of relay WebSocket URLs. Maximum 12 relays. URLs are normalized (trimmed, deduplicated, `wss://` scheme enforced).
- `event` (required, object): Signed Nostr event. Must include `id`, `pubkey`, `kind`, `sig`, `created_at`, `content`, `tags`.
- `correlationId` (optional, string): Correlation ID for request tracking.
- `returnPerRelayResults` (optional, boolean): Whether to return per-relay results (default: `true`).

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

**Error (429 Too Many Requests):**
```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 60
}
```

**Response Headers:**
- `X-Request-ID`: Correlation ID for request tracking
- `X-Response-Time`: Response time in milliseconds

#### Limits

- Request size: 1MB maximum
- Relay count: 12 maximum (after normalization)
- Per-relay timeout: 10s (default policy)
- Overall timeout: 15s (default policy)
- Concurrency: 8 concurrent publishes (default policy)

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
Returns the cached profile event immediately.

**Not Cached (202 Accepted):**
Returns empty body. Profile is fetched asynchronously and cached for future requests.

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

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request validation failed |
| `RATE_LIMIT_EXCEEDED` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Internal server error |
| `CONFIGURATION_ERROR` | 500 | Server configuration error |
| `UNKNOWN_ERROR` | 500 | Unexpected error |

## Policies

### Default Policy
- Concurrency: 8
- Per-relay timeout: 10s
- Connection timeout: 5s
- Overall timeout: 15s
- Retries: 1 attempt
- Backoff: 1000ms

### Conservative Policy
- Concurrency: 4
- Per-relay timeout: 20s
- Connection timeout: 10s
- Overall timeout: 30s
- Retries: 2 attempts
- Backoff: 2000ms

### Aggressive Policy
- Concurrency: 12
- Per-relay timeout: 5s
- Connection timeout: 2s
- Overall timeout: 10s
- Retries: 0 attempts
- Backoff: 500ms

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

```bash
curl -X POST https://your-worker.workers.dev/publish \
  -H "Content-Type: application/json" \
  -H "API-TOKEN: your-token" \
  -d '{
    "relays": ["wss://relay.damus.io"],
    "event": {
      "id": "a".repeat(64),
      "pubkey": "b".repeat(64),
      "kind": 1,
      "created_at": 1234567890,
      "content": "Hello Nostr!",
      "tags": [],
      "sig": "c".repeat(128)
    }
  }'
```

### Batch Publish

```bash
curl -X POST https://your-worker.workers.dev/batch?policy=conservative \
  -H "Content-Type: application/json" \
  -d '{
    "events": [/* array of events */],
    "relays": ["wss://relay.damus.io"]
  }'
```

### Fetch Profile

```bash
curl -X POST https://your-worker.workers.dev/profile \
  -H "Content-Type: application/json" \
  -d '{
    "relays": ["wss://relay.damus.io"],
    "pubkey": "npub1..."
  }'
```
