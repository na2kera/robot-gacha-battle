import Phaser from 'phaser';
import { ARENA } from '../../shared/arena';
import { BODIES, PHASE1_LOADOUT } from '../../shared/parts';

/** 雛形確認用: アリーナとスポーンを図形で描く */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    const g = this.add.graphics();

    g.lineStyle(2, 0x3a4060, 1);
    g.strokeRect(0, 0, ARENA.width, ARENA.height);

    g.fillStyle(0x4a5278, 1);
    for (const o of ARENA.obstacles) {
      g.fillRect(o.x - o.width / 2, o.y - o.height / 2, o.width, o.height);
    }

    const radius = BODIES[PHASE1_LOADOUT.body].radius;
    const [left, right] = ARENA.spawns;
    g.fillStyle(0x4c8dff, 1);
    g.fillCircle(left.x, left.y, radius);
    g.fillStyle(0xff5c5c, 1);
    g.fillCircle(right.x, right.y, radius);

    this.add
      .text(ARENA.width / 2, 24, 'ロボットガチャバトル 雛形', {
        fontSize: '20px',
        color: '#e6e8f0',
      })
      .setOrigin(0.5, 0.5);
  }
}
