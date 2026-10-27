import { handleRequest } from '../server.js';

export default async function handler(request, response) {
  if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET || !process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ error: 'RouteMark needs its admin password, session secret, and Redis storage configured.' }));
    return;
  }

  const url = new URL(request.url, `https://${request.headers.host || 'localhost'}`);
  const route = url.searchParams.get('__route');
  if (!route || !/^\/(?:api|r)\/[A-Za-z0-9_/-]*$/.test(route)) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found.');
    return;
  }
  url.pathname = route;
  url.searchParams.delete('__route');
  await handleRequest(request, response, url);
}
