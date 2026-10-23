import { describe, expect, it } from 'vitest';
import { BODIES, CORES, LEGS, PART_IDS_BY_TYPE, WEAPONS, computeStats } from '../../shared/parts';

describe('パーツ定義', () => {
  it('各部位に 3 種類ある', () => {
    expect(PART_IDS_BY_TYPE.body).toHaveLength(3);
    expect(PART_IDS_BY_TYPE.legs).toHaveLength(3);
    expect(PART_IDS_BY_TYPE.weapon).toHaveLength(3);
    expect(PART_IDS_BY_TYPE.core).toHaveLength(3);
  });

  it('ID とキーが一致する', () => {
    for (const table of [BODIES, LEGS, WEAPONS, CORES]) {
      for (const [key, def] of Object.entries(table)) {
        expect(def.id).toBe(key);
      }
    }
  });
});

describe('computeStats', () => {
  it('コアなしの固定構成', () => {
    const s = computeStats({
      body: 'body_standard',
      legs: 'legs_biped',
      weapon: 'weapon_machinegun',
      core: null,
    });
    expect(s.maxHp).toBe(120);
    expect(s.speed).toBe(180);
    expect(s.damage).toBe(6);
    expect(s.fireInterval).toBe(0.15);
    expect(s.radius).toBe(19);
  });

  it('HP はボディ → 脚 → コアの順で計算し最後に四捨五入', () => {
    // 90 × 0.85 = 76.5 → +20 = 96.5 → 97
    const s = computeStats({
      body: 'body_light',
      legs: 'legs_hover',
      weapon: 'weapon_cannon',
      core: 'core_vital',
    });
    expect(s.maxHp).toBe(97);
    // 160 × 1.15 = 184 → +20 = 204
    expect(
      computeStats({
        body: 'body_heavy',
        legs: 'legs_tank',
        weapon: 'weapon_cannon',
        core: 'core_vital',
      }).maxHp,
    ).toBe(204);
  });

  it('機動コアは速度 1.10 倍', () => {
    const s = computeStats({
      body: 'body_standard',
      legs: 'legs_hover',
      weapon: 'weapon_shotgun',
      core: 'core_boost',
    });
    expect(s.speed).toBeCloseTo(242);
  });

  it('火力コアはダメージ 1.10 倍、間隔 1.05 倍', () => {
    const s = computeStats({
      body: 'body_standard',
      legs: 'legs_biped',
      weapon: 'weapon_cannon',
      core: 'core_power',
    });
    expect(s.damage).toBeCloseTo(30.8);
    expect(s.fireInterval).toBeCloseTo(0.8925);
  });
});
