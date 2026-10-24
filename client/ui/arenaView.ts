/**
 * 試運転・対戦で共通のアリーナ描画。床は tile_floor をアリーナ外の余白まで敷き、
 * 障害物は tile_wall + 縁。弾は bullet_<weaponId>。画像が無ければ従来の図形で描く
 */
import Phaser from 'phaser';
import { ARENA } from '../../shared/arena';
import type { WeaponId } from '../../shared/parts';
import type { ProjectileState } from '../../shared/simulation';
import { drawArena, drawArenaDebug, drawProjectile } from './draw';
import { COLORS } from './theme';

const TILE = 32;
/** アリーナ外に床を敷く幅（タイルの倍数）。EXPAND で広がる余白より十分大きい */
const FLOOR_MARGIN = TILE * 40;

/** 床・障害物を parent に追加する */
export function buildArena(
  scene: Phaser.Scene,
  parent: Phaser.GameObjects.Container,
  debug: boolean,
): void {
  const g = scene.add.graphics();
  const hasFloor = scene.textures.exists('tile_floor');
  const hasWall = scene.textures.exists('tile_wall');
  if (!hasFloor || !hasWall) {
    drawArena(g);
    parent.add(g);
  } else {
    parent.add(
      scene.add
        .tileSprite(
          -FLOOR_MARGIN,
          -FLOOR_MARGIN,
          ARENA.width + FLOOR_MARGIN * 2,
          ARENA.height + FLOOR_MARGIN * 2,
          'tile_floor',
        )
        .setOrigin(0, 0),
    );
    // アリーナの範囲を示す外周の線
    g.lineStyle(2, COLORS.arenaBorder, 1);
    g.strokeRect(1, 1, ARENA.width - 2, ARENA.height - 2);
    for (const o of ARENA.obstacles) {
      const left = o.x - o.width / 2;
      const top = o.y - o.height / 2;
      parent.add(scene.add.tileSprite(left, top, o.width, o.height, 'tile_wall').setOrigin(0, 0));
      // 縁: 外周の濃い線と上辺のハイライト
      g.lineStyle(2, COLORS.shadow, 1);
      g.strokeRect(left + 1, top + 1, o.width - 2, o.height - 2);
      g.lineStyle(2, COLORS.obstacleTop, 1);
      g.lineBetween(left + 2, top + 3, left + o.width - 2, top + 3);
    }
    parent.add(g);
  }
  if (debug) {
    const d = scene.add.graphics();
    drawArenaDebug(d);
    parent.add(d);
  }
}

export interface ProjectileView extends Pick<
  ProjectileState,
  'id' | 'x' | 'y' | 'vx' | 'vy' | 'radius'
> {
  weapon: WeaponId | null;
  /** 画像が無い時の色 */
  color: number;
}

/** 弾の画像を id ごとに使い回す */
export class ProjectileLayer {
  private images = new Map<number, Phaser.GameObjects.Image>();
  private seen = new Set<number>();

  constructor(
    private scene: Phaser.Scene,
    private parent: Phaser.GameObjects.Container,
  ) {}

  /** 毎フレーム呼ぶ。画像の無い弾と判定表示は g に描く */
  update(list: readonly ProjectileView[], g: Phaser.GameObjects.Graphics, debug: boolean): void {
    this.seen.clear();
    for (const p of list) {
      const key = p.weapon ? `bullet_${p.weapon}` : '';
      if (!key || !this.scene.textures.exists(key)) {
        drawProjectile(g, p, p.color, debug);
        continue;
      }
      this.seen.add(p.id);
      let img = this.images.get(p.id);
      if (!img) {
        img = this.scene.add.image(0, 0, key);
        this.parent.add(img);
        this.images.set(p.id, img);
      } else if (img.texture.key !== key) {
        img.setTexture(key);
      }
      img.setPosition(p.x, p.y).setRotation(Math.atan2(p.vy, p.vx));
      if (debug) {
        g.lineStyle(1, COLORS.debug, 1);
        g.strokeCircle(p.x, p.y, p.radius);
      }
    }
    for (const [id, img] of this.images) {
      if (this.seen.has(id)) continue;
      img.destroy();
      this.images.delete(id);
    }
  }
}
