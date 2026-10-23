import Phaser from 'phaser';
import { ARENA } from '../shared/arena';
import { URL_ROOM_CODE } from './env';
import { game } from './net/game';
import { loadSession } from './net/session';
import { BattleScene } from './scenes/BattleScene';
import { BootScene } from './scenes/BootScene';
import { DraftScene } from './scenes/DraftScene';
import { HomeScene } from './scenes/HomeScene';
import { ResultScene } from './scenes/ResultScene';
import { RevealScene } from './scenes/RevealScene';
import { RoomScene } from './scenes/RoomScene';
import { StatusScene } from './scenes/StatusScene';
import { TrialScene } from './scenes/TrialScene';
import { setupOverlays } from './ui/overlay';

setupOverlays(() => game.reconnectNow());

// 同じタブで接続情報が残っていればホームを飛ばして復帰する。
// 別の部屋の招待 URL を開いた場合はホームでコードを埋めて見せる
const stored = loadSession();
if (stored && (!URL_ROOM_CODE || URL_ROOM_CODE === stored.roomCode.toUpperCase())) {
  game.start(stored);
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: ARENA.width,
  height: ARENA.height,
  backgroundColor: '#1b1e2b',
  dom: { createContainer: true },
  input: { activePointers: 4 },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [
    BootScene,
    HomeScene,
    StatusScene,
    RoomScene,
    DraftScene,
    TrialScene,
    RevealScene,
    BattleScene,
    ResultScene,
  ],
});
