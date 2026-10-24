/**
 * 公開: 青赤の機体が左右から入り、4 部位が順に装着され、中央に VS。
 * 演出は CSS のみで約 1.2 秒（REVEAL_HOLD_MS 3 秒内）。遷移は router が行う。
 * 再読み込み直後は phase=REVEAL の welcome で mount され、構成（reveal）が後から届く。
 * その間はタイトルだけを出し、構成を受け取ってから舞台を組んで演出を始める
 */
import type { Loadout } from '../../../shared/parts';
import { ja } from '../../i18n/ja';
import { game } from '../../net/game';
import { loadoutLines } from '../partInfo';
import { el, NameTag, ROBOT_LAYERS, RobotView, type Side } from './kit';
import type { View } from './types';

export class RevealView implements View {
  private stage!: HTMLElement;
  /** 舞台を組んだ時の構成。null なら未受信で舞台は空 */
  private shown: Record<string, Loadout> | null = null;
  private names: NameTag[] = [];

  mount(root: HTMLElement): void {
    this.stage = el('div', { class: 'reveal-stage' });
    root.append(
      el('div', { class: 'view reveal' }, [
        el('h2', { class: 'screen-title', text: ja.reveal.title }),
        this.stage,
      ]),
    );
    this.update();
  }

  update(): void {
    const loadouts = game.loadouts;
    if (loadouts && loadouts !== this.shown) {
      this.shown = loadouts;
      this.renderStage(loadouts);
    }
    // 名前は publicState の更新に合わせて書き換える（演出はやり直さない）
    this.ordered().forEach((p, i) => this.names[i]?.set(p?.name ?? '', i === 0 && !!p));
  }

  unmount(): void {
    this.names = [];
  }

  /** 自分を左（青）、相手を右（赤）に並べたプレイヤー */
  private ordered() {
    const meId = game.playerId;
    const players = game.publicState?.players ?? [];
    return [players.find((p) => p.playerId === meId), players.find((p) => p.playerId !== meId)];
  }

  private renderStage(loadouts: Record<string, Loadout>): void {
    const players = this.ordered();
    this.names = [];
    const stands = (['blue', 'red'] as Side[]).map((side, i) => {
      const p = players[i];
      const loadout = p ? loadouts[p.playerId] : undefined;
      const robot = new RobotView(side);
      // シルエットの層の上に実体の層を重ね、順に表示する
      const ghost = new RobotView(side, 'reveal-ghost');
      ghost.setLoadout(null);
      if (loadout) {
        ROBOT_LAYERS.forEach((t, n) => {
          robot.setPart(t, loadout[t], true);
          const layer = robot.layer(t);
          layer.classList.add('equip');
          layer.style.setProperty('--n', String(n));
          ghost.setPart(t, loadout[t], false);
        });
      } else {
        robot.setLoadout(null);
      }
      const name = new NameTag('stand-name name-stack');
      this.names.push(name);
      return el('div', { class: `panel stand ${side}` }, [
        name.el,
        el('div', { class: 'stand-robot' }, [ghost.el, robot.el]),
        el(
          'ul',
          { class: 'stand-parts' },
          (loadout ? loadoutLines(loadout) : []).map((line) => el('li', { text: line })),
        ),
      ]);
    });
    this.stage.replaceChildren(
      stands[0]!,
      el('div', { class: 'vs', text: ja.reveal.vs }),
      stands[1]!,
    );
  }
}
