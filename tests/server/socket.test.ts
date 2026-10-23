import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { GameRoom } from '../../server/game-room';
import { PROTOCOL_VERSION } from '../../shared/protocol';
import {
  TestClient,
  advanceAndFireAlarm,
  createRoom,
  joinRoom,
  openSocket,
  roomStub,
  setupTwoPlayers,
} from './helpers';

describe('WebSocket 接続', () => {
  it('Origin 不一致・Origin なしは 403', async () => {
    const { roomCode } = await createRoom();
    expect((await openSocket(roomCode, 'https://evil.example')).status).toBe(403);
    expect((await openSocket(roomCode, null)).status).toBe(403);
  });

  it('存在しないルームは 404', async () => {
    const res = await openSocket('ABCDEFGHJK');
    expect(res.status).toBe(404);
  });

  it('認証なしで 5 秒経つと 4001 で閉じる', async () => {
    const { roomCode } = await createRoom();
    const client = await TestClient.open(roomCode);
    // 期限前の alarm では閉じない
    await advanceAndFireAlarm(roomCode, 1000);
    expect(client.closeEvent).toBeNull();
    await advanceAndFireAlarm(roomCode, 4100);
    expect((await client.waitForClose()).code).toBe(4001);
  });

  it('認証前のメッセージは unauthenticated', async () => {
    const { roomCode } = await createRoom();
    const client = await TestClient.open(roomCode);
    client.send({ type: 'ready', matchId: 1, value: true });
    const err = await client.waitFor('error');
    expect(err.code).toBe('unauthenticated');
  });

  it('不正な token は auth_failed で 4003', async () => {
    const { roomCode } = await createRoom();
    const client = await TestClient.open(roomCode);
    client.send({ type: 'authenticate', sessionToken: 'wrong', protocolVersion: PROTOCOL_VERSION });
    const err = await client.waitFor('error');
    expect(err.code).toBe('auth_failed');
    expect(err.recoverable).toBe(false);
    expect((await client.waitForClose()).code).toBe(4003);
  });

  it('protocolVersion 不一致は 4002', async () => {
    const { roomCode, sessionToken } = await createRoom();
    const client = await TestClient.open(roomCode);
    client.send({ type: 'authenticate', sessionToken, protocolVersion: PROTOCOL_VERSION + 1 });
    expect((await client.waitFor('error')).code).toBe('protocol_mismatch');
    expect((await client.waitForClose()).code).toBe(4002);
  });

  it('正しい token で welcome', async () => {
    const created = await createRoom('あ');
    const client = await TestClient.connect(created.roomCode, created.sessionToken);
    const welcome = client.messages.find((m) => m.type === 'welcome');
    expect(welcome).toMatchObject({
      type: 'welcome',
      playerId: created.playerId,
      roomCode: created.roomCode,
      matchId: 1,
      protocolVersion: PROTOCOL_VERSION,
      privateDraft: null,
    });
    if (welcome?.type !== 'welcome') throw new Error('no welcome');
    expect(welcome.publicState.phase).toBe('WAITING');
    expect(welcome.publicState.players).toEqual([
      { playerId: created.playerId, name: 'あ', connected: true, ready: false, confirmedParts: 0 },
    ]);
  });

  it('未認証接続はルームあたり 4 まで', async () => {
    const { roomCode } = await createRoom();
    for (let i = 0; i < 4; i++) await TestClient.open(roomCode);
    expect((await openSocket(roomCode)).status).toBe(429);
  });

  it('同じ token の 2 本目で 1 本目が replaced / 4004 で閉じる', async () => {
    const created = await createRoom();
    const first = await TestClient.connect(created.roomCode, created.sessionToken);
    const second = await TestClient.connect(created.roomCode, created.sessionToken);
    const err = await first.waitFor('error');
    expect(err.code).toBe('replaced');
    expect((await first.waitForClose()).code).toBe(4004);
    second.send({ type: 'ping', clientTime: 42 });
    const pong = await second.waitFor('pong');
    expect(pong.clientTime).toBe(42);
    // 置換で切断扱いにならない
    second.send({ type: 'ready', matchId: 1, value: true });
    const state = await second.waitFor('roomState', (m) => m.players[0]!.ready);
    expect(state.players[0]!.connected).toBe(true);
  });

  it('不正なメッセージは invalid_message、頻度超過は rate_limited', async () => {
    const created = await createRoom();
    const client = await TestClient.connect(created.roomCode, created.sessionToken);
    client.ws.send('not json');
    expect((await client.waitFor('error')).code).toBe('invalid_message');
    for (let i = 0; i < 12; i++) client.send({ type: 'ping', clientTime: i });
    const err = await client.waitFor('error', (m) => m.code === 'rate_limited');
    expect(err.recoverable).toBe(true);
  });

  it('両者 ready で DRAFTING、roomState が両者に届く', async () => {
    const p = await setupTwoPlayers();
    p.a.send({ type: 'ready', matchId: 1, value: true });
    const mid = await p.b.waitFor('roomState', (m) => m.players.some((x) => x.ready));
    expect(mid.phase).toBe('WAITING');
    p.b.send({ type: 'ready', matchId: 1, value: true });
    for (const c of [p.a, p.b]) {
      const s = await c.waitFor('roomState', (m) => m.phase === 'DRAFTING');
      expect(s.matchId).toBe(1);
      expect(s.deadlineAt).toBeGreaterThan(s.serverTime + 119_000);
      expect(s.players.map((x) => x.connected)).toEqual([true, true]);
    }
  });

  it('古い matchId の ready は stale_match', async () => {
    const p = await setupTwoPlayers();
    p.a.send({ type: 'ready', matchId: 0, value: true });
    expect((await p.a.waitFor('error')).code).toBe('stale_match');
  });

  it('WAITING は 10 分で CLOSED になり storage が消える', async () => {
    const created = await createRoom();
    const client = await TestClient.connect(created.roomCode, created.sessionToken);
    await advanceAndFireAlarm(created.roomCode, 10 * 60 * 1000 + 1);
    expect((await client.waitForClose()).code).toBe(1000);
    const res = await openSocket(created.roomCode);
    expect(res.status).toBe(404);
    await expect(joinRoom(created.roomCode)).rejects.toThrow('404');
  });

  it('leave で CLOSED', async () => {
    const p = await setupTwoPlayers();
    p.a.send({ type: 'leave', matchId: 1 });
    await p.b.waitFor('roomState', (m) => m.phase === 'CLOSED');
    expect((await p.b.waitForClose()).code).toBe(1000);
  });

  it('置換された旧接続からの操作は反映されない', async () => {
    const created = await createRoom();
    const stub = roomStub(created.roomCode);
    const first = await TestClient.connect(created.roomCode, created.sessionToken);
    // 旧接続のサーバー側 WebSocket を保持しておく
    const oldServerSocket = await runInDurableObject(stub, (_i: GameRoom, state) => {
      return state.getWebSockets()[0]!;
    });
    const second = await TestClient.connect(created.roomCode, created.sessionToken);
    await first.waitForClose();
    const ready = await runInDurableObject(stub, async (instance: GameRoom) => {
      await instance.webSocketMessage(
        oldServerSocket,
        JSON.stringify({ type: 'ready', matchId: 1, value: true }),
      );
      return (instance as unknown as { players: { ready: boolean }[] }).players[0]!.ready;
    });
    expect(ready).toBe(false);
    expect(second.messages.some((m) => m.type === 'roomState' && m.players[0]!.ready)).toBe(false);
  });
});
