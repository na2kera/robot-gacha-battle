import Phaser from 'phaser';
import { PART_IDS_BY_TYPE, type PartType } from '../../shared/parts';
import { PART_TYPES } from '../../shared/protocol';
import { ja } from '../i18n/ja';
import { game } from '../net/game';
import { Button } from '../ui/Button';
import { partName, partStatRows } from '../ui/partInfo';
import { COLORS, TEXT, textStyle } from '../ui/theme';
import { SCENE } from './keys';
import { autoOff, remainingColor } from './util';

/** 1 部位あたりの抽選上限 */
const MAX_DRAWS = 5;

/** ガチャ: 4 部位のタブ、現在候補と性能、確定 / 捨てて次を引く、比較表 */
export class DraftScene extends Phaser.Scene {
  private tab: PartType = 'body';
  private timer!: Phaser.GameObjects.Text;
  private opponentText!: Phaser.GameObjects.Text;
  private tabs: Button[] = [];
  private candidateName!: Phaser.GameObjects.Text;
  private stateText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private drawsLeft!: Phaser.GameObjects.Text;
  private primaryBtn!: Button;
  private redrawBtn!: Button;
  private redrawNote!: Phaser.GameObjects.Text;
  private errorText!: Phaser.GameObjects.Text;
  private compare: Phaser.GameObjects.Container | null = null;

  constructor() {
    super(SCENE.draft);
  }

  create(): void {
    const w = this.scale.width;
    this.compare = null;
    // 未確定の部位を最初に開く
    this.tab = PART_TYPES.find((t) => !game.privateDraft?.parts[t].locked) ?? 'body';

    this.timer = this.add.text(w / 2, 28, '', textStyle(26)).setOrigin(0.5);
    this.opponentText = this.add
      .text(w - 24, 28, '', textStyle(18, TEXT.opponent))
      .setOrigin(1, 0.5);

    this.tabs = PART_TYPES.map(
      (t, i) =>
        new Button(
          this,
          120 + i * 240,
          82,
          ja.draft.partNames[t],
          () => {
            this.tab = t;
            this.refresh();
          },
          { width: 220, height: 46 },
        ),
    );

    this.add.rectangle(w / 2, 300, 920, 350, COLORS.panel).setStrokeStyle(2, COLORS.panelBorder);
    this.stateText = this.add.text(60, 145, '', textStyle(16, TEXT.sub));
    this.candidateName = this.add.text(60, 170, '', textStyle(36));
    this.statsText = this.add.text(60, 230, '', { ...textStyle(20), lineSpacing: 8 });

    const bx = 720;
    this.drawsLeft = this.add.text(bx, 160, '', textStyle(20)).setOrigin(0.5);
    this.primaryBtn = new Button(this, bx, 225, '', () => this.onPrimary(), {
      width: 340,
      height: 60,
    });
    this.redrawBtn = new Button(this, bx, 320, ja.draft.redraw, () => game.draw(this.tab), {
      width: 340,
      height: 56,
      color: COLORS.buttonDanger,
    });
    this.redrawNote = this.add
      .text(bx, 362, ja.draft.redrawNote, textStyle(14, TEXT.warn))
      .setOrigin(0.5, 0);
    new Button(this, bx, 430, ja.draft.compare, () => this.toggleCompare(), {
      width: 200,
      height: 44,
      color: COLORS.buttonSecondary,
      fontSize: 18,
    });

    this.errorText = this.add.text(w / 2, 505, '', textStyle(16, TEXT.danger)).setOrigin(0.5);

    autoOff(
      this,
      game.on('change', () => this.refresh()),
      game.on('draft', (err) => {
        this.errorText.setText(err ? (ja.draft.errors[err] ?? err) : '');
      }),
    );
    this.refresh();
  }

