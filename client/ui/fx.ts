/**
 * 画面演出の小物。浮くダメージ数字、短い揺れ、Graphics パーティクルの爆発、吸着 tween。
 * 白フラッシュは RobotSprite.flash / flashImage を使う。
 * parent を渡すとそのコンテナの座標系に置く（揺らす対象と一緒に動かすため）
 */
import Phaser from 'phaser';
import { COLORS, textStyle } from './theme';

type Parent = Phaser.GameObjects.Container | null;

function place<T extends Phaser.GameObjects.GameObject>(parent: Parent, obj: T): T {
  parent?.add(obj);
  return obj;
}

/** 画像を短く白くする */
export function flashImage(scene: Phaser.Scene, img: Phaser.GameObjects.Image, ms = 70): void {
  img.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
  scene.time.delayedCall(ms, () => {
    if (img.active) img.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
  });
}

/** 上に浮いて消える数字（ダメージ表示） */
export function floatText(
  scene: Phaser.Scene,
  parent: Parent,
  x: number,
  y: number,
  text: string,
  color: string,
  size = 20,
  durationMs = 400,
): void {
  const t = place(
    parent,
    scene.add
      .text(x, y, text, {
        ...textStyle(size, color, '700'),
        stroke: '#0b121b',
        strokeThickness: 4,
      })
      .setOrigin(0.5, 1)
      .setDepth(40),
  );
  scene.tweens.add({
    targets: t,
    y: y - 32,
    alpha: { from: 1, to: 0 },
    ease: 'Cubic.easeOut',
    duration: durationMs,
    onComplete: () => t.destroy(),
  });
}

const shaking = new WeakMap<
  object,
  { ev: Phaser.Time.TimerEvent; base: { x: number; y: number } }
>();

/** target の位置を短く揺らし、終わったら元の位置に戻す */
export function shake(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Components.Transform,
  durationMs = 120,
  intensity = 5,
): void {
  const prev = shaking.get(target);
  // 揺れの途中なら元の位置を引き継ぐ
  const base = prev?.base ?? { x: target.x, y: target.y };
  prev?.ev.remove();
  const endAt = scene.time.now + durationMs;
  const ev = scene.time.addEvent({
    delay: 16,
    loop: true,
    callback: () => {
      if (scene.time.now >= endAt) {
        target.setPosition(base.x, base.y);
        ev.remove();
        shaking.delete(target);
        return;
      }
      target.setPosition(
        base.x + Phaser.Math.Between(-intensity, intensity),
        base.y + Phaser.Math.Between(-intensity, intensity),
      );
    },
  });
  shaking.set(target, { ev, base });
}

interface Particle {
  angle: number;
  speed: number;
  size: number;
  color: number;
}

/** 撃破の爆発。破片が広がりながら縮んで消える */
export function explode(
  scene: Phaser.Scene,
  parent: Parent,
  x: number,
  y: number,
  color: number,
  durationMs = 500,
): void {
  const g = place(parent, scene.add.graphics().setDepth(45));
  g.setPosition(x, y);
  const palette = [color, COLORS.accent, 0xffffff, COLORS.danger];
  const parts: Particle[] = Array.from({ length: 22 }, (_, i) => ({
    angle: (i / 22) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.2, 0.2),
    speed: Phaser.Math.FloatBetween(40, 110),
    size: Phaser.Math.FloatBetween(3, 7),
    color: palette[i % palette.length]!,
  }));
  const state = { t: 0 };
  scene.tweens.add({
    targets: state,
    t: 1,
    duration: durationMs,
    onUpdate: () => {
      const t = state.t;
      const ease = 1 - (1 - t) * (1 - t);
      g.clear();
      // 中心の閃光
      if (t < 0.4) {
        g.fillStyle(0xffffff, 0.8 * (1 - t / 0.4));
        g.fillCircle(0, 0, 10 + 30 * (t / 0.4));
      }
      g.lineStyle(3, COLORS.accent, 1 - t);
      g.strokeCircle(0, 0, 8 + 50 * ease);
      for (const p of parts) {
        const d = p.speed * ease;
        g.fillStyle(p.color, 1 - t);
        const s = p.size * (1 - t * 0.7);
        g.fillRect(Math.cos(p.angle) * d - s / 2, Math.sin(p.angle) * d - s / 2, s, s);
      }
    },
    onComplete: () => g.destroy(),
  });
}

/** obj を (x, y) へ吸い込ませる。終わったら obj を破棄して onComplete */
export function absorb(
  scene: Phaser.Scene,
  obj: Phaser.GameObjects.Image,
  x: number,
  y: number,
  scale: number,
  durationMs = 300,
  onComplete?: () => void,
): void {
  scene.tweens.add({
    targets: obj,
    x,
    y,
    scale,
    alpha: { from: 1, to: 0.4 },
    ease: 'Cubic.easeIn',
    duration: durationMs,
    onComplete: () => {
      obj.destroy();
      onComplete?.();
    },
  });
}
