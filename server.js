import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(process.env.ROUTEMARK_DATA_DIR || path.join(directory, 'data'));
const storePath = path.join(dataDirectory, 'store.json');
const port = Number(process.env.PORT || 4174);
const host = process.env.HOST || '127.0.0.1';
const adminPassword = process.env.ADMIN_PASSWORD || '';
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(32);
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || '';
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const redisEnabled = Boolean(redisUrl && redisToken);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

let store;
let writeQueue = Promise.resolve();

async function redisRequest(command, transaction = false) {
  const response = await fetch(`${redisUrl.replace(/\/+$/, '')}${transaction ? '/multi-exec' : ''}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`Storage request failed (${response.status}).`);
  const result = await response.json();
  if (result.error || (Array.isArray(result) && result.some((item) => item.error))) {
    throw new Error('Storage command failed.');
  }
  return transaction ? result.map((item) => item.result) : result.result;
}

const defaultStore = () => ({ version: 1, settings: { publicBaseUrl: '' }, campaigns: [] });

async function loadStore() {
  if (redisEnabled) {
    const raw = await redisRequest(['GET', 'routemark:store']);
    const currentStore = raw ? JSON.parse(raw) : defaultStore();
    currentStore.settings ||= { publicBaseUrl: '' };
    currentStore.campaigns ||= [];
    return currentStore;
  }
  if (store) return store;
  await fs.mkdir(dataDirectory, { recursive: true });
  try {
    store = JSON.parse(await fs.readFile(storePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    store = defaultStore();
    await persistStore(store);
  }
  store.settings ||= { publicBaseUrl: '' };
  store.campaigns ||= [];
  return store;
}

function persistStore(currentStore) {
  const snapshot = JSON.stringify(currentStore, null, 2);
  if (redisEnabled) return redisRequest(['SET', 'routemark:store', snapshot]);
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    await fs.mkdir(dataDirectory, { recursive: true });
    const tempPath = `${storePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, snapshot, 'utf8');
    await fs.rename(tempPath, storePath);
  });
  return writeQueue;
}

async function hydrateVisits(currentStore) {
  if (!redisEnabled) return;
  await Promise.all(currentStore.campaigns.map(async (campaign) => {
    const fields = await redisRequest(['HGETALL', `routemark:visits:${campaign.id}`]);
    if (!fields) return;
    const values = Object.fromEntries(Array.from({ length: fields.length / 2 }, (_, index) => [fields[index * 2], fields[index * 2 + 1]]));
    campaign.totalVisits = Number(values.total || 0);
    campaign.lastVisitedAt = values.last || null;
    campaign.visitsByDay = Object.fromEntries(Object.entries(values).filter(([key]) => /^\d{4}-\d{2}-\d{2}$/.test(key)).map(([key, value]) => [key, Number(value)]));
  }));
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(payload));
}

function cookieValue(request, name) {
  const cookies = String(request.headers.cookie || '').split(';');
  const entry = cookies.map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!entry) return '';
  try { return decodeURIComponent(entry.slice(name.length + 1)); } catch { return ''; }
}

function isAuthenticated(request) {
  if (!adminPassword) return true;
  const token = cookieValue(request, 'route_session');
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).exp > Date.now(); } catch { return false; }
}

function matchesPassword(candidate) {
  const candidateBytes = Buffer.from(String(candidate || ''));
  const passwordBytes = Buffer.from(adminPassword);
  return candidateBytes.length === passwordBytes.length && crypto.timingSafeEqual(candidateBytes, passwordBytes);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 });
  }
}

function validateCampaign(input, current = {}) {
  const name = String(input.name ?? current.name ?? '').trim();
  const destinationUrl = String(input.destinationUrl ?? current.destinationUrl ?? '').trim();
  const description = String(input.description ?? current.description ?? '').trim();
  if (!name || name.length > 80) {
    throw Object.assign(new Error('Name is required and must be 80 characters or fewer.'), { status: 400 });
  }
  if (!destinationUrl || destinationUrl.length > 4096) {
    throw Object.assign(new Error('Enter a destination URL under 4,096 characters.'), { status: 400 });
  }
  let parsed;
  try {
    parsed = new URL(destinationUrl);
  } catch {
    throw Object.assign(new Error('Enter a complete URL, including https:// or http://.'), { status: 400 });
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw Object.assign(new Error('Use a valid http:// or https:// destination URL.'), { status: 400 });
  }
  if (description.length > 300) {
    throw Object.assign(new Error('Description must be 300 characters or fewer.'), { status: 400 });
  }
  return { name, destinationUrl: parsed.toString(), description };
}

