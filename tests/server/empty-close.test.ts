import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { GameRoom } from '../../server/game-room';
import { EMPTY_CLOSE_MS } from '../../server/constants';
import {
  advanceClock,
  post,
  roomStub,
  setupTwoPlayers,
  toDrafting,
  type TwoPlayers,
} from './helpers';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 両者を切断し、DO が全員切断（emptySince）を記録するまで待つ */
async function disconnectBoth(p: TwoPlayers): Promise<void> {
  p.a.close();
  p.b.close();
  const stub = roomStub(p.code);
  for (let i = 0; i < 200; i++) {
    const empty = await runInDurableObject(
      stub,
      (instance: GameRoom) =>
        (instance as unknown as { meta: { emptySince: number | null } | null }).meta?.emptySince !==
        null,
    );
    if (empty) return;
    await sleep(10);
  }
  throw new Error('emptySince was not set');
}

async function expectClosedAfterEmpty(p: TwoPlayers): Promise<void> {
  const stub = roomStub(p.code);
  const before = await runInDurableObject(
    stub,
    async (_i: GameRoom, state) => (await state.storage.list()).size,
  );
  expect(before).toBeGreaterThan(0);

  await advanceClock(p.code, EMPTY_CLOSE_MS + 1000);
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  const keys = await runInDurableObject(stub, async (_i: GameRoom, state) => [
    ...(await state.storage.list()).keys(),
  ]);
  expect(keys).toEqual([]);
  const res = await post(`/api/rooms/${p.code}/join`, { name: 'う' });
  expect(res.status).toBe(404);
}

describe('全員切断で CLOSED', () => {
  it('WAITING で両者切断が 5 分続くと storage が削除され join は 404', async () => {
    const p = await setupTwoPlayers();
    await disconnectBoth(p);
    await expectClosedAfterEmpty(p);
  });

  it('DRAFTING で両者切断が 5 分続くと storage が削除され join は 404', async () => {
    const p = await setupTwoPlayers();
    await toDrafting(p);
    await disconnectBoth(p);
    await expectClosedAfterEmpty(p);
  });
});
