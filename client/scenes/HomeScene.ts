import Phaser from 'phaser';
import { validatePlayerName } from '../../shared/protocol';
import { URL_ROOM_CODE } from '../env';
import { ja } from '../i18n/ja';
import { ApiError, createRoom, joinRoom } from '../net/api';
import { game } from '../net/game';
import { loadName, saveName } from '../net/session';
import { Button, BUTTON_MAIN_HEIGHT } from '../ui/Button';
import { setupLayout } from '../ui/layout';
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
    // 基準 960×540 の箱の中央を基準に置く（広がった分は余白）
    const { centerX: cx, centerY: cy } = setupLayout(this);
    this.add.text(cx, cy - 200, ja.title, textStyle(40, TEXT.main, '700')).setOrigin(0.5);

    this.add.text(cx - 160, cy - 130, ja.home.nameLabel, textStyle(16, TEXT.sub)).setOrigin(0, 0.5);
    const nameInput = createTextInput({
      placeholder: ja.home.namePlaceholder,
      value: loadName(),
      maxLength: 24,
      width: 320,
    });
    this.add.dom(cx, cy - 92, nameInput);

    const createBtn = new Button(
      this,
      cx,
      cy - 20,
      ja.home.createRoom,
      () => {
        const name = this.readName(nameInput);
        if (name) void this.run(() => createRoom({ name }));
      },
      { height: BUTTON_MAIN_HEIGHT },
    );

    this.add.rectangle(cx, cy + 35, 420, 2, COLORS.panelBorder);

    this.add.text(cx - 160, cy + 65, ja.home.codeLabel, textStyle(16, TEXT.sub)).setOrigin(0, 0.5);
    const codeInput = createTextInput({
      placeholder: ja.home.codePlaceholder,
      value: URL_ROOM_CODE ?? '',
      maxLength: 16,
      width: 320,
    });
    codeInput.autocapitalize = 'characters';
    this.add.dom(cx, cy + 103, codeInput);

    const joinBtn = new Button(
      this,
      cx,
      cy + 175,
      ja.home.joinRoom,
      () => {
        const name = this.readName(nameInput);
        if (!name) return;
        const code = codeInput.value.trim().toUpperCase();
        if (!code) {
          this.message.setText(ja.home.invalidCode);
          return;
        }
        void this.run(() => joinRoom(code, { name }));
      },
      { height: BUTTON_MAIN_HEIGHT },
    );
    // 招待 URL から来た場合は参加を主ボタンにする
    if (URL_ROOM_CODE) createBtn.setVariant('secondary');
    this.buttons = [createBtn, joinBtn];

    this.message = this.add.text(cx, cy + 235, '', textStyle(16, TEXT.danger)).setOrigin(0.5);
    if (game.homeNotice) {
      this.message.setText(ja.apiError[game.homeNotice] ?? ja.apiError.unknown!);
      game.homeNotice = null;
    }
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