function createSlug(campaigns) {
  let slug;
  do {
    slug = crypto.randomBytes(6).toString('base64url').slice(0, 8);
  } while (campaigns.some((campaign) => campaign.slug === slug));
  return slug;
}

function dateKeyInZone(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const fields = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function dashboardData(currentStore) {
  const timeZone = currentStore.settings.timeZone || 'UTC';
  const [year, month, day] = dateKeyInZone(new Date(), timeZone).split('-').map(Number);
  const today = new Date(Date.UTC(year, month - 1, day));
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (6 - offset));
    const key = date.toISOString().slice(0, 10);
    return {
      date: key,
      label: new Intl.DateTimeFormat('en', { weekday: 'short', timeZone }).format(new Date(`${key}T12:00:00.000Z`)),
      visits: currentStore.campaigns.reduce((sum, campaign) => sum + (campaign.visitsByDay?.[key] || 0), 0),
    };
  });
  return {
    campaigns: [...currentStore.campaigns].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    settings: currentStore.settings,
    stats: {
      totalVisits: currentStore.campaigns.reduce((sum, campaign) => sum + campaign.totalVisits, 0),
      activeCodes: currentStore.campaigns.filter((campaign) => campaign.active).length,
      days,
    },
  };
}

async function handleApi(request, response, url) {
  const currentStore = await loadStore();
  const pathname = url.pathname;

  if (request.method === 'GET' && pathname === '/api/auth') {
    return sendJson(response, 200, { required: Boolean(adminPassword), authenticated: isAuthenticated(request) });
  }

  if (request.method === 'POST' && pathname === '/api/login') {
    const body = await readJson(request);
    if (!adminPassword || !matchesPassword(body.password)) return sendJson(response, 401, { error: 'Password is incorrect.' });
    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 24 * 60 * 60 * 1000, nonce: crypto.randomBytes(12).toString('base64url') })).toString('base64url');
    const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
    const secure = request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    response.setHeader('Set-Cookie', `route_session=${encodeURIComponent(`${payload}.${signature}`)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure}`);
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === 'POST' && pathname === '/api/logout') {
    response.setHeader('Set-Cookie', 'route_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return sendJson(response, 200, { ok: true });
  }

  if (adminPassword && !isAuthenticated(request)) {
    return sendJson(response, 401, { error: 'Please sign in to manage QR codes.' });
  }

  if (request.method === 'GET' && pathname === '/api/dashboard') {
    const requestedZone = String(request.headers['x-time-zone'] || '').trim();
    if (requestedZone && requestedZone.length <= 64 && requestedZone !== currentStore.settings.timeZone) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: requestedZone });
        currentStore.settings.timeZone = requestedZone;
        await persistStore(currentStore);
      } catch { /* Ignore unrecognized browser time-zone identifiers. */ }
    }
    await hydrateVisits(currentStore);
    return sendJson(response, 200, dashboardData(currentStore));
  }

  if (request.method === 'PUT' && pathname === '/api/settings') {
    const body = await readJson(request);
    const publicBaseUrl = String(body.publicBaseUrl ?? '').trim().replace(/\/+$/, '');
    if (publicBaseUrl) {
      let parsed;
      try { parsed = new URL(publicBaseUrl); } catch {
        throw Object.assign(new Error('Enter a valid base URL.'), { status: 400 });
      }
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname !== '/' || parsed.search || parsed.hash) {
        throw Object.assign(new Error('Use an http:// or https:// base address without a path, query, or fragment.'), { status: 400 });
      }
      if (Buffer.byteLength(parsed.origin) > 95) {
        throw Object.assign(new Error('Public base URL must be 95 characters or fewer so its tracked links fit in a QR code.'), { status: 400 });
      }
      currentStore.settings.publicBaseUrl = parsed.origin;
    } else {
      currentStore.settings.publicBaseUrl = '';
    }
    await persistStore(currentStore);
    return sendJson(response, 200, { settings: currentStore.settings });
  }

  if (request.method === 'POST' && pathname === '/api/campaigns') {
    const body = await readJson(request);
    const campaignFields = validateCampaign(body);
    const campaign = {
      id: crypto.randomUUID(),
      slug: createSlug(currentStore.campaigns),
      ...campaignFields,
      createdAt: new Date().toISOString(),
      lastVisitedAt: null,
      totalVisits: 0,
      visitsByDay: {},
      active: true,
    };
    currentStore.campaigns.push(campaign);
    await persistStore(currentStore);
    return sendJson(response, 201, { campaign });
  }

  const campaignMatch = pathname.match(/^\/api\/campaigns\/([0-9a-f-]{36})$/i);
  if (campaignMatch && request.method === 'PATCH') {
    const campaign = currentStore.campaigns.find((item) => item.id === campaignMatch[1]);
    if (!campaign) return sendJson(response, 404, { error: 'Campaign not found.' });
    const body = await readJson(request);
    if (Object.hasOwn(body, 'name') || Object.hasOwn(body, 'destinationUrl') || Object.hasOwn(body, 'description')) {
      Object.assign(campaign, validateCampaign(body, campaign));
    }
    if (Object.hasOwn(body, 'active')) campaign.active = Boolean(body.active);
    await persistStore(currentStore);
    return sendJson(response, 200, { campaign });
  }

  if (campaignMatch && request.method === 'DELETE') {
    const index = currentStore.campaigns.findIndex((item) => item.id === campaignMatch[1]);
    if (index === -1) return sendJson(response, 404, { error: 'Campaign not found.' });
    currentStore.campaigns.splice(index, 1);
    await persistStore(currentStore);
    return sendJson(response, 200, { ok: true });
  }

  return sendJson(response, 404, { error: 'Not found.' });
}

