/**
 * 共有シミュレーション。仕様書 6・11 章。サーバーが正、クライアントは自機予測に再利用する。
 * 乱数を使わず、同じ入力から常に同じ結果を返す。
 */
import { ARENA, type ArenaDef, type Vec2 } from './arena';
import { resolveCircleRect, sweepSegmentCircle, sweepSegmentWalls } from './collision';
import {
  HP_RATIO_EPSILON,
  MAX_STEP_DT,
  MOVE_SUBSTEP_MAX_DISTANCE,
  MUZZLE_GAP,
  SIM_EPSILON,
} from './config';
import type { InputCommand } from './input';
import type { RobotStats } from './parts';

export type { InputCommand } from './input';
export { validateInput } from './input';

export interface PlayerState {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** 判定半径 */
  radius: number;
  /** 武器の向き（ラジアン） */
  aimAngle: number;
  /** ボディの向き（ラジアン）。移動入力がある時だけ更新 */
  moveDirAngle: number;
  /** 次に撃てるまでの残り秒。0 以下で発射可能 */
  fireCooldown: number;
  alive: boolean;
}

export interface ProjectileState {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  /** 残り寿命（秒） */
  remainingLife: number;
}

export interface BattleState {
  tick: number;
  elapsedSec: number;
  players: PlayerState[];
  projectiles: ProjectileState[];
  nextProjectileId: number;
}

/** 1 step 内のロボットの前後の状態。弾との相対運動の判定に使う */
export interface PlayerMotion {
  prev: PlayerState;
  next: PlayerState;
}

/** 前後が同じ（静止）として扱う */
export function stationary(player: PlayerState): PlayerMotion {
  return { prev: player, next: player };
}

export interface PlayerSetup {
  id: string;
  stats: RobotStats;
  spawn: Vec2;
}

export type JudgeReason = 'ko' | 'double_ko' | 'timeout' | 'timeout_draw';

export interface JudgeResult {
  /** 引き分けは null */
  winnerId: string | null;
  reason: JudgeReason;
  /** 現在 HP / 最大 HP */
  hpRatios: Record<string, number>;
}

/** 不正な dt を 0..MAX_STEP_DT に収める */
function sanitizeDt(dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return Math.min(dt, MAX_STEP_DT);
}

export function createBattleState(
  players: readonly PlayerSetup[],
  arena: ArenaDef = ARENA,
): BattleState {
  return {
    tick: 0,
    elapsedSec: 0,
    players: players.map(({ id, stats, spawn }) => {
      // 初期の向きはアリーナ中央向き（左右対称）
      const facing = spawn.x <= arena.width / 2 ? 0 : Math.PI;
      return {
        id,
        x: spawn.x,
        y: spawn.y,
        hp: stats.maxHp,
        maxHp: stats.maxHp,
        radius: stats.radius,
        aimAngle: facing,
        moveDirAngle: facing,
        fireCooldown: 0,
        alive: true,
      };
    }),
    projectiles: [],
    nextProjectileId: 1,
  };
}

/**
 * 移動と照準の更新。加速なしで stats.speed × 入力長へ即到達。
 * 1 step の dt は MAX_STEP_DT までに制限し、さらにサブステップに分けて壁を飛び越えない。
 * 各サブステップで x → y の順に動かし、その都度障害物とのめり込みを接触法線方向に解消する
 * （面では軸方向、角では角→中心方向。壁沿い・角沿いに滑る）。境界は clamp。
 * 入力 null は中立（移動なし、照準維持）。発射クールダウンは tryFire が扱う
 */
export function stepPlayer(
  player: PlayerState,
  input: InputCommand | null,
  stats: RobotStats,
  dt: number,
  arena: ArenaDef = ARENA,
): PlayerState {
  const next: PlayerState = { ...player };
  const stepDt = sanitizeDt(dt);
  if (!player.alive || input === null) return next;

  next.aimAngle = input.aimAngle;

  const len = Math.hypot(input.moveX, input.moveY);
  if (len <= 0) return next;
  next.moveDirAngle = Math.atan2(input.moveY, input.moveX);

  const scale = Math.min(len, 1);
  const distance = stats.speed * scale * stepDt;
  const dirX = input.moveX / len;
  const dirY = input.moveY / len;
  const substeps = Math.max(1, Math.ceil(distance / MOVE_SUBSTEP_MAX_DISTANCE));
  const stepX = (dirX * distance) / substeps;
  const stepY = (dirY * distance) / substeps;
  const r = player.radius;

  const clamp = (v: Vec2): Vec2 => ({
    x: Math.min(Math.max(v.x, r), arena.width - r),
    y: Math.min(Math.max(v.y, r), arena.height - r),
  });
  let pos: Vec2 = { x: player.x, y: player.y };
  for (let i = 0; i < substeps; i++) {
    if (stepX !== 0) {
      pos = { x: pos.x + stepX, y: pos.y };
      for (const rect of arena.obstacles) pos = resolveCircleRect(pos, r, rect, 'x', stepX);
      pos = clamp(pos);
    }
    if (stepY !== 0) {
      pos = { x: pos.x, y: pos.y + stepY };
      for (const rect of arena.obstacles) pos = resolveCircleRect(pos, r, rect, 'y', stepY);
      pos = clamp(pos);
    }
  }
  next.x = pos.x;
  next.y = pos.y;
  return next;
}

