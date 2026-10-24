/**
 * 見下ろし視点の機体。脚 → ボディ → コア → 武器の 4 層の画像（td_<partId>_<team>）を
 * コンテナに重ね、コンテナごと照準の向きへ回転させる。
 * 画像の機体中心は常に (24,24)、+x が正面。
 * 部位の値: PartId = 実体、undefined = 未確定（同じ画像の暗いシルエット）、null = 装備なし（描かない）。
 * 画像が無い（manifest の読み込み失敗など）ときは従来の図形で描く
 */
import Phaser from 'phaser';
import { BODIES, type BodyId, type PartId, type PartType } from '../../shared/parts';
import { COLORS } from './theme';

export type Team = 'blue' | 'red';
/** 部位ごとの表示。キーが無い部位は未確定のシルエット */
export type PartialLoadout = Partial<Record<PartType, PartId | null>>;

/** 重ね順（奥から） */
const LAYER_ORDER: readonly PartType[] = ['legs', 'body', 'core', 'weapon'];
/** 未確定部位のシルエットに使う形 */
const PLACEHOLDER: Record<PartType, PartId> = {
  body: 'body_standard',
  legs: 'legs_biped',
  weapon: 'weapon_machinegun',
  core: 'core_vital',
};
/** 画像内の機体中心（px） */
const CENTER = 24;
export const SILHOUETTE_TINT = 0x1b2838;
const SILHOUETTE_ALPHA = 0.6;
const WHITE = 0xffffff;
/** 図形描画の既定の半径（ボディ未確定時） */
const FALLBACK_RADIUS = 19;

export function tdKey(id: PartId, team: Team): string {
  return `td_${id}_${team}`;
}

export function teamColor(team: Team): number {
  return team === 'blue' ? COLORS.me : COLORS.opponent;
}

export class RobotSprite extends Phaser.GameObjects.Container {
  private layers = new Map<PartType, Phaser.GameObjects.Image>();
  private fallback: Phaser.GameObjects.Graphics;
  private parts: PartialLoadout = {};
  private flashing = false;
  private flashTimer: Phaser.Time.TimerEvent | null = null;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly team: Team,
    loadout: PartialLoadout = {},
  ) {
    super(scene, x, y);
    this.fallback = scene.add.graphics();
    this.add(this.fallback);
    scene.add.existing(this);
    this.setLoadout(loadout, true);
    this.once(Phaser.GameObjects.Events.DESTROY, () => this.flashTimer?.remove());
  }

  /** 照準の向き（ラジアン）。+x が正面 */
  setAim(angle: number): this {
    this.setRotation(angle);
    return this;
  }

  /**
   * 部位を差し替える。replace=false なら渡した部位だけ更新し、他は保つ。
   * replace=true なら渡していない部位は未確定（シルエット）にする
   */
  setLoadout(partial: PartialLoadout, replace = false): this {
    this.parts = replace ? { ...partial } : { ...this.parts, ...partial };
    this.rebuild();
    return this;
  }

  /** 部位の表示（未確定は undefined） */
  partOf(type: PartType): PartId | null | undefined {
    return this.parts[type];
  }

  /** 白く光らせる（被弾） */
  flash(durationMs = 70): void {
    this.flashTimer?.remove();
    this.flashing = true;
    this.applyLook();
    this.flashTimer = this.scene.time.delayedCall(durationMs, () => {
      this.flashing = false;
      this.flashTimer = null;
      this.applyLook();
    });
  }

  /** 全部位の画像があるか。無ければ図形で描く */
  private usesImages(): boolean {
    return LAYER_ORDER.every((t) => {
      const id = this.parts[t];
      return id === null || this.scene.textures.exists(tdKey(id ?? PLACEHOLDER[t], this.team));
    });
  }

  private rebuild(): void {
    const images = this.usesImages();
    for (const t of LAYER_ORDER) {
      const id = this.parts[t];
      const existing = this.layers.get(t);
      if (!images || id === null) {
        existing?.setVisible(false);
        continue;
      }
      const key = tdKey(id ?? PLACEHOLDER[t], this.team);
      let img = existing;
      if (!img) {
        img = this.scene.add.image(0, 0, key);
        this.layers.set(t, img);
        this.add(img);
      } else if (img.texture.key !== key) {
        img.setTexture(key);
      }
      img.setOrigin(CENTER / img.width, CENTER / img.height).setVisible(true);
    }
    // 重ね順を揃える（図形の下に画像は来ない。図形は画像が無い時だけ使う）
    for (const t of LAYER_ORDER) {
      const img = this.layers.get(t);
      if (img) this.bringToTop(img);
    }
    this.fallback.setVisible(!images);
    this.applyLook();
  }

  private applyLook(): void {
    for (const t of LAYER_ORDER) {
      const img = this.layers.get(t);
      if (!img?.visible) continue;
      const unknown = this.parts[t] === undefined;
      if (this.flashing) {
        img.setTint(WHITE).setTintMode(Phaser.TintModes.FILL).setAlpha(1);
      } else if (unknown) {
        img.setTint(SILHOUETTE_TINT).setTintMode(Phaser.TintModes.FILL).setAlpha(SILHOUETTE_ALPHA);
      } else {
        img.clearTint().setTintMode(Phaser.TintModes.MULTIPLY).setAlpha(1);
      }
    }
    if (this.fallback.visible) this.drawFallback();
  }

  /** 画像が無い時の図形（円 + 銃身）。コンテナの回転で照準方向を向く */
  private drawFallback(): void {
    const g = this.fallback;
    g.clear();
    const body = this.parts.body;
    const r = body ? BODIES[body as BodyId].radius : FALLBACK_RADIUS;
    const bodyColor = this.flashing ? WHITE : body ? teamColor(this.team) : SILHOUETTE_TINT;
    g.fillStyle(bodyColor, body || this.flashing ? 1 : SILHOUETTE_ALPHA);
    g.fillCircle(0, 0, r);
    if (this.parts.weapon !== null) {
      const known = this.parts.weapon !== undefined || this.flashing;
      g.lineStyle(7, known ? 0xfff3dc : SILHOUETTE_TINT, known ? 1 : SILHOUETTE_ALPHA);
      g.lineBetween(0, 0, r + 12, 0);
    }
  }
}
