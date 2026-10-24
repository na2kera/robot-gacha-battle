import Phaser from 'phaser';
import { COLORS, shade } from './theme';

export interface LampOptions {
  /** LED の半径 */
  radius?: number;
  /** LED の中心間隔 */
  gap?: number;
  /** 点灯色 */
  color?: number;
}

/** 残り回数ランプ。丸い LED を横に n 個並べる。(x, y) は列の中心 */
export class Lamp extends Phaser.GameObjects.Container {
  private gfx: Phaser.GameObjects.Graphics;
  private lit = 0;
  private done = false;
  private readonly radius: number;
  private readonly gap: number;
  private readonly color: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly ledCount: number,
    opts: LampOptions = {},
  ) {
    super(scene, x, y);
    this.radius = opts.radius ?? 10;
    this.gap = opts.gap ?? this.radius * 3;
    this.color = opts.color ?? COLORS.accent;
    this.gfx = scene.add.graphics();
    this.add(this.gfx);
    this.setSize(this.gap * (ledCount - 1) + this.radius * 2, this.radius * 2);
    scene.add.existing(this);
    this.redraw();
  }

  /** 点灯数を設定する。done=true なら全灯を成功色にする（確定時） */
  setLit(lit: number, done = false): this {
    this.lit = Phaser.Math.Clamp(lit, 0, this.ledCount);
    this.done = done;
    this.redraw();
    return this;
  }

  private redraw(): void {
    const g = this.gfx;
    g.clear();
    const r = this.radius;
    const startX = (-this.gap * (this.ledCount - 1)) / 2;
    for (let i = 0; i < this.ledCount; i++) {
      const x = startX + i * this.gap;
      const on = this.done || i < this.lit;
      const color = this.done ? COLORS.success : this.color;
      // 台座
      g.fillStyle(COLORS.shadow, 1);
      g.fillCircle(x, 1, r + 3);
      if (on) {
        g.fillStyle(color, 0.25);
        g.fillCircle(x, 0, r + 2);
        g.fillStyle(color, 1);
        g.fillCircle(x, 0, r);
        // 光沢
        g.fillStyle(shade(color, 0.6), 1);
        g.fillCircle(x - r * 0.35, -r * 0.35, r * 0.3);
      } else {
        g.fillStyle(COLORS.lampOff, 1);
        g.fillCircle(x, 0, r);
        g.lineStyle(1, COLORS.panelBorder, 1);
        g.strokeCircle(x, 0, r);
      }
    }
  }
}
