/** アリーナ・ロボット・弾・HP バーの図形描画 */
import Phaser from 'phaser';
import { ARENA } from '../../shared/arena';
import type { PlayerState, ProjectileState } from '../../shared/simulation';
import { COLORS } from './theme';

/**
 * アリーナ。床は camera の背景色（COLORS.floor）と同じ色で、アリーナ外の余白は
 * 床の延長に見える。外周の線でアリーナの範囲を示す
 */
export function drawArena(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(COLORS.floor, 1);
  g.fillRect(0, 0, ARENA.width, ARENA.height);
  g.lineStyle(2, COLORS.arenaBorder, 1);
  g.strokeRect(1, 1, ARENA.width - 2, ARENA.height - 2);
  for (const o of ARENA.obstacles) {
    const left = o.x - o.width / 2;
    const top = o.y - o.height / 2;
    g.fillStyle(COLORS.obstacle, 1);
    g.fillRect(left, top, o.width, o.height);
    g.lineStyle(2, COLORS.obstacleTop, 1);
    g.lineBetween(left, top + 1, left + o.width, top + 1);
  }
}

/** 判定確認用に障害物の矩形を線で重ねる */
export function drawArenaDebug(g: Phaser.GameObjects.Graphics): void {
  g.lineStyle(1, COLORS.debug, 0.9);
  for (const o of ARENA.obstacles) {
    g.strokeRect(o.x - o.width / 2, o.y - o.height / 2, o.width, o.height);
  }
}

type RobotPose = Pick<PlayerState, 'x' | 'y' | 'radius' | 'aimAngle' | 'moveDirAngle' | 'alive'>;

export function drawRobot(
  g: Phaser.GameObjects.Graphics,
  p: RobotPose,
  color: number,
  debug: boolean,
): void {
  const alpha = p.alive ? 1 : 0.3;
  g.fillStyle(color, alpha);
  g.fillCircle(p.x, p.y, p.radius);
  // ボディの向き（短い線）
  g.lineStyle(3, COLORS.shadow, alpha);
  g.lineBetween(
    p.x,
    p.y,
    p.x + Math.cos(p.moveDirAngle) * p.radius * 0.9,
    p.y + Math.sin(p.moveDirAngle) * p.radius * 0.9,
  );
  // 武器の向き（太い線）
  g.lineStyle(7, 0xfff3dc, alpha);
  g.lineBetween(
    p.x,
    p.y,
    p.x + Math.cos(p.aimAngle) * (p.radius + 12),
    p.y + Math.sin(p.aimAngle) * (p.radius + 12),
  );
  if (debug) {
    g.lineStyle(1, COLORS.debug, 1);
    g.strokeCircle(p.x, p.y, p.radius);
  }
}

export function drawProjectile(
  g: Phaser.GameObjects.Graphics,
  p: Pick<ProjectileState, 'x' | 'y' | 'radius'>,
  color: number,
  debug: boolean,
): void {
  g.fillStyle(color, 1);
  g.fillCircle(p.x, p.y, Math.max(p.radius, 2));
  g.lineStyle(1, 0xffffff, 0.8);
  g.strokeCircle(p.x, p.y, Math.max(p.radius, 2));
  if (debug) {
    g.lineStyle(1, COLORS.debug, 1);
    g.strokeCircle(p.x, p.y, p.radius);
  }
}

/** 遅延バーが減り始めるまで（ミリ秒） */
const LAG_HOLD_MS = 350;
/** 遅延バーの減少速度（割合/秒） */
const LAG_SPEED = 1.2;

/** HP バーの遅延分。減少分は一拍おいてから追いつき、回復は即座に反映する */
export class HpLag {
  private lag: number | null = null;
  private holdMs = 0;

  /** 現在の HP 比率と経過時間から遅延分の比率を返す */
  update(ratio: number, deltaMs: number): number {
    const r = Phaser.Math.Clamp(ratio, 0, 1);
    if (this.lag === null || r >= this.lag) {
      this.lag = r;
      this.holdMs = 0;
      return r;
    }
    if (this.holdMs < LAG_HOLD_MS) {
      this.holdMs += deltaMs;
      return this.lag;
    }
    this.lag = Math.max(r, this.lag - (LAG_SPEED * deltaMs) / 1000);
    if (this.lag === r) this.holdMs = 0;
    return this.lag;
  }
}

/**
 * HP バー（角丸・背景つき）。lagRatio を渡すと減少分を白っぽく残す。
 * (x, y) は左上
 */
export function drawHpBar(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  ratio: number,
  color: number,
  lagRatio?: number,
  height = 12,
): void {
  const r = Phaser.Math.Clamp(ratio, 0, 1);
  const lag = Phaser.Math.Clamp(lagRatio ?? r, r, 1);
  const radius = height / 2;
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const innerR = innerH / 2;
  g.fillStyle(COLORS.hpBack, 1);
  g.fillRoundedRect(x, y, width, height, radius);
  // 角丸は幅が直径未満だと崩れるため、短い時は半径を詰める
  const fill = (ratioW: number, c: number, alpha: number) => {
    const w = innerW * ratioW;
    if (w <= 0) return;
    g.fillStyle(c, alpha);
    g.fillRoundedRect(x + pad, y + pad, w, innerH, Math.min(innerR, w / 2));
  };
  fill(lag, COLORS.hpLag, 0.85);
  fill(r, color, 1);
  g.lineStyle(1, COLORS.panelBorder, 1);
  g.strokeRoundedRect(x, y, width, height, radius);
}
