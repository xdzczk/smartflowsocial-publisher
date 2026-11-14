import type { Env } from '../types';

function tokensEqual(provided: string, expected: string): boolean {
  if (provided.length === 0 || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Private by default. Publish routes require API_TOKEN unless
 * ALLOW_UNAUTHENTICATED_PUBLISH=true. GET /health stays open for probes.
 * Returns a 403 response when the caller must be rejected.
 */
export function authorizePublisherRequest(
  request: Request,
  env: Env,
  pathname: string
): Response | null {
  if (pathname === '/health' && request.method === 'GET') return null;

  const allowPublic = env.ALLOW_UNAUTHENTICATED_PUBLISH === 'true';
  const expected = env.API_TOKEN?.trim() ?? '';
  if (!expected) {
    if (allowPublic) return null;
    return new Response('INVALID_TOKEN', { status: 403 });
  }

  const provided = request.headers.get('API-TOKEN')?.trim() ?? '';
  if (!tokensEqual(provided, expected)) {
    return new Response('INVALID_TOKEN', { status: 403 });
  }
  return null;
}
