import Phaser from 'phaser';
import { ja } from '../i18n/ja';
import { game } from '../net/game';
import { Button, BUTTON_MAIN_HEIGHT } from '../ui/Button';
import { addPanel } from '../ui/draw';
import { setupLayout } from '../ui/layout';
import { loadoutLines } from '../ui/partInfo';
import { COLORS, TEXT, textStyle } from '../ui/theme';
import { SCENE } from './keys';
import { autoOff } from './util';

/** 結果: 勝敗・理由・両者の HP 比率と構成、再戦・退出 */
export class ResultScene extends Phaser.Scene {
  private content: Phaser.GameObjects.GameObject[] = [];
  private rematchBtn!: Button;
  private waitText!: Phaser.GameObjects.Text;
  private cx = 0;
  private cy = 0;

  constructor() {
    super(SCENE.result);
  }

  create(): void {
    // 基準 960×540 の箱の中央を基準に置く（広がった分は余白）
    const { centerX: cx, centerY: cy } = setupLayout(this);
    this.cx = cx;
    this.cy = cy;
    this.content = [];
    this.rematchBtn = new Button(
      this,
      cx - 150,
      cy + 220,
      ja.result.rematch,
      () => {
        game.setRematch(!game.rematchRequested);
      },
      { width: 280, height: BUTTON_MAIN_HEIGHT },
    );
    new Button(this, cx + 180, cy + 220, ja.result.leave, () => game.leave(), {
      width: 160,
      height: BUTTON_MAIN_HEIGHT,
      variant: 'secondary',
    });
    this.waitText = this.add.text(cx - 150, cy + 175, '', textStyle(16, TEXT.sub)).setOrigin(0.5);

    autoOff(
      this,
      game.on('result', () => this.refresh()),
      game.on('change', () => this.refresh()),
      game.on('status', () => this.refresh()),
    );
    this.refresh();
  }

  private refresh(): void {
    for (const o of this.content) o.destroy();
    this.content = [];
    const { cx, cy } = this;
    const r = game.result;
    const meId = game.playerId;

    if (!r) {
      this.content.push(
        this.add.text(cx, cy - 70, ja.result.waitingResult, textStyle(24, TEXT.sub)).setOrigin(0.5),
      );
    } else {
      const outcome =
        r.reason === 'aborted'
          ? ja.result.reasons.aborted
          : r.winnerId === null
            ? ja.result.draw
            : r.winnerId === meId
              ? ja.result.win
              : ja.result.lose;
      const color = r.winnerId === null ? TEXT.main : r.winnerId === meId ? TEXT.ok : TEXT.danger;
      this.content.push(
        this.add.text(cx, cy - 215, outcome, textStyle(56, color, '700')).setOrigin(0.5),
        this.add
          .text(
            cx,
            cy - 162,
            r.reason === 'aborted' ? '' : ja.result.reasons[r.reason],
            textStyle(20, TEXT.sub),
          )
          .setOrigin(0.5),
      );
      const players = [...(game.publicState?.players ?? [])].sort(
        (a, b) => Number(b.playerId === meId) - Number(a.playerId === meId),
      );
      players.forEach((p, i) => {
        const isMe = p.playerId === meId;
        const x = i === 0 ? cx - 230 : cx + 230;
        const ratio = r.hpRatios[p.playerId];
        const loadout = r.loadouts[p.playerId] ?? game.loadouts?.[p.playerId];
        const lines = [
          ratio === undefined ? '' : ja.result.hp(Math.round(ratio * 100)),
          ...(loadout ? loadoutLines(loadout) : []),
        ];
        this.content.push(
          addPanel(this, x, cy, 400, 250, isMe ? COLORS.me : COLORS.opponent),
          this.add
            .text(x, cy - 100, p.name, textStyle(24, isMe ? TEXT.me : TEXT.opponent, '700'))
            .setOrigin(0.5),
          this.add
            .text(x, cy + 15, lines.join('\n'), { ...textStyle(18), lineSpacing: 8 })
            .setOrigin(0.5),
        );
      });
    }

    const canRematch = game.phase === 'RESULT' && game.socket.status === 'open';
    this.rematchBtn
      .setText(game.rematchRequested ? ja.result.cancelRematch : ja.result.rematch)
      .setVariant(game.rematchRequested ? 'secondary' : 'primary')
      .setEnabled(canRematch);
    const opponentWants = game.phase === 'RESULT' && !!game.opponent?.ready;
    this.waitText.setText(
      game.rematchRequested
        ? ja.result.waitingOpponent
        : opponentWants
          ? ja.result.opponentWantsRematch
          : '',
    );
  }
}
