import { describe, expect, it } from 'vitest';
import { ARENA } from '../../shared/arena';

describe('アリーナ', () => {
  it('障害物とスポーンが左右対称', () => {
    const mirrored = ARENA.obstacles.map((o) => ({ ...o, x: ARENA.width - o.x }));
    for (const m of mirrored) {
      expect(ARENA.obstacles).toContainEqual(m);
    }
    expect(ARENA.spawns[0].y).toBe(ARENA.spawns[1].y);
    expect(ARENA.spawns[0].x + ARENA.spawns[1].x).toBe(ARENA.width);
  });

  it('障害物がアリーナ内に収まる', () => {
    for (const o of ARENA.obstacles) {
      expect(o.x - o.width / 2).toBeGreaterThanOrEqual(0);
      expect(o.x + o.width / 2).toBeLessThanOrEqual(ARENA.width);
      expect(o.y - o.height / 2).toBeGreaterThanOrEqual(0);
      expect(o.y + o.height / 2).toBeLessThanOrEqual(ARENA.height);
    }
  });

  it('スポーン間の直線は中央壁で遮られる', () => {
    const [a, b] = ARENA.spawns;
    const center = ARENA.obstacles.find((o) => o.x === ARENA.width / 2 && o.height > o.width);
    expect(center).toBeDefined();
    // スポーン同士は同じ y にあり、中央壁がその y を含む
    expect(a.y).toBe(b.y);
    expect(Math.abs(a.y - center!.y)).toBeLessThan(center!.height / 2);
  });
});
