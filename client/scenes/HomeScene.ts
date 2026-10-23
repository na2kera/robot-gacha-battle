import Phaser from 'phaser';
import { validatePlayerName } from '../../shared/protocol';
import { URL_ROOM_CODE } from '../env';
import { ja } from '../i18n/ja';
import { ApiError, createRoom, joinRoom } from '../net/api';
import { game } from '../net/game';
import { loadName, saveName } from '../net/session';
import { Button } from '../ui/Button';
import { COLORS, TEXT, textStyle } from '../ui/theme';
import { SCENE } from './keys';
import { createTextInput } from './util';

/** ホーム: 名前入力・部屋を作る・コードで参加 */
export class HomeScene extends Phaser.Scene {
  private busy = false;
  private message!: Phaser.GameObjects.Text;
  private buttons: Button[] = [];

  constructor() {
    super(SCENE.home);
  }

  create(): void {
    this.busy = false;
    const cx = this.scale.width / 2;
    this.add.text(cx, 70, ja.title, textStyle(40)).setOrigin(0.5);

    this.add.text(cx - 160, 140, ja.home.nameLabel, textStyle(16, TEXT.sub)).setOrigin(0, 0.5);
    const nameInput = createTextInput({
      placeholder: ja.home.namePlaceholder,
      value: loadName(),
      maxLength: 24,
      width: 320,
    });
    this.add.dom(cx, 178, nameInput);

    const createBtn = new Button(this, cx, 250, ja.home.createRoom, () => {
      const name = this.readName(nameInput);
      if (name) void this.run(() => createRoom({ name }));
    });

    this.add.rectangle(cx, 305, 420, 1, COLORS.panelBorder);

    this.add.text(cx - 160, 335, ja.home.codeLabel, textStyle(16, TEXT.sub)).setOrigin(0, 0.5);
    const codeInput = createTextInput({
      placeholder: ja.home.codePlaceholder,
      value: URL_ROOM_CODE ?? '',
      maxLength: 16,
      width: 320,
    });
    codeInput.autocapitalize = 'characters';
    this.add.dom(cx, 373, codeInput);

    const joinBtn = new Button(this, cx, 445, ja.home.joinRoom, () => {
      const name = this.readName(nameInput);
      if (!name) return;
      const code = codeInput.value.trim().toUpperCase();
      if (!code) {
        this.message.setText(ja.home.invalidCode);
        return;
      }
      void this.run(() => joinRoom(code, { name }));
    });
    // 招待 URL から来た場合は参加を主ボタンにする
    if (URL_ROOM_CODE) createBtn.setColor(COLORS.buttonSecondary);
    this.buttons = [createBtn, joinBtn];

    this.message = this.add.text(cx, 505, '', textStyle(16, TEXT.danger)).setOrigin(0.5);
  }

  private readName(input: HTMLInputElement): string | null {
    const name = validatePlayerName(input.value);
    if (!name) {
      this.message.setText(ja.home.invalidName);
      return null;
    }
    saveName(name);
    return name;
  }

  private async run(
    call: () => Promise<{ roomCode: string; playerId: string; sessionToken: string }>,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    for (const b of this.buttons) b.setEnabled(false);
    this.message.setColor(TEXT.sub).setText(ja.home.busy);
    try {
      const res = await call();
      game.start({
        roomCode: res.roomCode,
        playerId: res.playerId,
        sessionToken: res.sessionToken,
      });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'unknown';
      if (!this.sys.isActive()) return;
      this.message.setColor(TEXT.danger).setText(ja.apiError[code] ?? ja.apiError.unknown!);
      this.busy = false;
      for (const b of this.buttons) b.setEnabled(true);
    }
  }
}