/**
 * firing かつクールダウン切れなら spreadDegrees ごとに弾を生成する。
 * 弾は本体中心から radius + 弾半径 + MUZZLE_GAP だけ照準方向（オフセット前）に進めた位置に出す。
 * 本体中心→銃口の区間が障害物・境界に遮られる場合は弾を出さない（クールダウンは消費する）。
 * クールダウンは「step 開始時点で次に撃てるまでの残り秒」。発射判定の後に dt だけ減らす。
 * 撃ち続けている間はクールダウンの負の超過分を持ち越して平均間隔を fireInterval に保ち、
 * 撃っていない間は 0 に clamp して発射権を貯めない
 */
export function tryFire(
  player: PlayerState,
  input: InputCommand | null,
  stats: RobotStats,
  dt: number,
  nextProjectileId: number,
  arena: ArenaDef = ARENA,
): { player: PlayerState; projectiles: ProjectileState[]; nextProjectileId: number } {
  const stepDt = sanitizeDt(dt);
  if (!player.alive || input === null || !input.firing) {
    const fireCooldown = Math.max(player.fireCooldown - stepDt, 0);
    return { player: { ...player, fireCooldown }, projectiles: [], nextProjectileId };
  }
  if (player.fireCooldown > SIM_EPSILON) {
    return {
      player: { ...player, fireCooldown: player.fireCooldown - stepDt },
      projectiles: [],
      nextProjectileId,
    };
  }
  // dt が間隔より長くても 1 step 1 回まで。持ち越す借りは 1 step 分（-dt）までに留める
  const fireCooldown = Math.max(player.fireCooldown + stats.fireInterval, 0) - stepDt;
  const muzzle = player.radius + stats.projectileRadius + MUZZLE_GAP;
  const originX = player.x + Math.cos(player.aimAngle) * muzzle;
  const originY = player.y + Math.sin(player.aimAngle) * muzzle;
  const blocked = sweepSegmentWalls(
    player,
    { x: originX, y: originY },
    stats.projectileRadius,
    arena,
  );
  if (blocked !== null) {
    return { player: { ...player, fireCooldown }, projectiles: [], nextProjectileId };
  }
  let id = nextProjectileId;
  const projectiles = stats.spreadDegrees.map((deg) => {
    const angle = player.aimAngle + (deg * Math.PI) / 180;
    return {
      id: id++,
      ownerId: player.id,
      x: originX,
      y: originY,
      vx: Math.cos(angle) * stats.projectileSpeed,
      vy: Math.sin(angle) * stats.projectileSpeed,
      radius: stats.projectileRadius,
      damage: stats.damage,
      remainingLife: stats.projectileLifetime,
    };
  });
  return {
    player: { ...player, fireCooldown },
    projectiles,
    nextProjectileId: id,
  };
}

/**
 * 弾を前位置→次位置の線分で掃引し、最初に当たったものを採用する。
 * 障害物・境界に当たると消滅、相手ロボットに当たると命中して消滅。
 * ロボットは step 内で prev → next へ等速移動するとみなし、弾の相手に対する相対運動を
 * 原点の静止円に対して掃引する（横切る相手を取りこぼさない）。
 * 同時刻なら壁を優先。自分の弾は自分に当たらない。寿命内の距離だけ進み、尽きたら消滅。
 * ダメージは集計して返すだけで、適用は呼び出し側で全弾処理後に行う
 */
const ORIGIN: Vec2 = { x: 0, y: 0 };

