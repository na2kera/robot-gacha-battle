/** 結果: 勝敗・理由、両機体と HP 残量・4 部位、勝者にスタンプ、再戦・退出 */
import type { PartType } from '../../../shared/parts';
import { PART_TYPES, type ResultMessage } from '../../../shared/protocol';
import { ja } from '../../i18n/ja';
import { game } from '../../net/game';
import { partName } from '../partInfo';
import {
  button,
  el,
  NameTag,
  partImg,
  pixelImg,
  RobotView,
  setText,
  setVariant,
  type Side,
} from './kit';
import type { View } from './types';

export class ResultView implements View {
  private body!: HTMLElement;
  private rematchBtn!: HTMLButtonElement;
  private waitText!: HTMLElement;
  /** 描画済みの結果。変わった時だけ作り直す（スタンプの演出を繰り返さない） */
  private shown: ResultMessage | null | undefined = undefined;

  mount(root: HTMLElement): void {
    this.body = el('div', { class: 'result-body' });
    this.rematchBtn = button(
      ja.result.rematch,
      () => game.setRematch(!game.rematchRequested),
      'primary',
      'btn-main',
    );
    this.waitText = el('p', { class: 'wait-text' });
    root.append(
      el('div', { class: 'view result' }, [
        this.body,
        el('div', { class: 'result-actions' }, [
          el('div', { class: 'rematch' }, [this.waitText, this.rematchBtn]),
          button(ja.result.leave, () => game.leave(), 'secondary', 'btn-main'),
        ]),
      ]),
    );
    this.update();
  }

  unmount(): void {}

  update(): void {
    if (game.result !== this.shown) {
      this.shown = game.result;
      this.renderResult(game.result);
    }
    const canRematch = game.phase === 'RESULT' && game.socket.status === 'open';
    setText(this.rematchBtn, game.rematchRequested ? ja.result.cancelRematch : ja.result.rematch);
    setVariant(this.rematchBtn, game.rematchRequested ? 'secondary' : 'primary');
    this.rematchBtn.disabled = !canRematch;
    const opponentWants = game.phase === 'RESULT' && !!game.opponent?.ready;
    setText(
      this.waitText,
      game.rematchRequested
        ? ja.result.waitingOpponent
        : opponentWants
          ? ja.result.opponentWantsRematch
          : '',
    );
    this.waitText.classList.toggle('highlight', !game.rematchRequested && opponentWants);
  }

  private renderResult(r: ResultMessage | null): void {
    if (!r) {
      this.body.replaceChildren(el('p', { class: 'waiting', text: ja.result.waitingResult }));
      return;
    }
    const meId = game.playerId;
    const aborted = r.reason === 'aborted';
    const outcome = aborted
      ? ja.result.reasons.aborted
      : r.winnerId === null
        ? ja.result.draw
        : r.winnerId === meId
          ? ja.result.win
          : ja.result.lose;
    const tone = r.winnerId === null ? 'draw' : r.winnerId === meId ? 'win' : 'lose';
    const players = [...(game.publicState?.players ?? [])].sort(
      (a, b) => Number(b.playerId === meId) - Number(a.playerId === meId),
    );
    const cards = players.slice(0, 2).map((p, i) => {
      const side: Side = i === 0 ? 'blue' : 'red';
      const ratio = r.hpRatios[p.playerId];
      const loadout = r.loadouts[p.playerId] ?? game.loadouts?.[p.playerId] ?? null;
      const robot = new RobotView(side);
      robot.setLoadout(loadout);
      const pct = ratio === undefined ? null : Math.round(ratio * 100);
      const hp =
        pct === null
          ? null
          : el('div', { class: 'hp' }, [
              el('div', { class: 'hp-bar' }, [
                el('span', {
                  class: 'hp-fill',
                  style: `width: ${Math.max(0, Math.min(100, pct))}%`,
                }),
              ]),
              el('span', { class: 'hp-text', text: ja.result.hp(pct) }),
            ]);
      const parts = loadout
        ? PART_TYPES.flatMap((t: PartType) => {
            const id = loadout[t];
            if (!id) return [];
            return [
              el('li', {}, [
                partImg(id, side, 'result-part'),
                el('span', { class: 'result-part-name' }, [
                  el('small', { text: ja.draft.partNames[t] }),
                  el('span', { text: partName(id) }),
                ]),
              ]),
            ];
          })
        : [];
      const winner = !aborted && r.winnerId === p.playerId;
      return el('div', { class: `panel card ${side}` }, [
        el('div', { class: 'card-head' }, [
          new NameTag('card-name').set(p.name, p.playerId === meId).el,
          hp,
        ]),
        el('div', { class: 'card-body' }, [
          el('div', { class: 'card-robot' }, [robot.el]),
          el('ul', { class: 'card-parts' }, parts),
        ]),
        winner ? pixelImg('stamp_win', 'stamp') : null,
      ]);
    });
    this.body.replaceChildren(
      el('div', { class: `outcome ${tone}` }, [
        el('span', { class: 'outcome-text', text: outcome }),
        aborted ? null : el('span', { class: 'outcome-reason', text: ja.result.reasons[r.reason] }),
      ]),
      el('div', { class: 'cards' }, cards),
    );
  }
}
