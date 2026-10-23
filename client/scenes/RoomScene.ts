import Phaser from 'phaser';
import { ja } from '../i18n/ja';
import { game } from '../net/game';
import { Button } from '../ui/Button';
import { COLORS, TEXT, textStyle } from '../ui/theme';
import { SCENE } from './keys';
import { autoOff, createTextInput } from './util';

/** ルーム待機: コード・共有 URL・2 人の接続状態・準備完了 */
export class RoomScene extends Phaser.Scene {
  private slots: { name: Phaser.GameObjects.Text; state: Phaser.GameObjects.Text }[] = [];
  private readyBtn!: Button;
  private copyMsg!: Phaser.GameObjects.Text;

  constructor() {
    super(SCENE.room);
  }

  create(): void {
    const cx = this.scale.width / 2;
    const code = game.session?.roomCode ?? '';
    const shareUrl = `${location.origin}/?room=${encodeURIComponent(code)}`;

    this.add.text(cx, 40, ja.room.code, textStyle(18, TEXT.sub)).setOrigin(0.5);
    this.add.text(cx, 90, code, { ...textStyle(56), fontStyle: 'bold' }).setOrigin(0.5);

    this.add.text(cx - 330, 160, ja.room.shareUrl, textStyle(16, TEXT.sub)).setOrigin(0, 0.5);
    const urlInput = createTextInput({
      placeholder: '',
      value: shareUrl,
      maxLength: 256,
      width: 520,
      readOnly: true,
      fontSize: 16,
    });
    urlInput.addEventListener('focus', () => urlInput.select());
    this.add.dom(cx - 70, 195, urlInput);
    new Button(
      this,
      cx + 270,
      195,
      ja.room.copy,
      () => {
        const fail = () => {
          urlInput.focus();
          urlInput.select();
          this.copyMsg.setColor(TEXT.warn).setText(ja.room.copyFailed);
        };
        if (!navigator.clipboard) {
          fail();
          return;
        }
        navigator.clipboard
          .writeText(shareUrl)
          .then(() => this.copyMsg.setColor(TEXT.ok).setText(ja.room.copied), fail);
      },
      { width: 120, height: 44, color: COLORS.buttonSecondary },
    );
    this.copyMsg = this.add.text(cx, 235, '', textStyle(14, TEXT.ok)).setOrigin(0.5);

    this.slots = [0, 1].map((i) => {
      const x = cx + (i === 0 ? -200 : 200);
      this.add.rectangle(x, 320, 340, 100, COLORS.panel).setStrokeStyle(2, COLORS.panelBorder);
      return {
        name: this.add.text(x, 300, '', textStyle(24)).setOrigin(0.5),
        state: this.add.text(x, 340, '', textStyle(16, TEXT.sub)).setOrigin(0.5),
      };
    });

    this.readyBtn = new Button(
      this,
      cx,
      425,
      ja.room.readyButton,
      () => {
        game.setReady(!game.me?.ready);
      },
      { width: 280 },
    );
    new Button(this, cx, 495, ja.room.leave, () => game.leave(), {
      width: 160,
      height: 40,
      color: COLORS.buttonSecondary,
      fontSize: 16,
    });

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
    this.readyBtn.setColor(ready ? COLORS.buttonSecondary : COLORS.button);
    this.readyBtn.setEnabled(game.socket.status === 'open');
  }
}
