/**
 * 画面スケーリング（Phaser.Scale.EXPAND）用の座標ユーティリティ。
 *
 * 基準サイズ 960×540（= アリーナ）は常に全体が見え、画面中央に置かれる。
 * 画面の縦横比が基準と違うと、ゲームサイズが横か縦にだけ広がる
 * （例: 844×390 → 1169×540、1024×768 → 960×720、1470×801 → 991×540）。
 * カメラは基準の箱が中央に来るようにスクロールするため、ワールド座標の
 * (0,0)〜(960,540) は従来どおり「基準の箱」を指し、広がった分は箱の外側
 * （left/top が負、right/bottom が基準超え）になる。
 *
 * - メニュー系の scene は centerX/centerY からの相対で置く（広がった分は余白になる）
 * - HUD は left/right/top/bottom（見えている範囲の端）から置き、RESIZE で置き直す
 */
import Phaser from 'phaser';
import { ARENA } from '../../shared/arena';

export const BASE_WIDTH = ARENA.width;
export const BASE_HEIGHT = ARENA.height;

/** HUD を見えている範囲の上端から離す量（基準座標） */
export const HUD_TOP = 16;

/** 見えている範囲（ワールド座標） */
export interface Viewport {
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

/** ゲームサイズから見えている範囲を求める（純粋関数） */
export function computeViewport(gameWidth: number, gameHeight: number): Viewport {
  const width = Math.max(gameWidth, 1);
  const height = Math.max(gameHeight, 1);
  const centerX = BASE_WIDTH / 2;
  const centerY = BASE_HEIGHT / 2;
  const left = centerX - width / 2;
  const top = centerY - height / 2;
  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    centerX,
    centerY,
    width,
    height,
  };
}

/** scene の現在の見えている範囲 */
export function viewport(scene: Phaser.Scene): Viewport {
  const size = scene.scale.gameSize;
  return computeViewport(size.width, size.height);
}

/** メインカメラを基準の箱の中央に合わせる */
function centerCamera(scene: Phaser.Scene, v: Viewport): void {
  const cam = scene.cameras.main;
  cam.setSize(v.width, v.height);
  cam.setScroll(v.left, v.top);
}

/**
 * layout を今すぐと画面サイズ変更のたびに呼ぶ。購読は scene 終了時に解除する。
 * カメラは動かさない（HUD 部品などが自分の置き直しだけに使う）
 */
export function onLayout(scene: Phaser.Scene, layout: (v: Viewport) => void): Viewport {
  const onResize = () => {
    if (scene.sys.isActive()) layout(viewport(scene));
  };
  scene.scale.on(Phaser.Scale.Events.RESIZE, onResize);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.scale.off(Phaser.Scale.Events.RESIZE, onResize);
  });
  const v = viewport(scene);
  layout(v);
  return v;
}

/**
 * scene の create の最初で呼ぶ。カメラを基準の箱の中央に合わせ（画面サイズ変更時も）、
 * layout があれば今すぐと画面サイズ変更のたびに呼ぶ
 */
export function setupLayout(scene: Phaser.Scene, layout?: (v: Viewport) => void): Viewport {
  return onLayout(scene, (v) => {
    centerCamera(scene, v);
    layout?.(v);
  });
}
