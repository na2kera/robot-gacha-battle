import { describe, expect, it, vi } from 'vitest';
import { BattleLoop, type BattleLoopCallbacks } from '../../server/battle-loop';
import { BATTLE_DURATION_SEC, STALL_ABORT_MS } from '../../shared/config';
import { PHASE1_LOADOUT } from '../../shared/parts';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 手動で進める時計と、呼び出しを記録するコールバックで BattleLoop を作る */
function createLoop(): {
  loop: BattleLoop;
  clock: { now: number };
  callbacks: { [K in keyof BattleLoopCallbacks]: ReturnType<typeof vi.fn> };
} {
  const clock = { now: 1_000_000 };
  const callbacks = { onSnapshot: vi.fn(), onEnd: vi.fn(), onStall: vi.fn() };
  const loop = new BattleLoop(
    [
      { playerId: 'a', loadout: PHASE1_LOADOUT },
      { playerId: 'b', loadout: PHASE1_LOADOUT },
    ],
    callbacks,
    () => clock.now,
  );
  return { loop, clock, callbacks };
}

async function waitUntil(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('timeout');
    await sleep(5);
  }
}

describe('BattleLoop', () => {
  it('clock を 2.5 秒飛ばすと onStall が呼ばれ、以後 timer が止まる', async () => {
    const { loop, clock, callbacks } = createLoop();
    loop.start();
    expect(loop.running).toBe(true);
    clock.now += STALL_ABORT_MS + 500;
    await waitUntil(() => callbacks.onStall.mock.calls.length > 0);
    expect(callbacks.onStall).toHaveBeenCalledTimes(1);
    expect(loop.running).toBe(false);
    expect(loop.state.tick).toBe(0);
    // 停止後は時計を進めても step も再スケジュールもされない
    clock.now += 1000;
    await sleep(100);
    expect(loop.running).toBe(false);
    expect(loop.state.tick).toBe(0);
    expect(callbacks.onSnapshot).not.toHaveBeenCalled();
    expect(callbacks.onEnd).not.toHaveBeenCalled();
    // stop 済みなので start しても再開しない
    loop.start();
    expect(loop.running).toBe(false);
  });

  it('入力なしで試合時間を経過させると timeout_draw で終了し、timer が止まる', async () => {
    const { loop, clock, callbacks } = createLoop();
    loop.state = { ...loop.state, elapsedSec: BATTLE_DURATION_SEC - 0.01 };
    loop.start();
    clock.now += 40;
    await waitUntil(() => callbacks.onEnd.mock.calls.length > 0);
    expect(callbacks.onEnd).toHaveBeenCalledWith({
      winnerId: null,
      reason: 'timeout_draw',
      hpRatios: { a: 1, b: 1 },
    });
    expect(callbacks.onStall).not.toHaveBeenCalled();
    expect(loop.running).toBe(false);
  });
});
