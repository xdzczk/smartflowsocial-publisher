# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Batch publishing endpoint (`/batch`) for publishing multiple events in a single request
- CORS support with configurable allowed origins via environment variables
- Environment variable validation on startup
- Request size validation using actual body content (more secure than Content-Length header)
- Batch size limit validation (200 events maximum per batch request)
- Response headers: `X-Request-ID` and `X-Response-Time` for all responses
- Metrics export interface for integration with Cloudflare Analytics
- Timeout warnings when operations approach Cloudflare Workers 30s limit
- Comprehensive API documentation (`docs/API.md`)
- Architecture documentation (`docs/ARCHITECTURE.md`)
- Environment variable example file (`.env.example`)

### Changed

- Standardized all error responses to use consistent `mapErrorToResponse` function
- Improved request size validation to use actual body streaming instead of Content-Length header
- Enhanced error responses with correlation IDs and structured error codes
- Updated README with batch endpoint documentation and query parameter details

### Fixed

- Circuit breaker state persistence across tests (now resets between tests)
- Error classification order to correctly identify rejected vs timeout errors
- Valibot validation error field detection for nested array paths
- All test failures (154 tests now passing)

### Security

- Improved request size validation prevents Content-Length header spoofing
- Input sanitization for event content and tags
- Rate limiting per IP/API token
- API token authentication support

## [0.0.0] - Initial Release

### Added

- HTTP to Nostr relay publishing via Cloudflare Workers
- Profile fetching with KV caching
- Circuit breaker pattern for relay failures
- Health check system for relay monitoring
- Retry logic with exponential backoff
- Concurrency control for relay operations
- Comprehensive test suite (154 tests)
- Valibot schema validation
- Structured error handling
- Observability (logging, metrics, tracing interfaces)
