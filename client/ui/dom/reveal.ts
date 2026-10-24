/**
 * 公開: 青赤の機体が左右から入り、4 部位が順に装着され、中央に VS。
 * 演出は CSS のみで約 1.2 秒（REVEAL_HOLD_MS 3 秒内）。遷移は router が行う
 */
import { ja } from '../../i18n/ja';
import { game } from '../../net/game';
import { loadoutLines } from '../partInfo';
import { el, ROBOT_LAYERS, RobotView, type Side } from './kit';
import type { View } from './types';

export class RevealView implements View {
  mount(root: HTMLElement): void {
    const meId = game.playerId;
    const players = [...(game.publicState?.players ?? [])].sort(
      (a, b) => Number(b.playerId === meId) - Number(a.playerId === meId),
    );
    const stands = (['blue', 'red'] as Side[]).map((side, i) => {
      const p = players[i];
      const loadout = p ? game.loadouts?.[p.playerId] : undefined;
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
      return el('div', { class: `panel stand ${side}` }, [
        el('div', { class: 'stand-name', text: p?.name ?? '' }),
        el('div', { class: 'stand-robot' }, [ghost.el, robot.el]),
        el(
          'ul',
          { class: 'stand-parts' },
          (loadout ? loadoutLines(loadout) : []).map((line) => el('li', { text: line })),
        ),
      ]);
    });
    root.append(
      el('div', { class: 'view reveal' }, [
        el('h2', { class: 'screen-title', text: ja.reveal.title }),
        el('div', { class: 'reveal-stage' }, [
          stands[0]!,
          el('div', { class: 'vs', text: ja.reveal.vs }),
          stands[1]!,
        ]),
      ]),
    );
  }

  unmount(): void {}
}
