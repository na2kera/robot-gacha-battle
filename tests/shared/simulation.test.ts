import { describe, expect, it, vi } from 'vitest';
import { ARENA, type ArenaDef } from '../../shared/arena';
import { MAX_STEP_DT, TICK_DT, BATTLE_DURATION_SEC, MUZZLE_GAP } from '../../shared/config';
import { PHASE1_LOADOUT, computeStats, type RobotStats } from '../../shared/parts';
import {
  createBattleState,
  judge,
  stepBattle,
  stepPlayer,
  stepProjectiles,
  tryFire,
  stationary,
  validateInput,
  type BattleState,
  type InputCommand,
  type PlayerState,
  type ProjectileState,
} from '../../shared/simulation';

const STATS = computeStats(PHASE1_LOADOUT);
const EMPTY: ArenaDef = { ...ARENA, obstacles: [] };
/** x=200 に厚さ 4 の薄い壁 */
const THIN: ArenaDef = {
  ...ARENA,
  obstacles: [{ x: 200, y: 270, width: 4, height: 300 }],
};

function cmd(moveX: number, moveY: number, firing = false, aimAngle = 0, seq = 1): InputCommand {
  return { seq, moveX, moveY, aimAngle, firing };
}

function player(id: string, x: number, y: number, over: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    x,
    y,
    hp: STATS.maxHp,
    maxHp: STATS.maxHp,
    radius: STATS.radius,
    aimAngle: 0,
    moveDirAngle: 0,
    fireCooldown: 0,
    alive: true,
    ...over,
  };
}

function bullet(ownerId: string, x: number, y: number, vx: number, vy = 0): ProjectileState {
  return {
    id: 1,
    ownerId,
    x,
    y,
    vx,
    vy,
    radius: STATS.projectileRadius,
    damage: STATS.damage,
    remainingLife: STATS.projectileLifetime,
  };
}

function overlapsRect(p: PlayerState, arena: ArenaDef): boolean {
  return arena.obstacles.some((o) => {
    const cx = Math.min(Math.max(p.x, o.x - o.width / 2), o.x + o.width / 2);
    const cy = Math.min(Math.max(p.y, o.y - o.height / 2), o.y + o.height / 2);
    return Math.hypot(p.x - cx, p.y - cy) < p.radius - 1e-6;
  });
}

