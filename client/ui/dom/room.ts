/** ルーム待機: 大きなコードとコピー、青赤の整備台（接続・準備状態）、準備完了・退出 */
import type { PlayerPublicInfo } from '../../../shared/protocol';
import { ja } from '../../i18n/ja';
import { game } from '../../net/game';
import { button, el, Lamps, RobotView, setText, setVariant, type Side } from './kit';
import type { View } from './types';
import { showToast } from './view';

interface Bay {
  root: HTMLElement;
  name: HTMLElement;
  state: HTMLElement;
  lamp: Lamps;
}

export class RoomView implements View {
  private bays: Bay[] = [];
  private readyBtn!: HTMLButtonElement;

  mount(root: HTMLElement): void {
    const code = game.session?.roomCode ?? '';
    const shareUrl = `${location.origin}/?room=${encodeURIComponent(code)}`;
    const urlInput = el('input', {
      class: 'input url-input',
      type: 'text',
      readonly: true,
      'aria-label': ja.room.shareUrl,
    });
    urlInput.value = shareUrl;
    urlInput.addEventListener('focus', () => urlInput.select());

    const copy = () => {
      const fail = () => {
        urlInput.focus();
        urlInput.select();
        showToast(ja.room.copyFailed, 'warn');
      };
      if (!navigator.clipboard) {
        fail();
        return;
      }
      navigator.clipboard.writeText(shareUrl).then(() => showToast(ja.room.copied, 'ok'), fail);
    };

    this.bays = (['blue', 'red'] as Side[]).map((side) => this.makeBay(side));
    this.readyBtn = button(
      ja.room.readyButton,
      () => game.setReady(!game.me?.ready),
      'primary',
      'btn-main',
    );

    root.append(
      el('div', { class: 'view room' }, [
        el('div', { class: 'room-head' }, [
          el('div', { class: 'room-code' }, [
            el('span', { class: 'label', text: ja.room.code }),
            el('span', { class: 'code', text: code }),
          ]),
          el('div', { class: 'room-share' }, [
            el('span', { class: 'label', text: ja.room.shareUrl }),
            el('div', { class: 'row' }, [
              urlInput,
              button(ja.room.copy, copy, 'secondary', 'btn-copy'),
            ]),
          ]),
        ]),
        el(
          'div',
          { class: 'room-bays' },
          this.bays.map((b) => b.root),
        ),
        el('div', { class: 'actions' }, [
          this.readyBtn,
          button(ja.room.leave, () => game.leave(), 'secondary'),
        ]),
      ]),
    );
    this.update();
  }

  private makeBay(side: Side): Bay {
    const robot = new RobotView(side);
    robot.setLoadout(null);
    const name = el('div', { class: 'bay-name' });
    const state = el('div', { class: 'bay-state' });
    const lamp = new Lamps(1, 'bay-lamp');
    const root = el('div', { class: `panel bay ${side}` }, [
      el('div', { class: 'bay-stand' }, [robot.el]),
      el('div', { class: 'bay-info' }, [name, el('div', { class: 'row' }, [lamp.el, state])]),
    ]);
    return { root, name, state, lamp };
  }

  update(): void {
    const meId = game.playerId;
    const players = game.publicState?.players ?? [];
    // 自分を左（青）、相手を右（赤）に置く
    const ordered: (PlayerPublicInfo | undefined)[] = [
      players.find((p) => p.playerId === meId),
      players.find((p) => p.playerId !== meId),
    ];
    this.bays.forEach((bay, i) => {
      const p = ordered[i];
      bay.root.classList.toggle('empty', !p);
      if (!p) {
        setText(bay.name, ja.room.waitingPlayer);
        setText(bay.state, '');
        bay.lamp.set(0);
        bay.root.classList.remove('is-ready');
        return;
      }
      setText(bay.name, i === 0 ? `${p.name}${ja.room.you}` : p.name);
      const conn = p.connected ? ja.room.connected : ja.room.disconnected;
      const ready = p.ready ? ja.room.ready : ja.room.notReady;
      setText(bay.state, `${conn} / ${ready}`);
      bay.lamp.set(p.ready ? 1 : 0, p.ready);
      bay.root.classList.toggle('is-ready', p.ready);
      bay.root.classList.toggle('is-offline', !p.connected);
    });
    const ready = !!game.me?.ready;
    setText(this.readyBtn, ready ? ja.room.cancelReady : ja.room.readyButton);
    setVariant(this.readyBtn, ready ? 'secondary' : 'primary');
    this.readyBtn.disabled = game.socket.status !== 'open';
  }

  unmount(): void {
    this.bays = [];
  }
}