async function handleRedirect(request, response, url) {
  if (request.method !== 'GET') {
    response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET', 'Cache-Control': 'no-store' });
    response.end('Method not allowed.');
    return;
  }
  const match = url.pathname.match(/^\/r\/([A-Za-z0-9_-]{8})\/?$/);
  if (!match) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('QR code not found.');
    return;
  }
  const currentStore = await loadStore();
  const campaign = currentStore.campaigns.find((item) => item.slug === match[1]);
  if (!campaign) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('QR code not found.');
    return;
  }
  if (!campaign.active) {
    response.writeHead(410, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('This QR code is paused by its owner.');
    return;
  }
  const today = dateKeyInZone(new Date(), currentStore.settings.timeZone || 'UTC');
  if (redisEnabled) {
    const key = `routemark:visits:${campaign.id}`;
    await redisRequest([
      ['HINCRBY', key, 'total', 1],
      ['HINCRBY', key, today, 1],
      ['HSET', key, 'last', new Date().toISOString()],
    ], true);
  } else {
    campaign.totalVisits += 1;
    campaign.visitsByDay[today] = (campaign.visitsByDay[today] || 0) + 1;
    campaign.lastVisitedAt = new Date().toISOString();
    await persistStore(currentStore);
  }
  response.writeHead(302, {
    Location: campaign.destinationUrl,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  });
  response.end();
}

async function serveStatic(request, response, url) {
  const distDirectory = path.join(directory, 'public');
  const requestedPath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const candidate = path.resolve(distDirectory, `.${requestedPath}`);
  if (!candidate.startsWith(`${distDirectory}${path.sep}`) && candidate !== path.join(distDirectory, 'index.html')) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  let filePath = candidate;
  try {
    const info = await fs.stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    filePath = path.join(distDirectory, 'index.html');
  }
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    });
    response.end(content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('RouteMark web assets could not be found. Check that public/index.html exists.');
  }
}

export async function handleRequest(request, response, overrideUrl) {
  try {
    const url = overrideUrl || new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url);
    if (url.pathname.startsWith('/r/')) return await handleRedirect(request, response, url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return sendJson(response, 405, { error: 'Method not allowed.' });
    }
    return await serveStatic(request, response, url);
  } catch (error) {
    if (!response.headersSent) {
      sendJson(response, error.status || 500, { error: error.status ? error.message : 'Something went wrong.' });
    } else {
      response.end();
    }
    if (!error.status) console.error(error);
  }
}

if (!process.env.VERCEL) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !adminPassword) {
    console.error('Set ADMIN_PASSWORD before binding RouteMark to a network address.');
    process.exit(1);
  }
  const server = http.createServer(handleRequest);
  server.listen(port, host, () => {
    console.log(`RouteMark server listening at http://${host}:${port}`);
  });
}
