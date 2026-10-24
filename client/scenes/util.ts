import Phaser from 'phaser';

/** scene 終了時に購読を解除する */
export function autoOff(scene: Phaser.Scene, ...offs: (() => void)[]): void {
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    for (const off of offs) off();
  });
}

/** 残り秒の表示色。30 秒と 10 秒で強調 */
export function remainingColor(sec: number, normal: string, warn: string, danger: string): string {
  if (sec <= 10) return danger;
  if (sec <= 30) return warn;
  return normal;
}
