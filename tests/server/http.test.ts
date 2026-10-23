import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ROOM_CODE_ALPHABET } from '../../server/random';
import type { CreateRoomResponse } from '../../shared/protocol';
import { ORIGIN, createRoom, joinRoom, nextIp, post } from './helpers';

describe('POST /api/rooms', () => {
  it('201 で参加情報を返し、no-store', async () => {
    const res = await post('/api/rooms', { name: '  たろう ' });
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = (await res.json()) as CreateRoomResponse;
    expect(body.roomCode).toMatch(new RegExp(`^[${ROOM_CODE_ALPHABET}]{10}$`));
    expect(body.shareUrl).toBe(`${ORIGIN}/?room=${body.roomCode}`);
    expect(body.sessionToken.length).toBeGreaterThanOrEqual(43);
    expect(body.playerId).toBeTruthy();
  });

  it('不正な名前は 400 invalid_name', async () => {
    for (const name of ['', '   ', 'あいうえおかきくけこさしす', 'a\u0007b', 123]) {
      const res = await post('/api/rooms', { name });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_name' });
    }
  });

  it('JSON 不正は 400', async () => {
    const res = await post('/api/rooms', '{bad');
    expect(res.status).toBe(400);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('同じ IP から 11 回目は 429', async () => {
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++)
      statuses.push((await post('/api/rooms', { name: 'a' }, ip)).status);
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('GET は 405', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/rooms`);
    expect(res.status).toBe(405);
  });
});

describe('POST /api/rooms/:code/join', () => {
  it('参加 → 満員で 409', async () => {
    const created = await createRoom();
    const joined = await joinRoom(created.roomCode);
    expect(joined.roomCode).toBe(created.roomCode);
    expect(joined.playerId).not.toBe(created.playerId);
    expect(joined.sessionToken).not.toBe(created.sessionToken);
    const res = await post(`/api/rooms/${created.roomCode}/join`, { name: 'う' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'room_full' });
  });

  it('小文字のコードでも参加できる', async () => {
    const created = await createRoom();
    const res = await post(`/api/rooms/${created.roomCode.toLowerCase()}/join`, { name: 'う' });
    expect(res.status).toBe(200);
  });

  it('存在しないコードは 404 でルームを作らない', async () => {
    const code = 'ABCDEFGHJK';
    const first = await post(`/api/rooms/${code}/join`, { name: 'う' });
    expect(first.status).toBe(404);
    expect(await first.json()).toEqual({ error: 'room_not_found' });
    const second = await post(`/api/rooms/${code}/join`, { name: 'う' });
    expect(second.status).toBe(404);
  });

  it('形式の不正なコードは 404', async () => {
    const res = await post('/api/rooms/O0I1L/join', { name: 'う' });
    expect(res.status).toBe(404);
  });

  it('不正な名前は 400', async () => {
    const created = await createRoom();
    const res = await post(`/api/rooms/${created.roomCode}/join`, { name: '' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_name' });
  });

  it('並行 join 3 件で定員 2 を超えない', async () => {
    const created = await createRoom();
    const results = await Promise.all(
      [1, 2, 3].map((i) => post(`/api/rooms/${created.roomCode}/join`, { name: `p${i}` })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
  });
});

describe('socket の存在確認', () => {
  it('Upgrade なしの GET は部屋があれば 426、なければ 404', async () => {
    const created = await SELF.fetch('https://example.com/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'probe' }),
    });
    const { roomCode } = (await created.json()) as { roomCode: string };
    const exists = await SELF.fetch(`https://example.com/api/rooms/${roomCode}/socket`);
    expect(exists.status).toBe(426);
    const missing = await SELF.fetch('https://example.com/api/rooms/ZZZZZZZZZZ/socket');
    expect(missing.status).toBe(404);
  });
});
