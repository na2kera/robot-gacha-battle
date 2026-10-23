import { DurableObject } from 'cloudflare:workers';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * GameRoom Durable Object。1 ルーム 1 Object。
 * フェーズ1で参加枠・WebSocket・対戦計算を実装する。
 */
export class GameRoom extends DurableObject<Env> {
  override async fetch(_request: Request): Promise<Response> {
    return json({ error: 'not_implemented' }, 501);
  }
}

export default {
  async fetch(request, _env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, serverTime: Date.now() });
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'not_found' }, 404);
    }

    // /api/* 以外は Static Assets が処理する
    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
