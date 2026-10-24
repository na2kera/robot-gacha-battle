/**
 * 画面スケーリングと座標ユーティリティ。
 *
 * canvas の実ピクセルは「親要素の CSS サイズ × devicePixelRatio」（setupHiDpi）。
 * 各 scene のメインカメラを zoom して、基準サイズ 960×540（= アリーナ）が常に全体が見え、
 * 画面中央に置かれるようにする（旧 Phaser.Scale.EXPAND と同じ見え方）。
 * 画面の縦横比が基準と違うと、見えている範囲が横か縦にだけ広がる
 * （例: CSS 844×390 → 1169×540、1024×768 → 960×720、1470×801 → 991×540）。
 * ワールド座標の (0,0)〜(960,540) は従来どおり「基準の箱」を指し、広がった分は箱の外側
 * （left/top が負、right/bottom が基準超え）になる。
 * Pointer.x/y は canvas の実ピクセルなので、ワールド座標へは camera.getWorldPoint で直す。
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

/** devicePixelRatio の上限（これ以上は描画負荷に見合わない） */
const MAX_DPR = 3;

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
  /** カメラの zoom（canvas の実ピクセル / ワールド座標 1） */
  zoom: number;
}

/**
 * ゲームサイズ（canvas の実ピクセル）から見えている範囲を求める（純粋関数）。
 * 基準の箱がちょうど収まる zoom を選ぶため、幅か高さの一方が基準と一致する
 */
export function computeViewport(gameWidth: number, gameHeight: number): Viewport {
  const zoom = Math.min(Math.max(gameWidth, 1) / BASE_WIDTH, Math.max(gameHeight, 1) / BASE_HEIGHT);
  const width = Math.max(gameWidth, 1) / zoom;
  const height = Math.max(gameHeight, 1) / zoom;
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
    zoom,
  };
}

/** scene の現在の見えている範囲 */
export function viewport(scene: Phaser.Scene): Viewport {
  const size = scene.scale.gameSize;
  return computeViewport(size.width, size.height);
}

/** メインカメラを canvas 全体に広げ、zoom して基準の箱を中央に合わせる */
function centerCamera(scene: Phaser.Scene, v: Viewport): void {
  const cam = scene.cameras.main;
  const size = scene.scale.gameSize;
  cam.setSize(size.width, size.height);
  cam.setZoom(v.zoom);
  cam.centerOn(v.centerX, v.centerY);
}

/** 現在のカメラ zoom（canvas の実ピクセル / ワールド座標 1）。文字の描画解像度に使う */
let currentZoom = 0;

export function renderZoom(): number {
  if (currentZoom > 0) return currentZoom;
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
}

function currentDpr(): number {
  return Math.min(window.devicePixelRatio || 1, MAX_DPR);
}

/**
 * canvas の実ピクセルを「親要素の CSS サイズ × devicePixelRatio」に保つ（Phaser.Scale.NONE 前提）。
 * Phaser の zoom（= 1 / dpr）で canvas の CSS サイズを親に合わせる。
 * 親のサイズ変更は ScaleManager が RESIZE で知らせ、dpr の変更（別の画面へ移動など）は
 * matchMedia で拾う。Phaser.Game の postBoot から 1 回呼ぶ
 */
export function setupHiDpi(game: Phaser.Game): void {
  const scale = game.scale;
  let applying = false;
  const apply = () => {
    if (applying) return;
    scale.getParentBounds();
    const cssW = scale.parentSize.width;
    const cssH = scale.parentSize.height;
    if (cssW <= 0 || cssH <= 0) return;
    const dpr = currentDpr();
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    currentZoom = computeViewport(w, h).zoom;
    const zoom = 1 / dpr;
    if (scale.width === w && scale.height === h && scale.zoom === zoom) return;
    applying = true;
    try {
      scale.zoom = zoom;
      // dpr=1 では resize が style を書き換えないため、先に CSS サイズを合わせておく
      game.canvas.style.width = `${w * zoom}px`;
      game.canvas.style.height = `${h * zoom}px`;
      // canvas の実ピクセルを変えて RESIZE を出す（各 scene の setupLayout がカメラを合わせ直す）
      scale.resize(w, h);
    } finally {
      applying = false;
    }
  };
  scale.on(Phaser.Scale.Events.RESIZE, apply);
  let mql: MediaQueryList | null = null;
  const watchDpr = () => {
    mql?.removeEventListener('change', onDprChange);
    mql = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mql.addEventListener('change', onDprChange);
  };
  const onDprChange = () => {
    watchDpr();
    apply();
  };
  watchDpr();
  apply();
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
