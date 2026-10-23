import { describe, expect, it } from 'vitest';
import { PART_IDS_BY_TYPE, type PartId } from '../../shared/parts';
import type { DraftResultMessage } from '../../shared/protocol';
import {
  advanceAndFireAlarm,
  advanceClock,
  completeDraft,
  nextRequestId,
  setupTwoPlayers,
  toDrafting,
  type TestClient,
} from './helpers';

const ALL_PART_IDS: PartId[] = Object.values(PART_IDS_BY_TYPE).flat();

async function draw(client: TestClient, candidateVersion: number, requestId = nextRequestId()) {
  client.send({ type: 'draftDraw', matchId: 1, partType: 'body', requestId, candidateVersion });
  return client.waitFor('draftResult', (m) => m.requestId === requestId);
}

describe('ガチャ（DRAFTING）', () => {
  it('5 回まで抽選でき、5 回目で自動確定、以後は part_locked', async () => {
    const p = await setupTwoPlayers();
    await toDrafting(p);
    let version = 0;
    for (let i = 1; i <= 5; i++) {
      const last = await draw(p.a, version);
      expect(last.drawCount).toBe(i);
      expect(last.candidateVersion).toBe(version + 1);
      expect(PART_IDS_BY_TYPE.body).toContain(last.candidate);
      expect(last.locked).toBe(i === 5);
      version = last.candidateVersion;
    }
    // 確定部位数の変化は相手にも届く
    const state = await p.b.waitFor('roomState', (m) =>
      m.players.some((x) => x.playerId === p.aId && x.confirmedParts === 1),
    );
    expect(state.phase).toBe('DRAFTING');

    const requestId = nextRequestId();
    p.a.send({ type: 'draftDraw', matchId: 1, partType: 'body', requestId, candidateVersion: 5 });
    const err = await p.a.waitFor('error', (m) => m.requestId === requestId);
    expect(err.code).toBe('part_locked');
  });

  it('古い candidateVersion は stale_candidate', async () => {
    const p = await setupTwoPlayers();
    await toDrafting(p);
    await draw(p.a, 0);
    const requestId = nextRequestId();
    p.a.send({ type: 'draftDraw', matchId: 1, partType: 'body', requestId, candidateVersion: 0 });
    expect((await p.a.waitFor('error', (m) => m.requestId === requestId)).code).toBe(
      'stale_candidate',
    );
    const confirmId = nextRequestId();
    p.a.send({
      type: 'draftConfirm',
      matchId: 1,
      partType: 'body',
      requestId: confirmId,
      candidateVersion: 0,
    });
    expect((await p.a.waitFor('error', (m) => m.requestId === confirmId)).code).toBe(
      'stale_candidate',
    );
  });

  it('未抽選の確定は bad_phase、確定済みへの確定は冪等', async () => {
    const p = await setupTwoPlayers();
    await toDrafting(p);
    const id1 = nextRequestId();
    p.a.send({
      type: 'draftConfirm',
      matchId: 1,
      partType: 'legs',
      requestId: id1,
      candidateVersion: 0,
    });
    expect((await p.a.waitFor('error', (m) => m.requestId === id1)).code).toBe('bad_phase');
    const drawn = await draw(p.a, 0);
    const id2 = nextRequestId();
    p.a.send({
      type: 'draftConfirm',
      matchId: 1,
      partType: 'body',
      requestId: id2,
      candidateVersion: 1,
    });
    const confirmed = await p.a.waitFor('draftResult', (m) => m.requestId === id2);
    expect(confirmed).toMatchObject({ locked: true, candidate: drawn.candidate, drawCount: 1 });
    const id3 = nextRequestId();
    p.a.send({
      type: 'draftConfirm',
      matchId: 1,
      partType: 'body',
      requestId: id3,
      candidateVersion: 1,
    });
    const again = await p.a.waitFor('draftResult', (m) => m.requestId === id3);
    expect(again).toMatchObject({ locked: true, candidate: drawn.candidate, drawCount: 1 });
  });

  it('同じ requestId の再送は保存済みの結果を返し drawCount が増えない', async () => {
    const p = await setupTwoPlayers();
    await toDrafting(p);
    const requestId = nextRequestId();
    const first = await draw(p.a, 0, requestId);
    const second = await draw(p.a, 0, requestId);
    expect(second.drawCount).toBe(1);
    expect(second.candidate).toBe(first.candidate);
    expect(second.candidateVersion).toBe(first.candidateVersion);
    const next = await draw(p.a, 1);
    expect(next.drawCount).toBe(2);
  });

  it('相手には候補・構成を送らない', async () => {
    const p = await setupTwoPlayers();
    await toDrafting(p);
    let version = 0;
    for (let i = 0; i < 3; i++) version = (await draw(p.a, version)).candidateVersion;
    const id = nextRequestId();
    p.a.send({
      type: 'draftConfirm',
      matchId: 1,
      partType: 'body',
      requestId: id,
      candidateVersion: version,
    });
    await p.a.waitFor('draftResult', (m) => m.requestId === id);
    await p.b.waitFor('roomState', (m) => m.players.some((x) => x.confirmedParts === 1));
    const received = p.b.raw.join('\n');
    for (const partId of ALL_PART_IDS) expect(received).not.toContain(partId);
    expect(p.b.messages.some((m) => m.type === 'draftResult')).toBe(false);
  });

  it('DRAFTING 外の draftDraw は bad_phase', async () => {
    const p = await setupTwoPlayers();
    const id = nextRequestId();
    p.a.send({
      type: 'draftDraw',
      matchId: 1,
      partType: 'body',
      requestId: id,
      candidateVersion: 0,
    });
    expect((await p.a.waitFor('error', (m) => m.requestId === id)).code).toBe('bad_phase');
  });

  it('期限 alarm で候補は確定、未抽選部位は 1 回だけ抽選して確定し REVEAL', async () => {
    const p = await setupTwoPlayers();
    await toDrafting(p);
    const drawn = await draw(p.a, 0);
    // 期限前の alarm では何も起きない
    await advanceAndFireAlarm(p.code, 60_000);
    expect(p.a.messages.some((m) => m.type === 'reveal')).toBe(false);
    await advanceAndFireAlarm(p.code, 60_001);
    const reveal = await p.a.waitFor('reveal');
    expect(reveal.loadouts[p.aId]!.body).toBe(drawn.candidate);
    expect(Object.keys(reveal.loadouts).sort()).toEqual([p.aId, p.bId].sort());
    const autos = p.a.messages.filter(
      (m): m is DraftResultMessage => m.type === 'draftResult' && m.requestId === 'auto',
    );
    expect(autos.map((m) => m.partType).sort()).toEqual(['body', 'core', 'legs', 'weapon']);
    for (const m of autos) {
      expect(m.locked).toBe(true);
      expect(m.drawCount).toBe(1);
    }
    const bAutos = p.b.messages.filter((m) => m.type === 'draftResult');
    expect(bAutos).toHaveLength(4);
    await p.b.waitFor('roomState', (m) => m.phase === 'REVEAL');
  });

  it('両者確定で REVEAL、両者に loadouts が届く', async () => {
    const p = await setupTwoPlayers();
    await toDrafting(p);
    await completeDraft(p.a);
    expect(p.a.messages.some((m) => m.type === 'reveal')).toBe(false);
    await completeDraft(p.b);
    const ra = await p.a.waitFor('reveal');
    const rb = await p.b.waitFor('reveal');
    expect(ra.loadouts).toEqual(rb.loadouts);
    expect(Object.keys(ra.loadouts)).toHaveLength(2);
  });

  it('DRAFTING 期限後 10 秒たっても片方が未接続なら aborted', async () => {
    const p = await setupTwoPlayers();
    await toDrafting(p);
    p.b.close();
    await p.a.waitFor('roomState', (m) => m.players.some((x) => !x.connected));
    await advanceAndFireAlarm(p.code, 120_001);
    expect(p.a.messages.some((m) => m.type === 'reveal')).toBe(false);
    await advanceAndFireAlarm(p.code, 10_000);
    const result = await p.a.waitFor('result');
    expect(result).toMatchObject({ winnerId: null, reason: 'aborted', loadouts: {} });
  });

  it('期限後に alarm 前の draftDraw は抽選されず、期限処理後の状態になる', async () => {
    const p = await setupTwoPlayers();
    await toDrafting(p);
    await advanceClock(p.code, 121_000);
    const requestId = nextRequestId();
    p.a.send({ type: 'draftDraw', matchId: 1, partType: 'body', requestId, candidateVersion: 0 });
    const err = await p.a.waitFor('error', (m) => m.requestId === requestId);
    expect(err.code).toBe('bad_phase');
    expect(p.a.messages.some((m) => m.type === 'draftResult' && m.requestId === requestId)).toBe(
      false,
    );
    const auto = p.a.messages.find(
      (m): m is DraftResultMessage =>
        m.type === 'draftResult' && m.requestId === 'auto' && m.partType === 'body',
    );
    expect(auto?.drawCount).toBe(1);
    expect(p.a.messages.some((m) => m.type === 'reveal')).toBe(true);
  });

  it('REVEAL 後に最後の draftConfirm を同じ requestId で再送すると保存済みの結果が返る', async () => {
    const p = await setupTwoPlayers();
    await toDrafting(p);
    await completeDraft(p.a);
    const last = await completeDraft(p.b);
    await p.b.waitFor('reveal');
    // 送信頻度の窓（1 秒）をまたがせる。REVEAL の期限（3 秒）には届かない
    await advanceClock(p.code, 1_001);
    p.b.send({
      type: 'draftConfirm',
      matchId: 1,
      partType: last.result.partType,
      requestId: last.requestId,
      candidateVersion: last.result.candidateVersion,
    });
    const again = await p.b.waitFor('draftResult', (m) => m.requestId === last.requestId);
    expect(again).toMatchObject({
      partType: last.result.partType,
      candidate: last.result.candidate,
      candidateVersion: last.result.candidateVersion,
      drawCount: last.result.drawCount,
      locked: true,
    });
  });
});
