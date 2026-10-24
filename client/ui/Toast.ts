/**
 * 画面上部に短く出る通知。scene ごとに 1 枚を使い回し、新しい通知で置き換える。
 * 再接続の案内は DOM バナー（overlay.ts）を使う
 */
import Phaser from 'phaser';
import { onLayout } from './layout';
import { COLORS, TEXT, textStyle } from './theme';

export type ToastKind = 'info' | 'ok' | 'warn' | 'danger';

const KIND_COLOR: Record<ToastKind, { border: number; text: string }> = {
  info: { border: COLORS.panelBorder, text: TEXT.main },
  ok: { border: COLORS.success, text: TEXT.ok },
  warn: { border: COLORS.accent, text: TEXT.warn },
  danger: { border: COLORS.danger, text: TEXT.danger },
};

const SHOW_MS = 2200;
const FADE_MS = 200;
const PAD_X = 20;
const HEIGHT = 44;
/** 見えている範囲の上端からの距離（既定） */
const TOP_MARGIN = 12;

export class Toast {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private timer: Phaser.Time.TimerEvent | null = null;
  private tween: Phaser.Tweens.Tween | null = null;

  /** topMargin は見えている範囲の上端からトーストの上辺までの距離（HUD と重なる画面で下げる） */
  constructor(
    private scene: Phaser.Scene,
    topMargin = TOP_MARGIN,
  ) {
    this.bg = scene.add.graphics();
    this.label = scene.add.text(0, 0, '', textStyle(18, TEXT.main, '700')).setOrigin(0.5);
    this.container = scene.add
      .container(0, 0, [this.bg, this.label])
      .setDepth(90)
      .setVisible(false);
    onLayout(scene, (v) => this.container.setPosition(v.centerX, v.top + topMargin + HEIGHT / 2));
  }

  /** durationMs はフェードを始めるまでの表示時間 */
  show(text: string, kind: ToastKind = 'info', durationMs = SHOW_MS): void {
    const look = KIND_COLOR[kind];
    this.label.setText(text).setColor(look.text);
    const w = this.label.width + PAD_X * 2;
    const g = this.bg;
    g.clear();
    g.fillStyle(COLORS.panel, 0.96);
    g.fillRoundedRect(-w / 2, -HEIGHT / 2, w, HEIGHT, HEIGHT / 2);
    g.lineStyle(2, look.border, 1);
    g.strokeRoundedRect(-w / 2, -HEIGHT / 2, w, HEIGHT, HEIGHT / 2);

    this.timer?.remove();
    this.tween?.stop();
    this.container.setVisible(true).setAlpha(1);
    this.timer = this.scene.time.delayedCall(durationMs, () => {
      this.tween = this.scene.tweens.add({
        targets: this.container,
        alpha: 0,
        duration: FADE_MS,
        onComplete: () => this.container.setVisible(false),
      });
    });
  }

  hide(): void {
    this.timer?.remove();
    this.tween?.stop();
    this.container.setVisible(false);
  }
}
