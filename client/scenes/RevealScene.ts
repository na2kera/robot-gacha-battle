import Phaser from 'phaser';
import { ja } from '../i18n/ja';
import { game } from '../net/game';
import { loadoutLines } from '../ui/partInfo';
import { COLORS, TEXT, textStyle } from '../ui/theme';
import { SCENE } from './keys';

/** 公開: 両者の名前と構成を表示する。3 秒後の遷移は router が行う */
export class RevealScene extends Phaser.Scene {
  constructor() {
    super(SCENE.reveal);
  }

  create(): void {
    const w = this.scale.width;
    this.add.text(w / 2, 50, ja.reveal.title, textStyle(32)).setOrigin(0.5);
    this.add.text(w / 2, 280, ja.reveal.vs, { ...textStyle(48), fontStyle: 'bold' }).setOrigin(0.5);

    const players = game.publicState?.players ?? [];
    const meId = game.playerId;
    // 自分を左に置く
    const ordered = [...players].sort(
      (a, b) => Number(b.playerId === meId) - Number(a.playerId === meId),
    );
    ordered.forEach((p, i) => {
      const isMe = p.playerId === meId;
      const x = i === 0 ? w / 2 - 250 : w / 2 + 250;
      this.add
        .rectangle(x, 290, 380, 320, COLORS.panel)
        .setStrokeStyle(3, isMe ? COLORS.me : COLORS.opponent);
      this.add.text(x, 165, p.name, textStyle(28, isMe ? TEXT.me : TEXT.opponent)).setOrigin(0.5);
      const loadout = game.loadouts?.[p.playerId];
      if (loadout) {
        this.add
          .text(x, 300, loadoutLines(loadout).join('\n'), {
            ...textStyle(22),
            lineSpacing: 14,
            align: 'left',
          })
          .setOrigin(0.5);
      }
    });
  }
}
