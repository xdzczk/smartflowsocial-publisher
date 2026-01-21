import type { Request, ExecutionContext } from '@cloudflare/workers-types';
import type { Event } from 'nostr-tools';
import { relayInit } from 'nostr-tools';
import { cleanURLs } from './utils';
import type { Env, PublishRequest } from './types';

export const publishEvent = async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
  let body: unknown;
  try {
    body = await request.json();
  } catch (e) {
    return new Response('INVALID_REQUEST', { status: 400 });
  }

  if (!body || typeof body !== 'object' || !('relays' in body) || !Array.isArray((body as PublishRequest).relays)) {
    return new Response('INVALID_REQUEST', { status: 422 });
  }

  const publishRequest = body as PublishRequest;
  const relayUrls = cleanURLs(publishRequest.relays);
  const event = publishRequest.event;

  if (!relayUrls || relayUrls.length === 0 || !event) {
    return new Response('INVALID_REQUEST', { status: 422 });
  }

  const eventId = event.id || 'unknown';
  console.info(`Processing ${eventId}`);

  const publishToRelay = async (url: string): Promise<void> => {
    return new Promise((resolve) => {
      const relay = relayInit(url);
      const timeout = 5000;

      function timeoutAndClose() {
        console.error(`Timeout error: event ${eventId} relay ${url}`);
        relay.close();
        resolve();
      }
      const timeoutCheck = setTimeout(timeoutAndClose, timeout);

      relay.on('connect', () => {
        console.info(`Sending ${eventId} to ${url}`);
        const pub = relay.publish(event);
        pub.on('ok', () => {
          console.info(`Event ${eventId} published to ${url}`);
          relay.close();
          clearTimeout(timeoutCheck);
          resolve();
        });
        pub.on('failed', (reason?: string) => {
          console.warn(`Failed to publish ${eventId} to ${url}: ${reason}`)
          relay.close();
          clearTimeout(timeoutCheck);
          resolve();
        })
      });

      relay.on('error', (msg: unknown) => {
        console.error(`Failed to connect to ${url}`, JSON.stringify(msg));
        clearTimeout(timeoutCheck);
        relay.close();
        resolve();
      });

      relay.connect();
    });
  };

  const promises = relayUrls.map(url => publishToRelay(url));

  ctx.waitUntil(Promise.all(promises));

  return new Response('OK');
};
