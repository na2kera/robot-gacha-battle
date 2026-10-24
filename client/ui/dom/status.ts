/** 接続待ち・回復不能エラーの表示 */
import { ja } from '../../i18n/ja';
import { game } from '../../net/game';
import { button, el } from './kit';
import type { View } from './types';

export interface StatusData {
  message: string;
  /** 接続待ち（true）か回復不能エラー（false）か */
  connecting: boolean;
}

export class StatusView implements View {
  constructor(
    private readonly info: StatusData,
    /** 回復不能エラーを閉じてホームへ戻る（router.dismissFatal） */
    private readonly onDismiss: () => void,
  ) {}

  mount(root: HTMLElement): void {
    const actions = this.info.connecting
      ? [
          button(ja.common.reconnect, () => game.reconnectNow(), 'secondary'),
          button(ja.common.backHome, () => game.abandon(), 'secondary'),
        ]
      : [button(ja.common.backHome, () => this.onDismiss(), 'primary', 'btn-main')];
    root.append(
      el('div', { class: 'view status' }, [
        el('div', { class: 'panel status-box' }, [
          this.info.connecting ? el('span', { class: 'spinner', 'aria-hidden': 'true' }) : null,
          el('p', { class: 'status-message', text: this.info.message }),
          el('div', { class: 'actions' }, actions),
        ]),
      ]),
    );
  }

  unmount(): void {}
}