export function stepProjectiles(
  projectiles: readonly ProjectileState[],
  players: readonly PlayerMotion[],
  dt: number,
  arena: ArenaDef = ARENA,
): { projectiles: ProjectileState[]; damageById: Map<string, number> } {
  const stepDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const survivors: ProjectileState[] = [];
  const damageById = new Map<string, number>();

  for (const p of projectiles) {
    const travel = Math.min(stepDt, Math.max(p.remainingLife, 0));
    const p0 = { x: p.x, y: p.y };
    const p1 = { x: p.x + p.vx * travel, y: p.y + p.vy * travel };

    const wallT = sweepSegmentWalls(p0, p1, p.radius, arena);
    // 弾が進む時間に対応する、相手の移動の割合
    const fraction = stepDt > 0 ? travel / stepDt : 0;

    let hitT: number | null = null;
    let hitId: string | null = null;
    for (const { prev, next: target } of players) {
      if (!target.alive || target.id === p.ownerId) continue;
      const endX = prev.x + (target.x - prev.x) * fraction;
      const endY = prev.y + (target.y - prev.y) * fraction;
      const rel0 = { x: p0.x - prev.x, y: p0.y - prev.y };
      const rel1 = { x: p1.x - endX, y: p1.y - endY };
      const t = sweepSegmentCircle(rel0, rel1, ORIGIN, target.radius + p.radius);
      if (t !== null && (hitT === null || t < hitT)) {
        hitT = t;
        hitId = target.id;
      }
    }

    if (hitT !== null && hitId !== null && (wallT === null || hitT < wallT)) {
      damageById.set(hitId, (damageById.get(hitId) ?? 0) + p.damage);
      continue;
    }
    if (wallT !== null) continue;

    const remainingLife = p.remainingLife - stepDt;
    if (remainingLife <= 0) continue;
    survivors.push({ ...p, x: p1.x, y: p1.y, remainingLife });
  }
  return { projectiles: survivors, damageById };
}

/**
 * 1 step 進める。順序: 移動・照準 → 発射 → 弾の移動と命中 → ダメージの同時適用。
 * inputs に無い、または null のプレイヤーは中立。元の state は変更しない。
 * dt が不正（NaN・0 以下・Infinity）なら何もせず state をそのまま返す
 */
export function stepBattle(
  state: BattleState,
  inputs: ReadonlyMap<string, InputCommand | null>,
  statsById: ReadonlyMap<string, RobotStats>,
  dt: number,
  arena: ArenaDef = ARENA,
): BattleState {
  const stepDt = sanitizeDt(dt);
  if (stepDt === 0) return state;
  let nextProjectileId = state.nextProjectileId;
  const fired: ProjectileState[] = [];

  const players = state.players.map((player) => {
    const stats = statsById.get(player.id);
    if (!stats) throw new Error(`stats が未定義: ${player.id}`);
    const input = inputs.get(player.id) ?? null;
    const moved = stepPlayer(player, input, stats, stepDt, arena);
    const shot = tryFire(moved, input, stats, stepDt, nextProjectileId, arena);
    nextProjectileId = shot.nextProjectileId;
    fired.push(...shot.projectiles);
    return shot.player;
  });

  const { projectiles, damageById } = stepProjectiles(
    [...state.projectiles, ...fired],
    players.map((next, i) => ({ prev: state.players[i]!, next })),
    stepDt,
    arena,
  );

  for (const player of players) {
    const damage = damageById.get(player.id);
    if (damage === undefined) continue;
    player.hp = Math.max(0, player.hp - damage);
    if (player.hp <= 0) player.alive = false;
  }

  return {
    tick: state.tick + 1,
    elapsedSec: state.elapsedSec + stepDt,
    players,
    projectiles,
    nextProjectileId,
  };
}

/**
 * 勝敗判定。決着がついていなければ null。
 * 全員 HP 0 以下 → double_ko（引き分け）、1 人だけ残る → ko、
 * 時間切れ → HP 比率が最も高い 1 人の勝ち、最高比率が並べば timeout_draw
 */
export function judge(state: BattleState, durationSec: number): JudgeResult | null {
  const hpRatios: Record<string, number> = {};
  for (const p of state.players) {
    hpRatios[p.id] = p.maxHp > 0 ? Math.max(0, p.hp) / p.maxHp : 0;
  }
  const alive = state.players.filter((p) => p.hp > 0);
  if (alive.length === 0) return { winnerId: null, reason: 'double_ko', hpRatios };
  if (alive.length === 1 && state.players.length > 1) {
    return { winnerId: alive[0]!.id, reason: 'ko', hpRatios };
  }
  if (state.elapsedSec < durationSec - SIM_EPSILON) return null;

  // 小数ダメージの累積誤差で勝敗を決めないよう、HP_RATIO_EPSILON 以内は同率とみなす
  const bestRatio = Math.max(...alive.map((p) => hpRatios[p.id]!));
  const leaders = alive.filter((p) => hpRatios[p.id]! >= bestRatio - HP_RATIO_EPSILON);
  const tied = leaders.length > 1;
  const best = leaders[0]!.id;
  if (tied) return { winnerId: null, reason: 'timeout_draw', hpRatios };
  return { winnerId: best, reason: 'timeout', hpRatios };
}
