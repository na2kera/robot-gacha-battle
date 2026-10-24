import Phaser from 'phaser';
import { URL_ROOM_CODE } from './env';
import { game } from './net/game';
import { loadSession } from './net/session';
import { BattleScene } from './scenes/BattleScene';
import { BootScene } from './scenes/BootScene';
import { IdleScene } from './scenes/IdleScene';
import { TrialScene } from './scenes/TrialScene';
import './ui/dom/ui.css';
import { initUi } from './ui/dom/view';
import { BASE_HEIGHT, BASE_WIDTH, setupHiDpi } from './ui/layout';
import { setupOverlays } from './ui/overlay';
import { COLORS, css } from './ui/theme';

setupOverlays(() => game.reconnectNow());
initUi();

// 同じタブで接続情報が残っていればホームを飛ばして復帰する。
// 別の部屋の招待 URL を開いた場合はホームでコードを埋めて見せる
const stored = loadSession();
if (stored && (!URL_ROOM_CODE || URL_ROOM_CODE === stored.roomCode.toUpperCase())) {
  game.start(stored);
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: BASE_WIDTH,
  height: BASE_HEIGHT,
  backgroundColor: css(COLORS.background),
  // 文字と図形は滑らかに描く。ドット絵のテクスチャだけ BootScene で最近傍（NEAREST）にする
  pixelArt: false,
  dom: { createContainer: true },
  input: { activePointers: 4 },
  scale: {
    // canvas の実ピクセルは setupHiDpi が「親の CSS サイズ × devicePixelRatio」に保つ。
    // 基準 960×540 は各 scene のカメラ zoom で常に全体が見え、広がった分は余白（client/ui/layout.ts）
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  callbacks: { postBoot: setupHiDpi },
  // ホーム・ルーム・ガチャ・公開・結果・接続中は DOM 画面（client/ui/dom）
  scene: [BootScene, IdleScene, TrialScene, BattleScene],
});