describe('stepPlayer 移動', () => {
  it('斜め移動でも速度上限を超えない', () => {
    const start = player('a', 300, 270);
    const normalized = validateInput(
      { seq: 1, moveX: 1, moveY: 1, aimAngle: 0, firing: false },
      0,
    )!;
    for (const input of [normalized, cmd(1, 1)]) {
      const p = stepPlayer(start, input, STATS, TICK_DT, EMPTY);
      const dist = Math.hypot(p.x - start.x, p.y - start.y);
      expect(dist).toBeLessThanOrEqual(STATS.speed * TICK_DT + 1e-9);
      expect(dist).toBeCloseTo(STATS.speed * TICK_DT, 9);
    }
  });

  it('入力長 0.5 で半分の速度', () => {
    const start = player('a', 300, 270);
    const p = stepPlayer(start, cmd(0.3, 0.4), STATS, TICK_DT, EMPTY);
    expect(Math.hypot(p.x - start.x, p.y - start.y)).toBeCloseTo(STATS.speed * TICK_DT * 0.5, 9);
  });

  it('ボディは移動方向を向き、入力がなければ向きを保つ', () => {
    let p = stepPlayer(player('a', 300, 270), cmd(0, 1, false, 2), STATS, TICK_DT, EMPTY);
    expect(p.moveDirAngle).toBeCloseTo(Math.PI / 2, 12);
    expect(p.aimAngle).toBe(2);
    p = stepPlayer(p, cmd(0, 0, false, 1), STATS, TICK_DT, EMPTY);
    expect(p.moveDirAngle).toBeCloseTo(Math.PI / 2, 12);
    expect(p.aimAngle).toBe(1);
    // null は中立で照準も維持
    const q = stepPlayer(p, null, STATS, TICK_DT, EMPTY);
    expect(q.x).toBe(p.x);
    expect(q.y).toBe(p.y);
    expect(q.aimAngle).toBe(1);
  });

  it('障害物の手前で止まり、めり込まない', () => {
    // 中央壁は x 460..500
    let p = player('a', 380, 270);
    for (let i = 0; i < 60; i++) {
      p = stepPlayer(p, cmd(1, 0), STATS, TICK_DT);
      expect(overlapsRect(p, ARENA)).toBe(false);
    }
    expect(p.x).toBeCloseTo(460 - STATS.radius, 6);
    expect(p.y).toBe(270);
  });

  it('壁沿いに滑る', () => {
    let p = player('a', 380, 270);
    for (let i = 0; i < 30; i++) p = stepPlayer(p, cmd(1, 0), STATS, TICK_DT);
    const before = p;
    p = stepPlayer(p, cmd(Math.SQRT1_2, Math.SQRT1_2), STATS, TICK_DT);
    expect(p.x).toBeCloseTo(before.x, 6);
    expect(p.y).toBeGreaterThan(before.y);
    expect(overlapsRect(p, ARENA)).toBe(false);
  });

  it('角でも全障害物にめり込まない', () => {
    const dirs: [number, number][] = [
      [1, 0.3],
      [-0.7, 0.7],
      [0.2, -1],
      [-1, -0.1],
      [0.6, 0.8],
    ];
    let p = player('a', 120, 270);
    for (let i = 0; i < 2000; i++) {
      const d = dirs[Math.floor(i / 97) % dirs.length]!;
      p = stepPlayer(p, cmd(d[0], d[1]), STATS, TICK_DT);
      expect(overlapsRect(p, ARENA)).toBe(false);
      expect(p.x).toBeGreaterThanOrEqual(p.radius);
      expect(p.x).toBeLessThanOrEqual(ARENA.width - p.radius);
      expect(p.y).toBeGreaterThanOrEqual(p.radius);
      expect(p.y).toBeLessThanOrEqual(ARENA.height - p.radius);
    }
  });

  it('角に斜めにぶつかっても固着せず面に沿って滑る', () => {
    // 中央壁の左上角（460,190）へ右下に進む。以前は (441.67,185) 付近で止まっていた
    const dir = Math.SQRT1_2;
    let p = player('a', 441, 185);
    const ys: number[] = [];
    for (let i = 0; i < 30; i++) {
      p = stepPlayer(p, cmd(dir, dir), STATS, TICK_DT);
      expect(overlapsRect(p, ARENA)).toBe(false);
      ys.push(p.y);
    }
    // 角を回り込んで左面に沿って下へ滑り続ける
    for (let i = 5; i < ys.length; i++) {
      expect(ys[i]! - ys[i - 1]!).toBeCloseTo(STATS.speed * TICK_DT * dir, 6);
    }
    expect(p.x).toBeCloseTo(460 - STATS.radius, 6);
    // 上面の角でも同様に右へ滑る（右上から左下ではなく、上から右下へ）
    let q = player('a', 450, 160);
    for (let i = 0; i < 30; i++) {
      q = stepPlayer(q, cmd(dir, dir), STATS, TICK_DT);
      expect(overlapsRect(q, ARENA)).toBe(false);
      if (q.x > 480) break;
    }
    expect(q.x).toBeGreaterThan(470);
    expect(q.y).toBeCloseTo(190 - STATS.radius, 6);
  });

  it('アリーナ境界で止まる', () => {
    let p = player('a', 100, 100);
    for (let i = 0; i < 60; i++)
      p = stepPlayer(p, cmd(-Math.SQRT1_2, -Math.SQRT1_2), STATS, TICK_DT);
    expect(p.x).toBe(STATS.radius);
    expect(p.y).toBe(STATS.radius);
  });

  it('大きな dt でも薄い壁を越えない', () => {
    const fast: RobotStats = { ...STATS, speed: 100000 };
    for (const dt of [1, 1000, MAX_STEP_DT]) {
      const p = stepPlayer(player('a', 150, 270), cmd(1, 0), fast, dt, THIN);
      expect(p.x).toBeLessThanOrEqual(198 - STATS.radius + 1e-6);
    }
    // dt は MAX_STEP_DT までしか進めない
    const q = stepPlayer(player('a', 300, 270), cmd(1, 0), STATS, 10, EMPTY);
    expect(q.x - 300).toBeCloseTo(STATS.speed * MAX_STEP_DT, 9);
  });

  it('不正な dt では動かない', () => {
    for (const dt of [NaN, -1, Infinity]) {
      const p = stepPlayer(player('a', 300, 270), cmd(1, 0), STATS, dt, EMPTY);
      expect(p.x).toBe(300);
    }
  });
});

