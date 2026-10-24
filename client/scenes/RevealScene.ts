import Phaser from 'phaser';
import { ja } from '../i18n/ja';
import { game } from '../net/game';
import { addPanel } from '../ui/draw';
import { setupLayout } from '../ui/layout';
import { loadoutLines } from '../ui/partInfo';
import { COLORS, TEXT, textStyle } from '../ui/theme';
import { SCENE } from './keys';

/** 公開: 両者の名前と構成を表示する。3 秒後の遷移は router が行う */
export class RevealScene extends Phaser.Scene {
  constructor() {
    super(SCENE.reveal);
  }

  create(): void {
    // 基準 960×540 の箱の中央を基準に置く（広がった分は余白）
    const { centerX: cx, centerY: cy } = setupLayout(this);
    this.add.text(cx, cy - 220, ja.reveal.title, textStyle(32, TEXT.main, '700')).setOrigin(0.5);

    const players = game.publicState?.players ?? [];
    const meId = game.playerId;
    // 自分を左に置く
    const ordered = [...players].sort(
      (a, b) => Number(b.playerId === meId) - Number(a.playerId === meId),
    );
    ordered.forEach((p, i) => {
      const isMe = p.playerId === meId;
      const x = i === 0 ? cx - 250 : cx + 250;
      addPanel(this, x, cy + 20, 380, 320, isMe ? COLORS.me : COLORS.opponent);
      this.add
        .text(x, cy - 105, p.name, textStyle(28, isMe ? TEXT.me : TEXT.opponent, '700'))
        .setOrigin(0.5);
      const loadout = game.loadouts?.[p.playerId];
      if (loadout) {
        this.add
          .text(x, cy + 30, loadoutLines(loadout).join('\n'), {
            ...textStyle(22),
            lineSpacing: 14,
            align: 'left',
          })
          .setOrigin(0.5);
      }
    });
    this.add.text(cx, cy + 10, ja.reveal.vs, textStyle(48, TEXT.main, '700')).setOrigin(0.5);
  }
}
