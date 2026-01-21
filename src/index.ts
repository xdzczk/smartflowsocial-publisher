import type { ExportedHandler } from '@cloudflare/workers-types';
import { getProfile } from './getProfile';
import { publishEvent } from './publishEvent';
import type { Env } from './types';

const handler: ExportedHandler<Env> = {
  async fetch(request, env, ctx) {
    const pathname = (new URL(request.url)).pathname;

    const apiToken = request.headers.get('API-TOKEN');
    if (apiToken !== env.API_TOKEN && env.API_TOKEN) {
      return new Response('INVALID_TOKEN', { status: 403 });
    }
    if (request.method !== "POST") {
      return new Response('Sooner and later you will see great changes made.', { status: 404 });
    }

    if (pathname === "/" || pathname === "/publish") {
      try {
        return await publishEvent(request, env, ctx);
      } catch (e) {
        console.error('Error in publishEvent:', e);
        return new Response('Internal Server Error', { status: 500 });
      }
    } else if (pathname === "/profile") {
      try {
        return await getProfile(request, env, ctx);
      } catch (e) {
        console.error('Error in getProfile:', e);
        return new Response('Internal Server Error', { status: 500 });
      }
    } else {
      return new Response('Endpoint does not exist', { status: 404 });
    }
  },
};

export default handler;
