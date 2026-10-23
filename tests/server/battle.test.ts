import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { GameRoom } from '../../server/game-room';
import { ARENA } from '../../shared/arena';
import {
  TestClient,
  advanceAndFireAlarm,
  advanceClock,
  nextRequestId,
  roomStub,
  setupTwoPlayers,
  toBattle,
  type TwoPlayers,
} from './helpers';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 右へ移動する入力を送り続ける */
async function holdRight(client: TestClient, fromSeq: number, count: number): Promise<number> {
  let seq = fromSeq;
  for (let i = 0; i < count; i++) {
    client.send({
      type: 'input',
      matchId: 1,
      seq: ++seq,
      moveX: 1,
      moveY: 0,
      aimAngle: 0,
      firing: false,
    });
    await sleep(30);
  }
  return seq;
}

async function endBattle(p: TwoPlayers): Promise<void> {
  p.a.send({ type: 'leave', matchId: 1 });
  await p.b.waitFor('result');
}

describe('BATTLE', () => {
  it('REVEAL → COUNTDOWN → BATTLE で snapshot が届き、スポーン位置が正しい', async () => {
    const p = await setupTwoPlayers();
    await toBattle(p);
    const snap = await p.a.waitFor('snapshot');
    expect(snap.matchId).toBe(1);
    const a = snap.players.find((x) => x.id === p.aId)!;
    const b = snap.players.find((x) => x.id === p.bId)!;
    expect([a.x, a.y]).toEqual([ARENA.spawns[0].x, ARENA.spawns[0].y]);
    expect([b.x, b.y]).toEqual([ARENA.spawns[1].x, ARENA.spawns[1].y]);
    // tick が進む
    const later = await p.b.waitFor('snapshot', (m) => m.tick >= 4);
    expect(later.tick % 2).toBe(0);
    await endBattle(p);
  });

  it('input が反映されて位置が変わり、lastProcessedInputSeq が返る', async () => {
    const p = await setupTwoPlayers();
    await toBattle(p);
    const seq = await holdRight(p.a, 0, 8);
    const snap = await p.b.waitFor(
      'snapshot',
      (m) => m.players.find((x) => x.id === p.aId)!.x > ARENA.spawns[0].x + 5,
    );
    expect(snap.lastProcessedInputSeq[p.aId]).toBeGreaterThan(0);
    expect(snap.lastProcessedInputSeq[p.aId]).toBeLessThanOrEqual(seq);
    expect(snap.lastProcessedInputSeq[p.bId]).toBe(-1);
    expect(snap.players.find((x) => x.id === p.bId)!.x).toBe(ARENA.spawns[1].x);
    await endBattle(p);
  });

  it('古い matchId・古い seq の input は拒否', async () => {
    const p = await setupTwoPlayers();
    await toBattle(p);
    p.a.send({ type: 'input', matchId: 0, seq: 1, moveX: 1, moveY: 0, aimAngle: 0, firing: false });
    expect((await p.a.waitFor('error')).code).toBe('stale_match');
    p.a.send({ type: 'input', matchId: 1, seq: 5, moveX: 0, moveY: 0, aimAngle: 0, firing: false });
    p.a.send({ type: 'input', matchId: 1, seq: 5, moveX: 1, moveY: 0, aimAngle: 0, firing: false });
    expect((await p.a.waitFor('error')).code).toBe('invalid_input');
    p.a.send({ type: 'input', matchId: 1, seq: 3, moveX: 1, moveY: 0, aimAngle: 0, firing: false });
    expect((await p.a.waitFor('error')).code).toBe('invalid_input');
    await endBattle(p);
  });

  it('片方が切断し猶予を超えると相手の勝ち（disconnect）', async () => {
    const p = await setupTwoPlayers();
    await toBattle(p);
    p.a.close();
    await p.b.waitFor('roomState', (m) =>
      m.players.some((x) => x.playerId === p.aId && !x.connected),
    );
    await advanceAndFireAlarm(p.code, 9_000);
    expect(p.b.messages.some((m) => m.type === 'result')).toBe(false);
    await advanceAndFireAlarm(p.code, 1_001);
    const result = await p.b.waitFor('result');
    expect(result.winnerId).toBe(p.bId);
    expect(result.reason).toBe('disconnect');
    expect(Object.keys(result.loadouts)).toHaveLength(2);
    expect(result.hpRatios[p.aId]).toBe(1);
    await p.b.waitFor('roomState', (m) => m.phase === 'RESULT');
  });

  it('猶予切れ後に alarm より先に再接続しても切断負けになる', async () => {
    const p = await setupTwoPlayers();
    await toBattle(p);
    p.a.close();
    await p.b.waitFor('roomState', (m) =>
      m.players.some((x) => x.playerId === p.aId && !x.connected),
    );
    await advanceClock(p.code, 11_000);
    const back = await TestClient.connect(p.code, p.aToken);
    const welcome = back.messages.find((m) => m.type === 'welcome');
    expect(welcome?.type === 'welcome' && welcome.publicState.phase).toBe('RESULT');
    const result = await back.waitFor('result');
    expect(result).toMatchObject({ winnerId: p.bId, reason: 'disconnect' });
    expect((await p.b.waitFor('result')).winnerId).toBe(p.bId);
    // BATTLE は継続しない
    const count = back.messages.filter((m) => m.type === 'snapshot').length;
    await sleep(150);
    expect(back.messages.filter((m) => m.type === 'snapshot').length).toBe(count);
  });

  it('猶予内に同じ token で復帰すると welcome と直近 snapshot を受け取り継続', async () => {
    const p = await setupTwoPlayers();
    await toBattle(p);
    p.a.close();
    await p.b.waitFor('roomState', (m) => m.players.some((x) => !x.connected));
    await advanceAndFireAlarm(p.code, 5_000);
    const back = await TestClient.connect(p.code, p.aToken);
    await back.waitFor('reveal');
    await back.waitFor('snapshot');
    await p.b.waitFor('roomState', (m) => m.players.every((x) => x.connected));
    await advanceAndFireAlarm(p.code, 6_000);
    expect(p.b.messages.some((m) => m.type === 'result')).toBe(false);
    back.send({ type: 'leave', matchId: 1 });
    await p.b.waitFor('result');
  });

  it('両者切断で tick が止まり、片方が戻ると再開して期限が延長される', async () => {
    const p = await setupTwoPlayers();
    await toBattle(p);
    const stub = roomStub(p.code);
    const before = p.b.messages.find((m) => m.type === 'roomState' && m.phase === 'BATTLE');
    if (before?.type !== 'roomState') throw new Error('no BATTLE roomState');
    p.a.close();
    p.b.close();
    // 両者の切断が処理されるまで待つ
    for (let i = 0; i < 100; i++) {
      const paused = await runInDurableObject(stub, (instance: GameRoom) => {
        const battle = (instance as unknown as { battle: { pausedAt: number | null } | null })
          .battle;
        return battle?.pausedAt !== null && battle !== null;
      });
      if (paused) break;
      await sleep(10);
    }
    await advanceAndFireAlarm(p.code, 0);
    const tickBefore = await runInDurableObject(
      stub,
      (instance: GameRoom) =>
        (instance as unknown as { battle: { loop: { state: { tick: number } } } }).battle.loop.state
          .tick,
    );
    await sleep(150);
    const tickPaused = await runInDurableObject(
      stub,
      (instance: GameRoom) =>
        (instance as unknown as { battle: { loop: { state: { tick: number } } } }).battle.loop.state
          .tick,
    );
    expect(tickPaused).toBe(tickBefore);

    await runInDurableObject(stub, (instance: GameRoom) => {
      instance.clockOffsetMs += 4_000;
    });
    const back = await TestClient.connect(p.code, p.bToken);
    const state = await back.waitFor('roomState', (m) => m.phase === 'BATTLE');
    expect(state.deadlineAt!).toBeGreaterThanOrEqual(before.deadlineAt! + 4_000);
    await back.waitFor('snapshot', (m) => m.tick > tickPaused);
    back.send({ type: 'leave', matchId: 1 });
    await back.waitFor('result');
  });

  it('両者切断のまま猶予を超えると aborted', async () => {
    const p = await setupTwoPlayers();
    await toBattle(p);
    p.a.close();
    p.b.close();
    await sleep(50);
    const ran = await advanceAndFireAlarm(p.code, 10_001);
    expect(ran).toBe(true);
    const viewer = await TestClient.connect(p.code, p.aToken);
    const result = await viewer.waitFor('result');
    expect(result.reason).toBe('aborted');
    expect(result.winnerId).toBeNull();
  });

  it('RESULT → 両者 rematch で matchId が +1 されガチャがリセット', async () => {
    const p = await setupTwoPlayers();
    await toBattle(p);
    p.a.send({ type: 'leave', matchId: 1 });
    const result = await p.b.waitFor('result');
    expect(result.winnerId).toBe(p.bId);
    const a = await TestClient.connect(p.code, p.aToken);
    await a.waitFor('result');
    a.send({ type: 'rematch', matchId: 1, value: true });
    const mid = await p.b.waitFor('roomState', (m) =>
      m.players.some((x) => x.playerId === p.aId && x.ready),
    );
    expect(mid.phase).toBe('RESULT');
    p.b.send({ type: 'rematch', matchId: 1, value: true });
    const drafting = await a.waitFor('roomState', (m) => m.phase === 'DRAFTING');
    expect(drafting.matchId).toBe(2);
    expect(drafting.players.every((x) => x.confirmedParts === 0)).toBe(true);
    // 旧 matchId は拒否、新 matchId で 1 回目から抽選できる
    const staleId = nextRequestId();
    a.send({
      type: 'draftDraw',
      matchId: 1,
      partType: 'body',
      requestId: staleId,
      candidateVersion: 0,
    });
    expect((await a.waitFor('error', (m) => m.requestId === staleId)).code).toBe('stale_match');
    const id = nextRequestId();
    a.send({ type: 'draftDraw', matchId: 2, partType: 'body', requestId: id, candidateVersion: 0 });
    const drawn = await a.waitFor('draftResult', (m) => m.requestId === id);
    expect(drawn).toMatchObject({ matchId: 2, drawCount: 1, candidateVersion: 1 });
    // 旧 matchId の leave は拒否され、部屋は閉じない
    a.send({ type: 'leave', matchId: 1 });
    expect((await a.waitFor('error', (m) => m.code === 'stale_match')).recoverable).toBe(true);
    a.send({ type: 'ping', clientTime: 7 });
    await a.waitFor('pong', (m) => m.clientTime === 7);
    expect(a.closeEvent).toBeNull();
    expect(p.b.closeEvent).toBeNull();
    expect(p.b.messages.some((m) => m.type === 'roomState' && m.phase === 'CLOSED')).toBe(false);
  });

  it('RESULT は 5 分で CLOSED', async () => {
    const p = await setupTwoPlayers();
    await toBattle(p);
    await endBattle(p);
    await advanceAndFireAlarm(p.code, 5 * 60 * 1000 + 1);
    expect((await p.b.waitForClose()).code).toBe(1000);
  });

  it('BATTLE 中に Object が作り直されると aborted', async () => {
    const p = await setupTwoPlayers();
    await toBattle(p);
    await p.a.waitFor('snapshot');
    p.a.close();
    p.b.close();
    await p.a.waitForClose();
    await p.b.waitForClose();
    await evictDurableObject(roomStub(p.code));
    // 再接続で Object が再構築され、BATTLE マーカーから中断を判定する
    const back = await TestClient.connect(p.code, p.aToken);
    const result = await back.waitFor('result');
    expect(result.reason).toBe('aborted');
    expect(result.winnerId).toBeNull();
    const welcome = back.messages.find((m) => m.type === 'welcome');
    expect(welcome?.type === 'welcome' && welcome.publicState.phase).toBe('RESULT');
  });
});
