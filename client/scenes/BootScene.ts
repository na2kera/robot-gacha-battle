import Phaser from 'phaser';
import { SCENE } from './keys';
import { router } from './router';

/** 起動直後に router へ制御を渡すだけの scene */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENE.boot);
  }

  create(): void {
    router.start(this.game);
  }
}
