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

**Notes:**
- Relay URLs are normalized: `wss://` scheme enforced, whitespace trimmed, trailing slashes removed, deduplicated, capped at 12 relays.
- Per-relay timeout: ~3000ms
- Overall request timeout: 5000ms hard cap
- Concurrency limit: 8 concurrent publishes
- Results are returned even if some relays fail (as long as request is valid).

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

## Deployment

Refer to the [Cloudflare docs](https://developers.cloudflare.com/workers/get-started/guide/) Learn more about Cloudflare workers and how to publish workers

```
$ wrangler publish
```

## Development

```
$ wrangler dev
```
