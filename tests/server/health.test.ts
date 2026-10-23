import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('Worker', () => {
  it('GET /api/health が 200 と no-store を返す', async () => {
    const res = await SELF.fetch('https://example.com/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as { ok: boolean; serverTime: number };
    expect(body.ok).toBe(true);
    expect(typeof body.serverTime).toBe('number');
  });

  it('未定義の /api パスは 404', async () => {
    const res = await SELF.fetch('https://example.com/api/nope');
    expect(res.status).toBe(404);
  });
});

describe('GameRoom DO', () => {
  it('未初期化のルームへの接続は 404', async () => {
    const id = env.GAME_ROOM.idFromName('TEST-ROOM');
    const stub = env.GAME_ROOM.get(id);
    const res = await stub.fetch('https://do/', { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(404);
  });
});
