/**
 * パーツ定義と性能計算。仕様書 5 章の初期値。
 * 表示名と内部 ID を分離し、数値はここにだけ置く。
 */

export type PartType = 'body' | 'legs' | 'weapon' | 'core';

export type BodyId = 'body_light' | 'body_standard' | 'body_heavy';
export type LegsId = 'legs_hover' | 'legs_biped' | 'legs_tank';
export type WeaponId = 'weapon_machinegun' | 'weapon_cannon' | 'weapon_shotgun';
export type CoreId = 'core_vital' | 'core_boost' | 'core_power';
export type PartId = BodyId | LegsId | WeaponId | CoreId;

export interface BodyDef {
  id: BodyId;
  name: string;
  maxHp: number;
  radius: number;
}

export interface LegsDef {
  id: LegsId;
  name: string;
  speed: number;
  hpMultiplier: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** 1 発あたりのダメージ */
  damage: number;
  /** 発射間隔（秒） */
  fireInterval: number;
  /** 弾速（ワールド単位/秒） */
  projectileSpeed: number;
  /** 弾の寿命（秒） */
  projectileLifetime: number;
  projectileRadius: number;
  /** 発射角のオフセット（度）。要素数が同時発射数 */
  spreadDegrees: readonly number[];
}

export interface CoreDef {
  id: CoreId;
  name: string;
  /** 脚補正後の最大 HP に加算 */
  hpBonus: number;
  speedMultiplier: number;
  damageMultiplier: number;
  fireIntervalMultiplier: number;
}

export const BODIES: Readonly<Record<BodyId, BodyDef>> = {
  body_light: { id: 'body_light', name: 'ライト', maxHp: 90, radius: 16 },
  body_standard: { id: 'body_standard', name: 'スタンダード', maxHp: 120, radius: 19 },
  body_heavy: { id: 'body_heavy', name: 'ヘビー', maxHp: 160, radius: 23 },
};

export const LEGS: Readonly<Record<LegsId, LegsDef>> = {
  legs_hover: { id: 'legs_hover', name: 'ホバー', speed: 220, hpMultiplier: 0.85 },
  legs_biped: { id: 'legs_biped', name: '二足', speed: 180, hpMultiplier: 1 },
  legs_tank: { id: 'legs_tank', name: 'キャタピラ', speed: 145, hpMultiplier: 1.15 },
};

export const WEAPONS: Readonly<Record<WeaponId, WeaponDef>> = {
  weapon_machinegun: {
    id: 'weapon_machinegun',
    name: 'マシンガン',
    damage: 6,
    fireInterval: 0.15,
    projectileSpeed: 520,
    projectileLifetime: 1.2,
    projectileRadius: 3,
    spreadDegrees: [0],
  },
  weapon_cannon: {
    id: 'weapon_cannon',
    name: '大砲',
    damage: 28,
    fireInterval: 0.85,
    projectileSpeed: 360,
    projectileLifetime: 1.8,
    projectileRadius: 7,
    spreadDegrees: [0],
  },
  weapon_shotgun: {
    id: 'weapon_shotgun',
    name: 'ショットガン',
    damage: 5,
    fireInterval: 0.65,
    projectileSpeed: 430,
    projectileLifetime: 0.6,
    projectileRadius: 3,
    spreadDegrees: [-16, -8, 0, 8, 16],
  },
};

export const CORES: Readonly<Record<CoreId, CoreDef>> = {
  core_vital: {
    id: 'core_vital',
    name: '耐久',
    hpBonus: 20,
    speedMultiplier: 1,
    damageMultiplier: 1,
    fireIntervalMultiplier: 1,
  },
  core_boost: {
    id: 'core_boost',
    name: '機動',
    hpBonus: 0,
    speedMultiplier: 1.1,
    damageMultiplier: 1,
    fireIntervalMultiplier: 1,
  },
  core_power: {
    id: 'core_power',
    name: '火力',
    hpBonus: 0,
    speedMultiplier: 1,
    damageMultiplier: 1.1,
    fireIntervalMultiplier: 1.05,
  },
};

export const PART_IDS_BY_TYPE = {
  body: Object.keys(BODIES) as BodyId[],
  legs: Object.keys(LEGS) as LegsId[],
  weapon: Object.keys(WEAPONS) as WeaponId[],
  core: Object.keys(CORES) as CoreId[],
} as const satisfies Record<PartType, readonly PartId[]>;

/** ロボット 1 体の構成。core は未装備（フェーズ1）を許す */
export interface Loadout {
  body: BodyId;
  legs: LegsId;
  weapon: WeaponId;
  core: CoreId | null;
}

/** 計算済み性能。ダメージ・間隔は小数で保持し、表示時にだけ丸める */
export interface RobotStats {
  maxHp: number;
  radius: number;
  speed: number;
  damage: number;
  fireInterval: number;
  projectileSpeed: number;
  projectileLifetime: number;
  projectileRadius: number;
  spreadDegrees: readonly number[];
}

/** 計算順はボディ → 脚 → コア。HP だけ最後に整数へ四捨五入 */
export function computeStats(loadout: Loadout): RobotStats {
  const body = BODIES[loadout.body];
  const legs = LEGS[loadout.legs];
  const weapon = WEAPONS[loadout.weapon];
  const core = loadout.core ? CORES[loadout.core] : null;

  const hpAfterLegs = body.maxHp * legs.hpMultiplier;
  const maxHp = Math.round(hpAfterLegs + (core?.hpBonus ?? 0));
  const speed = legs.speed * (core?.speedMultiplier ?? 1);
  const damage = weapon.damage * (core?.damageMultiplier ?? 1);
  const fireInterval = weapon.fireInterval * (core?.fireIntervalMultiplier ?? 1);

  return {
    maxHp,
    radius: body.radius,
    speed,
    damage,
    fireInterval,
    projectileSpeed: weapon.projectileSpeed,
    projectileLifetime: weapon.projectileLifetime,
    projectileRadius: weapon.projectileRadius,
    spreadDegrees: weapon.spreadDegrees,
  };
}

/** フェーズ1の固定構成 */
export const PHASE1_LOADOUT: Loadout = {
  body: 'body_standard',
  legs: 'legs_biped',
  weapon: 'weapon_machinegun',
  core: null,
};
