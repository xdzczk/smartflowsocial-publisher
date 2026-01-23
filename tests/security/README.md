# Security Test Suite

This directory contains security-focused tests that validate the application's security features and protections against common attack vectors.

## Test Coverage

### Input Validation (`input-validation.test.ts`)
- Required field validation
- Type validation
- Format validation
- String length limits
- Array size limits
- UTF-8 encoding validation

### Authentication (`authentication.test.ts`)
- API token validation
- Missing token handling
- Invalid token handling
- Token case sensitivity
- Health endpoint exemption

### Rate Limiting (`rate-limiting.test.ts`)
- Sliding window algorithm
- Request counting
- Window reset behavior
- Retry-After header
- Per-client tracking (IP and API token)

### Replay Protection (`replay-protection.test.ts`)
- Event ID tracking
- Duplicate detection
- TTL expiration
- Race condition handling
- Fail-open behavior

### XSS Prevention (`xss-prevention.test.ts`)
- Content sanitization
- HTML entity encoding
- Script tag detection
- Event handler prevention
- UTF-8 validation

### Request Size Limits (`request-size-limits.test.ts`)
- Single request size limits (1MB)
- Batch request size limits (10MB)
- Early rejection
- Clear error messages
- DoS prevention

## Running Security Tests

```bash
# Run all security tests
pnpm test:security

# Run specific test file
pnpm test tests/security/input-validation.test.ts
```

## Security Guarantees

These tests validate that the application:

1. **Prevents unauthorized access** via API token authentication
2. **Prevents DoS attacks** via request size limits and rate limiting
3. **Prevents replay attacks** via event ID tracking
4. **Prevents XSS attacks** via content sanitization
5. **Validates all input** at multiple layers
6. **Handles edge cases** gracefully without exposing vulnerabilities

## Adding New Security Tests

When adding new security features:

1. Create a new test file in this directory
2. Follow the existing test patterns
3. Document the security guarantee being tested
4. Include edge cases and attack vectors
5. Update this README with the new test coverage
