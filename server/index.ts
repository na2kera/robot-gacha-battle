/**
 * Worker ルータ。/api/* を処理し、ルームの操作は GameRoom Durable Object へ転送する。
 * それ以外のパスは Static Assets が処理する（wrangler.jsonc の run_worker_first）。
 */
import { validatePlayerName, type CreateRoomResponse } from '../shared/protocol';
import { MAX_HTTP_BODY_CHARS, ROOM_CREATE_ATTEMPTS } from './constants';
import { generateRoomCode, normalizeRoomCode } from './random';

export { GameRoom } from './game-room';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** 既存のレスポンス（DO からのもの）に no-store を付ける。WebSocket の 101 はそのまま返す */
function withNoStore(res: Response): Response {
  if (res.status === 101) return res;
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function roomStub(env: Env, code: string): DurableObjectStub<import('./game-room').GameRoom> {
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code), { locationHint: 'apac-ne' });
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'local';
}

async function rateLimited(request: Request, env: Env): Promise<boolean> {
  const { success } = await env.ROOM_API_LIMITER.limit({ key: clientIp(request) });
  return !success;
}

/** body の name を検証する。JSON 不正は invalid_request、名前不正は invalid_name */
async function readName(
  request: Request,
): Promise<{ ok: true; name: string } | { ok: false; res: Response }> {
  const text = await request.text();
  if (text.length > MAX_HTTP_BODY_CHARS) {
    return { ok: false, res: json({ error: 'invalid_request' }, 400) };
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, res: json({ error: 'invalid_request' }, 400) };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, res: json({ error: 'invalid_request' }, 400) };
  }
  const name = validatePlayerName((body as Record<string, unknown>).name);
  if (name === null) return { ok: false, res: json({ error: 'invalid_name' }, 400) };
  return { ok: true, name };
}

function joinResponse(
  url: URL,
  roomCode: string,
  playerId: string,
  sessionToken: string,
): CreateRoomResponse {
  return { roomCode, playerId, sessionToken, shareUrl: `${url.origin}/?room=${roomCode}` };
}

function isAllowedOrigin(request: Request, url: URL, env: Env): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  if (origin === url.origin) return true;
  const extra = (env.EXTRA_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return extra.includes(origin);
}

async function createRoom(request: Request, env: Env, url: URL): Promise<Response> {
  if (await rateLimited(request, env)) return json({ error: 'rate_limited' }, 429);
  const parsed = await readName(request);
  if (!parsed.ok) return parsed.res;
  for (let attempt = 0; attempt < ROOM_CREATE_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    const outcome = await roomStub(env, code).create(code, parsed.name);
    if (outcome.ok) {
      return json(joinResponse(url, code, outcome.playerId, outcome.sessionToken), 201);
    }
    console.log('room code collision, retry');
  }
  return json({ error: 'internal' }, 503);
}

async function joinRoom(request: Request, env: Env, url: URL, code: string): Promise<Response> {
  if (await rateLimited(request, env)) return json({ error: 'rate_limited' }, 429);
  const parsed = await readName(request);
  if (!parsed.ok) return parsed.res;
  const outcome = await roomStub(env, code).join(parsed.name);
  if (!outcome.ok) {
    return json({ error: outcome.error }, outcome.error === 'room_full' ? 409 : 404);
  }
  return json(joinResponse(url, code, outcome.playerId, outcome.sessionToken), 200);
}

async function openSocket(request: Request, env: Env, url: URL, code: string): Promise<Response> {
  const isUpgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
  if (isUpgrade && !isAllowedOrigin(request, url, env)) {
    return json({ error: 'forbidden_origin' }, 403);
  }
  // Upgrade なしの GET は DO が「部屋なし 404 / 部屋あり 426」を返す。
  // クライアントは再接続を諦める前にこれで部屋の存在を確かめる
  return withNoStore(await roomStub(env, code).fetch(request));
}

const ROOM_PATH = /^\/api\/rooms\/([^/]+)\/(join|socket)$/;

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/health') {
    if (method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    return json({ ok: true, serverTime: Date.now() });
  }
  if (pathname === '/api/rooms') {
    if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    return createRoom(request, env, url);
  }
  const match = ROOM_PATH.exec(pathname);
  if (match) {
    const code = normalizeRoomCode(decodeURIComponent(match[1]!));
    const action = match[2];
    const expected = action === 'join' ? 'POST' : 'GET';
    if (method !== expected) return json({ error: 'method_not_allowed' }, 405);
    if (code === null) return json({ error: 'room_not_found' }, 404);
    return action === 'join'
      ? joinRoom(request, env, url, code)
      : openSocket(request, env, url, code);
  }
  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      // /api/* 以外は Static Assets が処理する
      return new Response('Not Found', { status: 404 });
    }
    try {
      return await route(request, env, url);
    } catch (e) {
      console.log(`error internal ${e instanceof Error ? e.name : 'unknown'}`);
      return json({ error: 'internal' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
