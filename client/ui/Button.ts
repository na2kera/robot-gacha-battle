import Phaser from 'phaser';
import { COLORS, desaturate, shade, TEXT, textStyle } from './theme';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonOptions {
  width?: number;
  /** 下辺の厚みを含む高さ。最小 56（縮小率 0.72 で 40 CSS px 以上） */
  height?: number;
  /** 面の色を直接指定する（variant より優先） */
  color?: number;
  variant?: ButtonVariant;
  fontSize?: number;
}

/** 最小の高さ（基準座標） */
export const BUTTON_MIN_HEIGHT = 56;
/** 主要ボタンの高さ */
export const BUTTON_MAIN_HEIGHT = 64;
/** 下辺の厚み */
const DEPTH = 4;
/** 押下で沈む量 */
const PRESS = 3;
const RADIUS = 10;

interface Look {
  face: number;
  text: string;
  /** 本体の 2px の縁。背景と面の色が近い variant で輪郭を出す */
  border?: number;
}

const VARIANTS: Record<ButtonVariant, Look> = {
  primary: { face: COLORS.button, text: TEXT.onAccent },
  secondary: { face: COLORS.buttonSecondary, text: TEXT.main, border: COLORS.buttonSecondaryEdge },
  danger: { face: COLORS.buttonDanger, text: TEXT.main },
};

/** 明るい面には濃い文字、暗い面には明るい文字 */
function textFor(face: number): string {
  const r = (face >> 16) & 0xff;
  const g = (face >> 8) & 0xff;
  const b = face & 0xff;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? TEXT.onAccent : TEXT.main;
}

/**
 * 立体ボタン。下辺に厚み、上辺にハイライト、押下で沈む。
 * クリックは従来どおり pointerdown で発火する
 */
export class Button extends Phaser.GameObjects.Container {
  private gfx: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private look: Look;
  private enabled = true;
  private pressed = false;
  private readonly bw: number;
  private readonly bh: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    onClick: () => void,
    opts: ButtonOptions = {},
  ) {
    super(scene, x, y);
    this.bw = opts.width ?? 220;
    this.bh = Math.max(opts.height ?? BUTTON_MIN_HEIGHT, BUTTON_MIN_HEIGHT);
    this.look =
      opts.color !== undefined
        ? { face: opts.color, text: textFor(opts.color) }
        : VARIANTS[opts.variant ?? 'primary'];
    this.gfx = scene.add.graphics();
    this.label = scene.add
      .text(0, 0, text, textStyle(opts.fontSize ?? 20, this.look.text, '700'))
      .setOrigin(0.5);
    this.add([this.gfx, this.label]);
    this.setSize(this.bw, this.bh);

    // 当たり判定は厚みを含む全体
    const hit = scene.add.zone(0, 0, this.bw, this.bh).setInteractive({ useHandCursor: true });
    this.add(hit);
    hit.on(
      'pointerdown',
      (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        if (!this.enabled) return;
        this.setPressed(true);
        onClick();
      },
    );
    hit.on('pointerup', () => this.setPressed(false));
    hit.on('pointerout', () => this.setPressed(false));
    scene.add.existing(this);
    this.redraw();
  }

  setText(text: string): this {
    this.label.setText(text);
    return this;
  }

  /** 面の色を直接指定する。文字色は面の明るさから決める */
  setColor(color: number): this {
    this.look = { face: color, text: textFor(color) };
    this.redraw();
    return this;
  }

  setVariant(variant: ButtonVariant): this {
    this.look = VARIANTS[variant];
    this.redraw();
    return this;
  }

  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    if (!enabled) this.pressed = false;
    this.redraw();
    return this;
  }

  private setPressed(pressed: boolean): void {
    if (this.pressed === pressed || !this.enabled) return;
    this.pressed = pressed;
    this.redraw();
  }

  private redraw(): void {
    const g = this.gfx;
    const w = this.bw;
    const faceH = this.bh - DEPTH;
    const left = -w / 2;
    const top = -this.bh / 2;
    g.clear();

    if (!this.enabled) {
      // 無効: 彩度を落とし、厚みをなくして底に沈める
      const face = desaturate(shade(this.look.face, -0.35), 0.75);
      g.fillStyle(face, 1);
      g.fillRoundedRect(left, top + DEPTH, w, faceH, RADIUS);
      if (this.look.border !== undefined) {
        g.lineStyle(2, desaturate(this.look.border, 0.75), 1);
        g.strokeRoundedRect(left + 1, top + DEPTH + 1, w - 2, faceH - 2, RADIUS);
      }
      this.label
        .setY(DEPTH / 2)
        .setColor(TEXT.sub)
        .setAlpha(0.7);
      return;
    }

    const offset = this.pressed ? PRESS : 0;
    // 厚み（濃色）
    g.fillStyle(shade(this.look.face, -0.45), 1);
    g.fillRoundedRect(left, top + DEPTH, w, faceH, RADIUS);
    // 本体
    g.fillStyle(this.look.face, 1);
    g.fillRoundedRect(left, top + offset, w, faceH, RADIUS);
    if (this.look.border !== undefined) {
      // 縁は厚みも含めた全体を囲む（線幅の半分だけ内側に描く）
      g.lineStyle(2, this.look.border, 1);
      g.strokeRoundedRect(left + 1, top + offset + 1, w - 2, this.bh - offset - 2, RADIUS);
    }
    // 上辺のハイライト 1px
    g.lineStyle(1, shade(this.look.face, 0.45), 1);
    const hy = top + offset + (this.look.border !== undefined ? 3 : 1);
    g.lineBetween(left + RADIUS, hy, left + w - RADIUS, hy);
    this.label
      .setY(offset - DEPTH / 2)
      .setColor(this.look.text)
      .setAlpha(1);
  }
}