describe('tryFire', () => {
  it('照準方向の外周の外に弾を出し、発射間隔を守る', () => {
    const p = player('a', 300, 270, { aimAngle: Math.PI / 2 });
    const shot = tryFire(p, cmd(0, 0, true, Math.PI / 2), STATS, TICK_DT, 7);
    expect(shot.projectiles).toHaveLength(1);
    const b = shot.projectiles[0]!;
    expect(b.id).toBe(7);
    expect(shot.nextProjectileId).toBe(8);
    expect(b.x).toBeCloseTo(300, 9);
    expect(b.y).toBeCloseTo(270 + STATS.radius + STATS.projectileRadius + MUZZLE_GAP, 9);
    expect(b.vy).toBeCloseTo(STATS.projectileSpeed, 9);
    expect(shot.player.fireCooldown).toBeCloseTo(STATS.fireInterval - TICK_DT, 12);
    expect(tryFire(shot.player, cmd(0, 0, true), STATS, TICK_DT, 8).projectiles).toHaveLength(0);
    expect(tryFire(p, cmd(0, 0, false), STATS, TICK_DT, 8).projectiles).toHaveLength(0);
    expect(tryFire(p, null, STATS, TICK_DT, 8).projectiles).toHaveLength(0);
  });

  it('spreadDegrees ごとに弾を生成', () => {
    const shotgun = computeStats({ ...PHASE1_LOADOUT, weapon: 'weapon_shotgun' });
    const shot = tryFire(player('a', 300, 270), cmd(0, 0, true), shotgun, TICK_DT, 1);
    expect(shot.projectiles.map((b) => b.id)).toEqual([1, 2, 3, 4, 5]);
    const angles = shot.projectiles.map((b) => (Math.atan2(b.vy, b.vx) * 180) / Math.PI);
    shotgun.spreadDegrees.forEach((deg, i) => expect(angles[i]).toBeCloseTo(deg, 9));
  });

  function fireCounts(inputs: (InputCommand | null)[]): number[] {
    let state = createBattleState([{ id: 'a', stats: STATS, spawn: { x: 120, y: 60 } }], EMPTY);
    const statsById = new Map([['a', STATS]]);
    return inputs.map((input) => {
      const before = state.nextProjectileId;
      state = stepBattle(state, new Map([['a', input]]), statsById, TICK_DT, EMPTY);
      expect(state.players[0]!.fireCooldown).toBeGreaterThanOrEqual(-TICK_DT);
      return state.nextProjectileId - before;
    });
  }
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it('撃ち続けると平均間隔が fireInterval に一致する（3 秒で 20 発）', () => {
    const ticks = Math.round(3 / TICK_DT);
    const counts = fireCounts(Array.from({ length: ticks }, () => cmd(0, 0, true, 0)));
    expect(sum(counts)).toBe(Math.round(3 / STATS.fireInterval));
    // 長時間でも間隔がずれない（30 秒で 200 発）
    const long = fireCounts(
      Array.from({ length: Math.round(30 / TICK_DT) }, () => cmd(0, 0, true)),
    );
    expect(sum(long)).toBe(Math.round(30 / STATS.fireInterval));
  });

  it('撃つのをやめて長く待っても次に押した瞬間に 1 発しか出ない', () => {
    const waitTicks = 600;
    const pressTicks = Math.floor(STATS.fireInterval / TICK_DT);
    const inputs: (InputCommand | null)[] = [
      // 撃ち始めてクールダウンが負になったところでやめる
      ...Array.from({ length: 5 }, () => cmd(0, 0, true)),
      ...Array.from({ length: waitTicks }, (_, i) => (i % 2 === 0 ? null : cmd(0, 0, false))),
      ...Array.from({ length: pressTicks }, () => cmd(0, 0, true)),
    ];
    const counts = fireCounts(inputs);
    const pressed = counts.slice(5 + waitTicks);
    expect(pressed[0]).toBe(1);
    expect(sum(pressed)).toBe(1);
  });

  it('本体中心→銃口が壁に遮られると弾を出さずクールダウンだけ消費する', () => {
    // 中央壁（x 460..500, y 190..350）の左上角に接した位置から、角越しに右上へ撃つ
    const p = player('a', 441, 189, { aimAngle: Math.atan2(-0.1, 1) });
    const shot = tryFire(p, cmd(0, 0, true, p.aimAngle), STATS, TICK_DT, 3, ARENA);
    expect(shot.projectiles).toHaveLength(0);
    expect(shot.nextProjectileId).toBe(3);
    expect(shot.player.fireCooldown).toBeCloseTo(STATS.fireInterval - TICK_DT, 12);
    // 障害物がなければ撃てる
    expect(
      tryFire(p, cmd(0, 0, true, p.aimAngle), STATS, TICK_DT, 3, EMPTY).projectiles,
    ).toHaveLength(1);
  });
});

