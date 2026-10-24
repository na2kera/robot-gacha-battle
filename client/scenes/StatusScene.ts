import Phaser from 'phaser';
import { ja } from '../i18n/ja';
import { game } from '../net/game';
import { Button } from '../ui/Button';
import { setupLayout } from '../ui/layout';
import { textStyle } from '../ui/theme';
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
    const { centerX: cx, centerY: cy } = setupLayout(this);
    this.add
      .text(cx, cy - 50, this.info.message, {
        ...textStyle(24),
        align: 'center',
        wordWrap: { width: 760 },
      })
      .setOrigin(0.5);
    if (this.info.connecting) {
      new Button(this, cx - 130, cy + 60, ja.common.reconnect, () => game.reconnectNow(), {
        variant: 'secondary',
      });
      new Button(this, cx + 130, cy + 60, ja.common.backHome, () => game.abandon(), {
        variant: 'secondary',
      });
    } else {
      new Button(this, cx, cy + 60, ja.common.backHome, () => router.dismissFatal());
    }
  }
}
