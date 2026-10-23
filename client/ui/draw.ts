/** アリーナ・ロボット・弾・HP バーの図形描画 */
import type Phaser from 'phaser';
import { ARENA } from '../../shared/arena';
import type { PlayerState, ProjectileState } from '../../shared/simulation';
import { COLORS } from './theme';

export function drawArena(g: Phaser.GameObjects.Graphics): void {
  g.fillStyle(0x161926, 1);
  g.fillRect(0, 0, ARENA.width, ARENA.height);
  g.lineStyle(2, COLORS.arenaBorder, 1);
  g.strokeRect(1, 1, ARENA.width - 2, ARENA.height - 2);
  g.fillStyle(COLORS.obstacle, 1);
  for (const o of ARENA.obstacles) {
    g.fillRect(o.x - o.width / 2, o.y - o.height / 2, o.width, o.height);
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
  g.lineStyle(3, 0x0e1018, alpha);
  g.lineBetween(
    p.x,
    p.y,
    p.x + Math.cos(p.moveDirAngle) * p.radius * 0.9,
    p.y + Math.sin(p.moveDirAngle) * p.radius * 0.9,
  );
  // 武器の向き（太い線）
  g.lineStyle(7, 0xe6e8f0, alpha);
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

export function drawHpBar(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  width: number,
  ratio: number,
  color: number,
): void {
  const r = Math.min(Math.max(ratio, 0), 1);
  g.fillStyle(COLORS.hpBack, 1);
  g.fillRect(x, y, width, 12);
  g.fillStyle(color, 1);
  g.fillRect(x, y, width * r, 12);
  g.lineStyle(1, 0xffffff, 0.3);
  g.strokeRect(x, y, width, 12);
}
