import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { GameRoom } from '../../server/game-room';
import { CLOSE_SILENT, INPUT_SILENCE_MS, RECONNECT_GRACE_MS } from '../../server/constants';
import {
  TestClient,
  advanceAndFireAlarm,
  roomStub,
  setupTwoPlayers,
  toBattle,
  type TwoPlayers,
} from './helpers';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** DO 内の battle runtime（private）をテストから触るための型 */
interface SilenceInternals {
  battle: {
    lastHeardAt: Map<string, number>;
    disconnectedAt: Map<string, number>;
  } | null;
  handleDisconnect(playerId: string): Promise<void>;
}

/**
 * 実時間で 3 秒待たずに、playerId の最終受信時刻を INPUT_SILENCE_MS より前にずらす。
 * 次の snapshot（約 67ms 以内）で無通信と判定される
 */
async function makeSilent(code: string, playerId: string): Promise<void> {
  await runInDurableObject(roomStub(code), (instance: GameRoom) => {
    const battle = (instance as unknown as SilenceInternals).battle!;
    battle.lastHeardAt.set(playerId, Date.now() - INPUT_SILENCE_MS - 500);
  });
}

/** 相手側（b）を生存させておくための ping */
function keepAlive(p: TwoPlayers): void {
  p.b.send({ type: 'ping', clientTime: Date.now() });
}

describe('BATTLE 中の無通信検知', () => {
  it('片方が 3 秒以上何も送らないと切断扱いになり、猶予 10 秒後に相手の切断勝ち', async () => {
    const p = await setupTwoPlayers();
    await toBattle(p);
    keepAlive(p);
    await makeSilent(p.code, p.aId);
    // サーバーが 4005 で閉じる（クライアントの close を待たずに切断扱い）
    const closed = await p.a.waitForClose();
    expect(closed.code).toBe(CLOSE_SILENT);
    await p.b.waitFor('roomState', (m) =>
      m.players.some((x) => x.playerId === p.aId && !x.connected),
    );
    // b は通信しているので切断扱いにならない
    expect(p.b.closeEvent).toBeNull();
    keepAlive(p);
    await advanceAndFireAlarm(p.code, RECONNECT_GRACE_MS - 1_000);
    expect(p.b.messages.some((m) => m.type === 'result')).toBe(false);
    keepAlive(p);
    await advanceAndFireAlarm(p.code, 1_001);
    const result = await p.b.waitFor('result');
    expect(result.winnerId).toBe(p.bId);
    expect(result.reason).toBe('disconnect');
    await p.b.waitFor('roomState', (m) => m.phase === 'RESULT');
  });

  it('切断扱いの後に遅れて close が届いても猶予は延びない', async () => {
    const p = await setupTwoPlayers();
    await toBattle(p);
    keepAlive(p);
    await makeSilent(p.code, p.aId);
    expect((await p.a.waitForClose()).code).toBe(CLOSE_SILENT);
    await p.b.waitFor('roomState', (m) =>
      m.players.some((x) => x.playerId === p.aId && !x.connected),
    );
    // 5 秒後に（遅れた close を模して）もう一度切断処理が走る
    await runInDurableObject(roomStub(p.code), async (instance: GameRoom) => {
      instance.clockOffsetMs += 5_000;
      await (instance as unknown as SilenceInternals).handleDisconnect(p.aId);
    });
    keepAlive(p);
    // 最初の切断から 10 秒で決着する
    await advanceAndFireAlarm(p.code, RECONNECT_GRACE_MS - 5_000 + 1);
    const result = await p.b.waitFor('result');
    expect(result).toMatchObject({ winnerId: p.bId, reason: 'disconnect' });
  });

  it('両者が送り続けていれば 3 秒を超えても切断扱いにならない（input でも ping でもよい）', async () => {
    const p = await setupTwoPlayers();
    await toBattle(p);
    const until = Date.now() + INPUT_SILENCE_MS + 700;
    let seq = 0;
    let lastPing = 0;
    while (Date.now() < until) {
      // a は中立入力を 30Hz 程度で送る（縦向きオーバーレイ中などを想定）
      p.a.send({
        type: 'input',
        matchId: 1,
        seq: ++seq,
        moveX: 0,
        moveY: 0,
        aimAngle: 0,
        firing: false,
      });
      // b は ping のみ（1 秒ごと）
      if (Date.now() - lastPing >= 1000) {
        lastPing = Date.now();
        keepAlive(p);
      }
      await sleep(33);
    }
    expect(p.a.closeEvent).toBeNull();
    expect(p.b.closeEvent).toBeNull();
    const disconnected = await runInDurableObject(roomStub(p.code), (instance: GameRoom) => [
      ...(instance as unknown as SilenceInternals).battle!.disconnectedAt.keys(),
    ]);
    expect(disconnected).toEqual([]);
    expect(
      p.b.messages.some((m) => m.type === 'roomState' && m.players.some((x) => !x.connected)),
    ).toBe(false);
    p.a.send({ type: 'leave', matchId: 1 });
    await p.b.waitFor('result');
  }, 15_000);

  it('切断扱いの後、同じ token で再接続すると復帰して試合が続く', async () => {
    const p = await setupTwoPlayers();
    await toBattle(p);
    keepAlive(p);
    await makeSilent(p.code, p.aId);
    expect((await p.a.waitForClose()).code).toBe(CLOSE_SILENT);
    await p.b.waitFor('roomState', (m) =>
      m.players.some((x) => x.playerId === p.aId && !x.connected),
    );
    keepAlive(p);
    await advanceAndFireAlarm(p.code, 5_000);
    const back = await TestClient.connect(p.code, p.aToken);
    const welcome = back.messages.find((m) => m.type === 'welcome');
    expect(welcome?.type === 'welcome' && welcome.publicState.phase).toBe('BATTLE');
    await back.waitFor('snapshot');
    await p.b.waitFor('roomState', (m) => m.players.every((x) => x.connected));
    keepAlive(p);
    back.send({ type: 'ping', clientTime: 1 });
    // 元の猶予を過ぎても決着しない
    await advanceAndFireAlarm(p.code, RECONNECT_GRACE_MS);
    await sleep(100);
    expect(p.b.messages.some((m) => m.type === 'result')).toBe(false);
    expect(back.closeEvent).toBeNull();
    // 復帰後の snapshot が進む
    const tick = (await back.waitFor('snapshot')).tick;
    await back.waitFor('snapshot', (m) => m.tick > tick);
    back.send({ type: 'leave', matchId: 1 });
    await p.b.waitFor('result');
  });

  it('両者とも無通信なら両者切断として tick を止め、猶予後に aborted', async () => {
    const p = await setupTwoPlayers();
    await toBattle(p);
    await makeSilent(p.code, p.aId);
    await makeSilent(p.code, p.bId);
    expect((await p.a.waitForClose()).code).toBe(CLOSE_SILENT);
    expect((await p.b.waitForClose()).code).toBe(CLOSE_SILENT);
    const stub = roomStub(p.code);
    const tickOf = (): Promise<number> =>
      runInDurableObject(
        stub,
        (instance: GameRoom) =>
          (instance as unknown as { battle: { loop: { state: { tick: number } } } }).battle.loop
            .state.tick,
      );
    const before = await tickOf();
    await sleep(150);
    expect(await tickOf()).toBe(before);
    await advanceAndFireAlarm(p.code, RECONNECT_GRACE_MS + 1);
    const viewer = await TestClient.connect(p.code, p.aToken);
    const result = await viewer.waitFor('result');
    expect(result.reason).toBe('aborted');
  });
});