  override update(): void {
    const ms = game.remainingMs(game.publicState?.deadlineAt ?? game.privateDraft?.deadlineAt);
    if (ms === null) {
      this.timer.setText('');
    } else {
      const sec = Math.ceil(ms / 1000);
      this.timer
        .setText(ja.common.remaining(sec))
        .setColor(remainingColor(sec, TEXT.main, TEXT.warn, TEXT.danger));
    }
    this.opponentText.setText(ja.common.opponentConfirmed(game.opponent?.confirmedParts ?? 0));
  }

  private onPrimary(): void {
    const part = game.privateDraft?.parts[this.tab];
    if (!part || part.locked) return;
    if (part.candidate === null) game.draw(this.tab);
    else game.confirm(this.tab);
  }

  private refresh(): void {
    const draft = game.privateDraft;
    if (!draft) return;
    PART_TYPES.forEach((t, i) => {
      const p = draft.parts[t];
      const btn = this.tabs[i]!;
      btn.setText(p.locked ? `${ja.draft.partNames[t]} ✓` : ja.draft.partNames[t]);
      btn.setColor(t === this.tab ? COLORS.button : COLORS.buttonSecondary);
    });

    const part = draft.parts[this.tab];
    const pending = game.pending !== null;
    const id = part.locked ? part.confirmed : part.candidate;
    this.stateText.setText(
      part.locked ? ja.draft.confirmed : part.candidate ? ja.draft.candidate : ja.draft.notDrawn,
    );
    this.candidateName.setText(id ? partName(id) : '—');
    this.statsText.setText(
      id
        ? partStatRows(this.tab, id)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n')
        : '',
    );

    const left = MAX_DRAWS - part.drawCount;
    this.drawsLeft.setText(part.locked ? ja.draft.confirmed : ja.draft.drawsLeft(left));

    if (part.locked) {
      this.primaryBtn.setVisible(false);
      this.redrawBtn.setVisible(false);
      this.redrawNote.setVisible(false);
    } else {
      const hasCandidate = part.candidate !== null;
      this.primaryBtn
        .setVisible(true)
        .setText(pending ? ja.draft.pending : hasCandidate ? ja.draft.confirm : ja.draft.drawFree)
        .setEnabled(!pending);
      this.redrawBtn.setVisible(hasCandidate).setEnabled(!pending && left > 0);
      this.redrawNote.setVisible(hasCandidate);
    }
  }

  private toggleCompare(): void {
    if (this.compare) {
      this.compare.destroy();
      this.compare = null;
      return;
    }
    const w = this.scale.width;
    const h = this.scale.height;
    const c = this.add.container(0, 0).setDepth(50);
    const shade = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.75).setInteractive();
    c.add(shade);
    c.add(
      this.add
        .rectangle(w / 2, h / 2, 860, 420, COLORS.panel)
        .setStrokeStyle(2, COLORS.panelBorder),
    );
    c.add(
      this.add
        .text(w / 2, 90, `${ja.draft.partNames[this.tab]} ${ja.draft.compare}`, textStyle(24))
        .setOrigin(0.5),
    );
    const ids = PART_IDS_BY_TYPE[this.tab];
    const labels = partStatRows(this.tab, ids[0]!).map(([k]) => k);
    c.add(
      this.add.text(110, 140, ['', ...labels].join('\n'), {
        ...textStyle(18, TEXT.sub),
        lineSpacing: 10,
      }),
    );
    ids.forEach((id, i) => {
      const values = partStatRows(this.tab, id).map(([, v]) => v);
      c.add(
        this.add
          .text(400 + i * 180, 140, [partName(id), ...values].join('\n'), {
            ...textStyle(18),
            lineSpacing: 10,
            align: 'center',
          })
          .setOrigin(0.5, 0),
      );
    });
    c.add(
      new Button(this, w / 2, 465, ja.draft.close, () => this.toggleCompare(), {
        width: 180,
        height: 44,
        color: COLORS.buttonSecondary,
      }),
    );
    this.compare = c;
  }
}
