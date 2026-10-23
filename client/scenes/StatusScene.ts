import Phaser from 'phaser';
import { ja } from '../i18n/ja';
import { game } from '../net/game';
import { Button } from '../ui/Button';
import { COLORS, textStyle } from '../ui/theme';
import { SCENE } from './keys';
import { router, type StatusData } from './router';

/** 接続待ち・回復不能エラーの表示 */
export class StatusScene extends Phaser.Scene {
  private info: StatusData = { message: '', connecting: true };

  constructor() {
    super(SCENE.status);
  }

  init(data: StatusData): void {
    this.info = data;
  }

  create(): void {
    const cx = this.scale.width / 2;
    this.add
      .text(cx, 220, this.info.message, {
        ...textStyle(24),
        align: 'center',
        wordWrap: { width: 760 },
      })
      .setOrigin(0.5);
    if (this.info.connecting) {
      new Button(this, cx - 130, 330, ja.common.reconnect, () => game.reconnectNow(), {
        color: COLORS.buttonSecondary,
      });
      new Button(this, cx + 130, 330, ja.common.backHome, () => game.abandon(), {
        color: COLORS.buttonSecondary,
      });
    } else {
      new Button(this, cx, 330, ja.common.backHome, () => router.dismissFatal());
    }
  }
}
