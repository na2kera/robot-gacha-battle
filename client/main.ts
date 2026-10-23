import Phaser from 'phaser';
import { ARENA } from '../shared/arena';
import { BootScene } from './scenes/BootScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: ARENA.width,
  height: ARENA.height,
  backgroundColor: '#1b1e2b',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene],
});
