import Phaser from 'phaser';
import { ja } from '../i18n/ja';
import { game } from '../net/game';
import { Button, BUTTON_MAIN_HEIGHT } from '../ui/Button';
import { addPanel } from '../ui/draw';
import { setupLayout } from '../ui/layout';
import { TEXT, textStyle } from '../ui/theme';
import { Toast } from '../ui/Toast';
import { SCENE } from './keys';
import { autoOff, createTextInput } from './util';

/** ルーム待機: コード・共有 URL・2 人の接続状態・準備完了 */
export class RoomScene extends Phaser.Scene {
  private slots: { name: Phaser.GameObjects.Text; state: Phaser.GameObjects.Text }[] = [];
  private readyBtn!: Button;
  private toast!: Toast;

  constructor() {
    super(SCENE.room);
  }

  create(): void {
    // 基準 960×540 の箱の中央を基準に置く（広がった分は余白）
    const { centerX: cx, centerY: cy } = setupLayout(this);
    const code = game.session?.roomCode ?? '';
    const shareUrl = `${location.origin}/?room=${encodeURIComponent(code)}`;

    this.add.text(cx, cy - 230, ja.room.code, textStyle(18, TEXT.sub)).setOrigin(0.5);
    this.add.text(cx, cy - 180, code, textStyle(56, TEXT.main, '700')).setOrigin(0.5);

    this.add.text(cx - 330, cy - 110, ja.room.shareUrl, textStyle(16, TEXT.sub)).setOrigin(0, 0.5);
    const urlInput = createTextInput({
      placeholder: '',
      value: shareUrl,
      maxLength: 256,
      width: 520,
      readOnly: true,
      fontSize: 16,
    });
    urlInput.addEventListener('focus', () => urlInput.select());
    this.add.dom(cx - 70, cy - 75, urlInput);
    new Button(
      this,
      cx + 270,
      cy - 75,
      ja.room.copy,
      () => {
        const fail = () => {
          urlInput.focus();
          urlInput.select();
          this.toast.show(ja.room.copyFailed, 'warn');
        };
        if (!navigator.clipboard) {
          fail();
          return;
        }
        navigator.clipboard
          .writeText(shareUrl)
          .then(() => this.toast.show(ja.room.copied, 'ok'), fail);
      },
      { width: 120, variant: 'secondary' },
    );

    this.slots = [0, 1].map((i) => {
      const x = cx + (i === 0 ? -200 : 200);
      addPanel(this, x, cy + 50, 340, 100);
      return {
        name: this.add.text(x, cy + 30, '', textStyle(24, TEXT.main, '700')).setOrigin(0.5),
        state: this.add.text(x, cy + 70, '', textStyle(16, TEXT.sub)).setOrigin(0.5),
      };
    });

    this.readyBtn = new Button(
      this,
      cx,
      cy + 155,
      ja.room.readyButton,
      () => {
        game.setReady(!game.me?.ready);
      },
      { width: 280, height: BUTTON_MAIN_HEIGHT },
    );
    new Button(this, cx, cy + 228, ja.room.leave, () => game.leave(), {
      width: 160,
      variant: 'secondary',
      fontSize: 16,
    });

    this.toast = new Toast(this);

    autoOff(
      this,
      game.on('change', () => this.refresh()),
      game.on('status', () => this.refresh()),
    );
    this.refresh();
  }

  private refresh(): void {
    const players = game.publicState?.players ?? [];
    this.slots.forEach((slot, i) => {
      const p = players[i];
      if (!p) {
        slot.name.setText(ja.room.waitingPlayer).setColor(TEXT.sub);
        slot.state.setText('');
        return;
      }
      const isMe = p.playerId === game.playerId;
      slot.name
        .setText(isMe ? `${p.name}${ja.room.you}` : p.name)
        .setColor(isMe ? TEXT.me : TEXT.opponent);
      const conn = p.connected ? ja.room.connected : ja.room.disconnected;
      const ready = p.ready ? ja.room.ready : ja.room.notReady;
      slot.state.setText(`${conn} / ${ready}`).setColor(p.ready ? TEXT.ok : TEXT.sub);
    });
    const ready = !!game.me?.ready;
    this.readyBtn.setText(ready ? ja.room.cancelReady : ja.room.readyButton);
    this.readyBtn.setVariant(ready ? 'secondary' : 'primary');
    this.readyBtn.setEnabled(game.socket.status === 'open');
  }
}
