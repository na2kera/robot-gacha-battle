/**
 * アリーナ定義。960×540 ワールド単位、左右対称。
 * 障害物は軸平行の矩形、スポーンは左右対称で中央壁が射線を遮る。
 */

export interface Rect {
  /** 中心 x */
  x: number;
  /** 中心 y */
  y: number;
  width: number;
  height: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface ArenaDef {
  width: number;
  height: number;
  obstacles: readonly Rect[];
  spawns: readonly [Vec2, Vec2];
}

export const ARENA: ArenaDef = {
  width: 960,
  height: 540,
  obstacles: [
    // 中央の縦壁
    { x: 480, y: 270, width: 40, height: 160 },
    // 上下の横壁
    { x: 480, y: 110, width: 200, height: 30 },
    { x: 480, y: 430, width: 200, height: 30 },
    // 左右の柱
    { x: 240, y: 270, width: 60, height: 60 },
    { x: 720, y: 270, width: 60, height: 60 },
  ],
  spawns: [
    { x: 120, y: 270 },
    { x: 840, y: 270 },
  ],
};