describe('stepProjectiles', () => {
  it('低 tick（弾速 520、dt 0.2）でも薄い壁をすり抜けない', () => {
    const b = bullet('a', 150, 270, 520);
    const free = stepProjectiles([b], [], 0.2, EMPTY);
    expect(free.projectiles).toHaveLength(1);
    expect(free.projectiles[0]!.x).toBeCloseTo(254, 9);
    const blocked = stepProjectiles([b], [], 0.2, THIN);
    expect(blocked.projectiles).toHaveLength(0);
  });

  it('アリーナ境界で消える', () => {
    const r = stepProjectiles([bullet('a', 950, 270, 520)], [], TICK_DT, EMPTY);
    expect(r.projectiles).toHaveLength(0);
  });

  it('寿命切れで消える', () => {
    const b = { ...bullet('a', 300, 270, 10), remainingLife: TICK_DT / 2 };
    expect(stepProjectiles([b], [], TICK_DT, EMPTY).projectiles).toHaveLength(0);
    const c = { ...bullet('a', 300, 270, 10), remainingLife: TICK_DT * 2 };
    expect(stepProjectiles([c], [], TICK_DT, EMPTY).projectiles).toHaveLength(1);
  });

  it('相手ロボットに当たって消え、ダメージを集計する', () => {
    const target = player('b', 400, 270);
    // dt 0.2 で 104 進む。ロボットを飛び越える位置関係でも当たる
    const r = stepProjectiles([bullet('a', 340, 270, 520)], [stationary(target)], 0.2, EMPTY);
    expect(r.projectiles).toHaveLength(0);
    expect(r.damageById.get('b')).toBe(STATS.damage);
  });

  it('壁の向こうのロボットには当たらない', () => {
    const target = player('b', 230, 270);
    const r = stepProjectiles([bullet('a', 150, 270, 520)], [stationary(target)], 0.2, THIN);
    expect(r.projectiles).toHaveLength(0);
    expect(r.damageById.size).toBe(0);
  });

  it('横切る相手にも当たる（相対運動の sweep）', () => {
    // 弾は (300,270)→(404,270)。相手は x=352 を y 245→295 へ横切る。前後どちらの位置でも静止円なら外れる
    const b = bullet('a', 300, 270, 520);
    const prev = player('b', 352, 245);
    const next = player('b', 352, 295);
    expect(stepProjectiles([b], [stationary(prev)], 0.2, EMPTY).damageById.size).toBe(0);
    expect(stepProjectiles([b], [stationary(next)], 0.2, EMPTY).damageById.size).toBe(0);
    const r = stepProjectiles([b], [{ prev, next }], 0.2, EMPTY);
    expect(r.projectiles).toHaveLength(0);
    expect(r.damageById.get('b')).toBe(STATS.damage);
  });

  it('自分の弾は自分に当たらない', () => {
    const self = player('a', 300, 270);
    const r = stepProjectiles([bullet('a', 300, 270, 520)], [stationary(self)], TICK_DT, EMPTY);
    expect(r.projectiles).toHaveLength(1);
    expect(r.damageById.size).toBe(0);
  });

  it('倒れたロボットには当たらない', () => {
    const dead = player('b', 320, 270, { hp: 0, alive: false });
    const r = stepProjectiles([bullet('a', 300, 270, 520)], [stationary(dead)], TICK_DT, EMPTY);
    expect(r.projectiles).toHaveLength(1);
  });
});

