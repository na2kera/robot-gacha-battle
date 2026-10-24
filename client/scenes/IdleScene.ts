import Phaser from 'phaser';
import { SCENE } from './keys';

/** DOM 画面の表示中に動かす空の scene（キャンバスは隠している） */
export class IdleScene extends Phaser.Scene {
  constructor() {
    super(SCENE.idle);
  }
}
