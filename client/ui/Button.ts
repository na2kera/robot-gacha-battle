import Phaser from 'phaser';
import { COLORS, textStyle } from './theme';

export interface ButtonOptions {
  width?: number;
  height?: number;
  color?: number;
  fontSize?: number;
}

/** Rectangle + Text の簡易ボタン */
export class Button extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Rectangle;
  private label: Phaser.GameObjects.Text;
  private color: number;
  private enabled = true;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    onClick: () => void,
    opts: ButtonOptions = {},
  ) {
    super(scene, x, y);
    const w = opts.width ?? 220;
    const h = opts.height ?? 52;
    this.color = opts.color ?? COLORS.button;
    this.bg = scene.add.rectangle(0, 0, w, h, this.color).setStrokeStyle(2, 0xffffff, 0.15);
    this.label = scene.add.text(0, 0, text, textStyle(opts.fontSize ?? 20)).setOrigin(0.5);
    this.add([this.bg, this.label]);
    this.setSize(w, h);
    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on(
      'pointerdown',
      (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        if (this.enabled) onClick();
      },
    );
    this.bg.on('pointerover', () => this.enabled && this.bg.setAlpha(0.85));
    this.bg.on('pointerout', () => this.bg.setAlpha(1));
    scene.add.existing(this);
  }

  setText(text: string): this {
    this.label.setText(text);
    return this;
  }

  setColor(color: number): this {
    this.color = color;
    if (this.enabled) this.bg.setFillStyle(color);
    return this;
  }

  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    this.bg.setFillStyle(enabled ? this.color : COLORS.buttonDisabled);
    this.label.setAlpha(enabled ? 1 : 0.5);
    return this;
  }
}
