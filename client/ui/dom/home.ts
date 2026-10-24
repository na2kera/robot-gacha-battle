/** ホーム: 文字のロゴ、青い完成機、名前入力・部屋を作る・コードで参加 */
import { validatePlayerName } from '../../../shared/protocol';
import { URL_ROOM_CODE } from '../../env';
import { ja } from '../../i18n/ja';
import { ApiError, createRoom, joinRoom } from '../../net/api';
import { game } from '../../net/game';
import { loadName, saveName } from '../../net/session';
import { button, el, RobotView } from './kit';
import type { View } from './types';

/** ホームに飾る完成機 */
const HOME_ROBOT = {
  body: 'body_standard',
  legs: 'legs_biped',
  weapon: 'weapon_cannon',
  core: 'core_power',
} as const;

type Join = () => Promise<{ roomCode: string; playerId: string; sessionToken: string }>;

export class HomeView implements View {
  private mounted = false;
  private busy = false;
  private message!: HTMLElement;
  private nameInput!: HTMLInputElement;
  private codeInput!: HTMLInputElement;
  private buttons: HTMLButtonElement[] = [];

  mount(root: HTMLElement): void {
    this.mounted = true;
    this.nameInput = el('input', {
      class: 'input',
      type: 'text',
      id: 'home-name',
      placeholder: ja.home.namePlaceholder,
      maxlength: 24,
      autocomplete: 'off',
      spellcheck: 'false',
      enterkeyhint: 'done',
    });
    this.nameInput.value = loadName();
    this.codeInput = el('input', {
      class: 'input code-input',
      type: 'text',
      id: 'home-code',
      placeholder: ja.home.codePlaceholder,
      maxlength: 16,
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
      enterkeyhint: 'go',
    });
    this.codeInput.value = URL_ROOM_CODE ?? '';

    // 招待 URL から来た場合は参加を主ボタンにする
    const invited = !!URL_ROOM_CODE;
    const createBtn = button(
      ja.home.createRoom,
      () => this.onCreate(),
      invited ? 'secondary' : 'primary',
      'btn-main',
    );
    const joinBtn = button(ja.home.joinRoom, () => this.onJoin(), 'primary', 'btn-main');
    this.buttons = [createBtn, joinBtn];
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.onJoin();
    });

    this.message = el('p', { class: 'message', role: 'alert' });

    const robot = new RobotView('blue', 'float');
    robot.setLoadout(HOME_ROBOT);

    root.append(
      el('div', { class: 'view home' }, [
        // ロゴは画像ではなく文字で組む（見た目は ui.css の .home-logo）
        el('h1', { class: 'home-logo', 'aria-label': ja.title }, [
          el('span', { class: 'logo-plate', 'aria-hidden': 'true' }, [
            el('span', { class: 'logo-top', text: ja.home.logoTop }),
            el('span', { class: 'logo-main', text: ja.home.logoMain }),
          ]),
        ]),
        el('div', { class: 'home-main' }, [
          el('div', { class: 'home-hero' }, [el('span', { class: 'hero-shadow' }), robot.el]),
          el('div', { class: 'panel home-form' }, [
            el('label', { class: 'label', for: 'home-name', text: ja.home.nameLabel }),
            this.nameInput,
            createBtn,
            el('hr', { class: 'divider' }),
            el('label', { class: 'label', for: 'home-code', text: ja.home.codeLabel }),
            el('div', { class: 'row' }, [this.codeInput, joinBtn]),
            this.message,
          ]),
        ]),
      ]),
    );

    if (game.homeNotice) {
      this.show(ja.apiError[game.homeNotice] ?? ja.apiError.unknown!, 'danger');
      game.homeNotice = null;
    }
  }

  unmount(): void {
    this.mounted = false;
  }

  private show(text: string, kind: 'danger' | 'sub'): void {
    this.message.textContent = text;
    this.message.dataset.kind = kind;
  }

  private onCreate(): void {
    const name = this.readName();
    if (name) void this.run(() => createRoom({ name }));
  }

  private onJoin(): void {
    const name = this.readName();
    if (!name) return;
    const code = this.codeInput.value.trim().toUpperCase();
    if (!code) {
      this.show(ja.home.invalidCode, 'danger');
      return;
    }
    void this.run(() => joinRoom(code, { name }));
  }

  private readName(): string | null {
    const name = validatePlayerName(this.nameInput.value);
    if (!name) {
      this.show(ja.home.invalidName, 'danger');
      return null;
    }
    saveName(name);
    return name;
  }

  private async run(call: Join): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    for (const b of this.buttons) b.disabled = true;
    this.show(ja.home.busy, 'sub');
    try {
      const res = await call();
      game.start({
        roomCode: res.roomCode,
        playerId: res.playerId,
        sessionToken: res.sessionToken,
      });
    } catch (e) {
      if (!this.mounted) return;
      const code = e instanceof ApiError ? e.code : 'unknown';
      this.show(ja.apiError[code] ?? ja.apiError.unknown!, 'danger');
      this.busy = false;
      for (const b of this.buttons) b.disabled = false;
    }
  }
}
