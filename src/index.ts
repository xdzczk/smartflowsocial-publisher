import type { ExportedHandler } from '@cloudflare/workers-types';

import { ConsoleLogger } from './observability/logger';
import { profileHandler, publishHandler } from './transport/http/handlers';
import type { Env } from './types';

const handler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const logger = new ConsoleLogger();
    const pathname = new URL(request.url).pathname;

    // Auth check
    const apiToken = request.headers.get('API-TOKEN');
    if (apiToken !== env.API_TOKEN && env.API_TOKEN) {
      return new Response('INVALID_TOKEN', { status: 403 });
    }

    // Only POST allowed
    if (request.method !== 'POST') {
      return new Response('Sooner and later you will see great changes made.', { status: 404 });
    }

    // Route to handlers
    if (pathname === '/' || pathname === '/publish') {
      try {
        return await publishHandler(request, env, ctx);
      } catch (e) {
        logger.error('Error in publishHandler:', e);
        return new Response('Internal Server Error', { status: 500 });
      }
    } else if (pathname === '/profile') {
      try {
        return await profileHandler(request, env, ctx);
      } catch (e) {
        logger.error('Error in profileHandler:', e);
        return new Response('Internal Server Error', { status: 500 });
      }
    } else {
      return new Response('Endpoint does not exist', { status: 404 });
    }
  },
};

export default handler;