function twoPlayerState(over: Partial<BattleState> = {}): BattleState {
  return {
    ...createBattleState(
      [
        { id: 'a', stats: STATS, spawn: { x: 300, y: 270 } },
        { id: 'b', stats: STATS, spawn: { x: 600, y: 270 } },
      ],
      EMPTY,
    ),
    ...over,
  };
}
const STATS_BY_ID = new Map([
  ['a', STATS],
  ['b', STATS],
]);

describe('stepBattle', () => {
  it('弾が相手に当たると HP が減り弾が消える', () => {
    let state = twoPlayerState();
    state = stepBattle(state, new Map([['a', cmd(0, 0, true, 0)]]), STATS_BY_ID, TICK_DT, EMPTY);
    expect(state.projectiles).toHaveLength(1);
    for (let i = 0; i < 30 && state.projectiles.length > 0; i++) {
      state = stepBattle(state, new Map(), STATS_BY_ID, TICK_DT, EMPTY);
    }
    expect(state.projectiles).toHaveLength(0);
    expect(state.players.find((p) => p.id === 'b')!.hp).toBe(STATS.maxHp - STATS.damage);
    expect(state.players.find((p) => p.id === 'a')!.hp).toBe(STATS.maxHp);
  });

  it('同 tick の同時 KO は引き分け（処理順に依存しない）', () => {
    const base = twoPlayerState();
    const players = base.players.map((p) => ({ ...p, hp: 1 }));
    const projectiles = [
      { ...bullet('a', 570, 270, 520), id: 1 },
      { ...bullet('b', 330, 270, -520), id: 2 },
    ];
    const run = (ps: PlayerState[], bs: ProjectileState[]) => {
      const s = stepBattle(
        { ...base, players: ps, projectiles: bs },
        new Map(),
        STATS_BY_ID,
        TICK_DT,
        EMPTY,
      );
      return judge(s, BATTLE_DURATION_SEC);
    };
    const r1 = run(players, projectiles);
    const r2 = run([...players].reverse(), [...projectiles].reverse());
    expect(r1).toEqual({ winnerId: null, reason: 'double_ko', hpRatios: { a: 0, b: 0 } });
    expect(r2).toEqual(r1);
  });

  it('入力 null は中立で照準を維持', () => {
    const state = twoPlayerState();
    const s1 = stepBattle(
      state,
      new Map([['a', cmd(1, 0, false, 1)]]),
      STATS_BY_ID,
      TICK_DT,
      EMPTY,
    );
    const s2 = stepBattle(s1, new Map([['a', null]]), STATS_BY_ID, TICK_DT, EMPTY);
    const a1 = s1.players[0]!;
    const a2 = s2.players[0]!;
    expect(a2.x).toBe(a1.x);
    expect(a2.aimAngle).toBe(1);
    expect(s2.projectiles).toHaveLength(0);
    expect(s2.tick).toBe(2);
    expect(s2.elapsedSec).toBeCloseTo(TICK_DT * 2, 12);
  });

  it('不正な dt では状態が変わらない', () => {
    const state = twoPlayerState({ projectiles: [bullet('a', 570, 270, 520)] });
    const inputs = new Map([['a', cmd(1, 0, true)]]);
    for (const dt of [NaN, -1, 0, Infinity, -Infinity]) {
      const next = stepBattle(state, inputs, STATS_BY_ID, dt, EMPTY);
      expect(next).toBe(state);
      expect(next.tick).toBe(0);
    }
  });

  it('元の state を変更しない', () => {
    const state = twoPlayerState();
    const snapshot = structuredClone(state);
    stepBattle(state, new Map([['a', cmd(1, 0, true)]]), STATS_BY_ID, TICK_DT, EMPTY);
    expect(state).toEqual(snapshot);
  });

  it('決定的（同じ入力で同じ結果）で Math.random を使わない', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random は使わない');
    });
    const simulate = () => {
      let state = createBattleState([
        { id: 'a', stats: STATS, spawn: ARENA.spawns[0] },
        { id: 'b', stats: STATS, spawn: ARENA.spawns[1] },
      ]);
      for (let i = 0; i < 600; i++) {
        const t = i * 0.37;
        const inputs = new Map<string, InputCommand | null>([
          ['a', cmd(Math.cos(t), Math.sin(t * 1.3) * 0.8, i % 3 !== 0, t * 0.5, i + 1)],
          [
            'b',
            i % 50 < 10 ? null : cmd(-Math.sin(t), Math.cos(t), true, Math.PI - t * 0.4, i + 1),
          ],
        ]);
        state = stepBattle(state, inputs, STATS_BY_ID, TICK_DT);
      }
      return state;
    };
    const s1 = simulate();
    const s2 = simulate();
    expect(s2).toEqual(s1);
    expect(s1.tick).toBe(600);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('judge', () => {
  const at = (hpA: number, hpB: number, elapsedSec: number, maxB = STATS.maxHp) => {
    const s = twoPlayerState({ elapsedSec });
    s.players[0]!.hp = hpA;
    s.players[1]!.hp = hpB;
    s.players[1]!.maxHp = maxB;
    return judge(s, BATTLE_DURATION_SEC);
  };

  it('試合中は null', () => {
    expect(at(50, 60, 10)).toBeNull();
  });

  it('一方が HP 0 以下なら相手の勝ち', () => {
    expect(at(0, 60, 10)).toMatchObject({ winnerId: 'b', reason: 'ko' });
    expect(at(30, -5, 10)).toMatchObject({ winnerId: 'a', reason: 'ko' });
  });

  it('両者 HP 0 以下は引き分け', () => {
    expect(at(0, -3, 10)).toMatchObject({ winnerId: null, reason: 'double_ko' });
  });

  it('時間切れは HP 比率が高い方の勝ち', () => {
    // a: 60/120 = 0.5、b: 90/200 = 0.45。HP の絶対値は b が上でも a の勝ち
    const r = at(60, 90, BATTLE_DURATION_SEC, 200);
    expect(r).toEqual({ winnerId: 'a', reason: 'timeout', hpRatios: { a: 0.5, b: 0.45 } });
  });

  it('時間切れで同率は引き分け', () => {
    expect(at(60, 100, BATTLE_DURATION_SEC, 200)).toMatchObject({
      winnerId: null,
      reason: 'timeout_draw',
    });
  });

  it('小数ダメージの累積誤差は同率として引き分け', () => {
    let a = STATS.maxHp;
    let b = STATS.maxHp;
    for (let i = 0; i < 15; i++) a -= 6.6;
    for (let i = 0; i < 18; i++) b -= 5.5;
    // 実値は 21.000000000000036 と 21
    expect(a).not.toBe(b);
    expect(at(a, b, BATTLE_DURATION_SEC)).toMatchObject({ winnerId: null, reason: 'timeout_draw' });
  });

  it('TICK_DT の積算で 90 秒に達したら時間切れ', () => {
    let elapsed = 0;
    for (let i = 0; i < BATTLE_DURATION_SEC / TICK_DT; i++) elapsed += TICK_DT;
    expect(at(60, 100, elapsed, 200)).not.toBeNull();
  });
});
