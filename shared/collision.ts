/**
 * 円と軸平行矩形の幾何計算。シミュレーション専用の純粋関数。
 */
import type { Rect, Vec2 } from './arena';
import { SIM_EPSILON } from './config';

export type Axis = 'x' | 'y';

/**
 * 円を 1 軸だけ動かした後、矩形とのめり込みを解消した位置を返す（最近接点からの接触法線で押し出す）。
 * - 角接触（中心が x・y 両方の範囲外）: 角から中心への方向へ押し出す。
 *   軸ごとの押し戻しだと角で両軸が打ち消し合って固着するため
 * - 面接触（中心がどちらかの範囲内）: その面の法線方向（軸方向）へ押し出す
 * - 中心が矩形内: delta（その軸の移動量）と逆向きにその軸で押し戻す
 */
export function resolveCircleRect(
  pos: Vec2,
  radius: number,
  rect: Rect,
  axis: Axis,
  delta: number,
): Vec2 {
  const minX = rect.x - rect.width / 2;
  const maxX = rect.x + rect.width / 2;
  const minY = rect.y - rect.height / 2;
  const maxY = rect.y + rect.height / 2;
  const cx = Math.min(Math.max(pos.x, minX), maxX);
  const cy = Math.min(Math.max(pos.y, minY), maxY);
  const dx = pos.x - cx;
  const dy = pos.y - cy;
  const distSq = dx * dx + dy * dy;
  // 重なっていない（接触ちょうどを含む）
  if (distSq >= (radius - SIM_EPSILON) * (radius - SIM_EPSILON)) return pos;

  if (dx !== 0 && dy !== 0) {
    const dist = Math.sqrt(distSq);
    return { x: cx + (dx / dist) * radius, y: cy + (dy / dist) * radius };
  }
  // 面接触: 中心が外にある側の面の法線方向へ押し出す
  if (dx !== 0) return { x: cx + Math.sign(dx) * radius, y: pos.y };
  if (dy !== 0) return { x: pos.x, y: cy + Math.sign(dy) * radius };
  // 中心が矩形内（サブステップ上限により通常は起きない）: 移動と逆向きに押し戻す
  if (delta === 0) return pos;
  if (axis === 'x') return { x: delta > 0 ? minX - radius : maxX + radius, y: pos.y };
  return { x: pos.x, y: delta > 0 ? minY - radius : maxY + radius };
}

/**
 * 線分 p0→p1 が障害物（radius だけ膨らませる）またはアリーナ境界に最初に触れる時刻 t（0..1）。
 * 触れなければ null
 */
export function sweepSegmentWalls(
  p0: Vec2,
  p1: Vec2,
  radius: number,
  arena: { width: number; height: number; obstacles: readonly Rect[] },
): number | null {
  let wallT = sweepSegmentBounds(p0, p1, arena.width, arena.height, radius);
  for (const rect of arena.obstacles) {
    const t = sweepSegmentExpandedRect(p0, p1, rect, radius);
    if (t !== null && (wallT === null || t < wallT)) wallT = t;
  }
  return wallT;
}

/**
 * 線分 p0→p1 と軸平行矩形（中心・幅・高さ）を radius だけ膨らませた矩形の最初の交差時刻 t（0..1）。
 * 始点が内側なら 0。交差しなければ null。角は丸めない（判定がわずかに大きくなる側に倒す）
 */
export function sweepSegmentExpandedRect(
  p0: Vec2,
  p1: Vec2,
  rect: Rect,
  radius: number,
): number | null {
  let tMin = 0;
  let tMax = 1;
  const axes: Axis[] = ['x', 'y'];
  for (const axis of axes) {
    const half = (axis === 'x' ? rect.width : rect.height) / 2 + radius;
    const lo = rect[axis] - half;
    const hi = rect[axis] + half;
    const start = p0[axis];
    const d = p1[axis] - start;
    if (Math.abs(d) < SIM_EPSILON) {
      if (start < lo || start > hi) return null;
      continue;
    }
    let t1 = (lo - start) / d;
    let t2 = (hi - start) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}

/**
 * 線分 p0→p1 と静止円（中心 c、半径 radius）の最初の交差時刻 t（0..1）。
 * 始点が内側なら 0。交差しなければ null
 */
export function sweepSegmentCircle(p0: Vec2, p1: Vec2, c: Vec2, radius: number): number | null {
  const fx = p0.x - c.x;
  const fy = p0.y - c.y;
  const cc = fx * fx + fy * fy - radius * radius;
  if (cc <= 0) return 0;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/**
 * 線分 p0→p1 で、円（半径 radius）がアリーナ境界 [0,width]×[0,height] に触れる最初の時刻 t（0..1）。
 * 始点で既に触れていれば 0。触れなければ null
 */
export function sweepSegmentBounds(
  p0: Vec2,
  p1: Vec2,
  width: number,
  height: number,
  radius: number,
): number | null {
  let t: number | null = null;
  const check = (start: number, end: number, lo: number, hi: number) => {
    if (start <= lo || start >= hi) {
      t = 0;
      return;
    }
    const d = end - start;
    let hit: number | null = null;
    if (end <= lo) hit = (lo - start) / d;
    else if (end >= hi) hit = (hi - start) / d;
    if (hit !== null && (t === null || hit < t)) t = hit;
  };
  check(p0.x, p1.x, radius, width - radius);
  check(p0.y, p1.y, radius, height - radius);
  return t;
}
