/** パーツの表示名と性能一覧。数値は shared/parts.ts の値をそのまま出す */
import {
  BODIES,
  CORES,
  LEGS,
  WEAPONS,
  type Loadout,
  type PartId,
  type PartType,
} from '../../shared/parts';
import { ja } from '../i18n/ja';

export function partName(id: PartId | null): string {
  if (id === null) return ja.stats.none;
  const def =
    BODIES[id as keyof typeof BODIES] ??
    LEGS[id as keyof typeof LEGS] ??
    WEAPONS[id as keyof typeof WEAPONS] ??
    CORES[id as keyof typeof CORES];
  return def?.name ?? id;
}

const mul = (v: number) => `×${v}`;
const plus = (v: number) => `+${v}`;

/** [ラベル, 値] の一覧 */
export function partStatRows(type: PartType, id: PartId): [string, string][] {
  const s = ja.stats;
  switch (type) {
    case 'body': {
      const d = BODIES[id as keyof typeof BODIES];
      return [
        [s.maxHp, String(d.maxHp)],
        [s.radius, String(d.radius)],
      ];
    }
    case 'legs': {
      const d = LEGS[id as keyof typeof LEGS];
      return [
        [s.speed, String(d.speed)],
        [s.hpMultiplier, mul(d.hpMultiplier)],
      ];
    }
    case 'weapon': {
      const d = WEAPONS[id as keyof typeof WEAPONS];
      return [
        [s.damage, String(d.damage)],
        [s.fireInterval, String(d.fireInterval)],
        [s.projectileSpeed, String(d.projectileSpeed)],
        [s.projectileLifetime, String(d.projectileLifetime)],
        [s.projectileRadius, String(d.projectileRadius)],
        [s.shots, String(d.spreadDegrees.length)],
      ];
    }
    case 'core': {
      const d = CORES[id as keyof typeof CORES];
      return [
        [s.hpBonus, plus(d.hpBonus)],
        [s.speedMultiplier, mul(d.speedMultiplier)],
        [s.damageMultiplier, mul(d.damageMultiplier)],
        [s.fireIntervalMultiplier, mul(d.fireIntervalMultiplier)],
      ];
    }
  }
}

/** 構成を「部位: 名前」の行に */
export function loadoutLines(l: Loadout): string[] {
  const n = ja.draft.partNames;
  return [
    `${n.body}: ${partName(l.body)}`,
    `${n.legs}: ${partName(l.legs)}`,
    `${n.weapon}: ${partName(l.weapon)}`,
    `${n.core}: ${partName(l.core)}`,
  ];
}
