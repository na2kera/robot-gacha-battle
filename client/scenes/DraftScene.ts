import Phaser from 'phaser';
import { PART_IDS_BY_TYPE, type PartType } from '../../shared/parts';
import { PART_TYPES } from '../../shared/protocol';
import { ja } from '../i18n/ja';
import { game } from '../net/game';
import { Button, BUTTON_MAIN_HEIGHT, BUTTON_MIN_HEIGHT } from '../ui/Button';
import { addPanel, drawPanel } from '../ui/draw';
import { Lamp } from '../ui/Lamp';
import { HUD_TOP, setupLayout, viewport, type Viewport } from '../ui/layout';
import { partName, partStatRows } from '../ui/partInfo';
import { TEXT, textStyle } from '../ui/theme';
import { Toast } from '../ui/Toast';
import { SCENE } from './keys';
import { autoOff, remainingColor } from './util';

/** 1 部位あたりの抽選上限 */
const MAX_DRAWS = 5;
/** 比較表の背面を覆う矩形の一辺（どの縦横比でも見えている範囲を覆う） */
const SHADE_SIZE = 4000;
/** 比較表パネルの幅・中心から上端まで・内側の余白 */
const COMPARE_WIDTH = 860;
const COMPARE_HALF_TOP = 215;
const COMPARE_GAP = 20;

/** ガチャ: 4 部位のタブ、現在候補と性能、確定 / 捨てて次を引く、比較表 */
export class DraftScene extends Phaser.Scene {
  private tab: PartType = 'body';
  private timer!: Phaser.GameObjects.Text;
  private opponentText!: Phaser.GameObjects.Text;
  private tabs: Button[] = [];
  private candidateName!: Phaser.GameObjects.Text;
  private stateText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private lamp!: Lamp;
  private drawsLeft!: Phaser.GameObjects.Text;
  private primaryBtn!: Button;
  private redrawBtn!: Button;
  private redrawNote!: Phaser.GameObjects.Text;
  private toast!: Toast;
  private compare: Phaser.GameObjects.Container | null = null;
  private vp!: Viewport;

  constructor() {
    super(SCENE.draft);
  }

  create(): void {
    this.compare = null;
    // 未確定の部位を最初に開く
    this.tab = PART_TYPES.find((t) => !game.privateDraft?.parts[t].locked) ?? 'body';

    // 本体は基準 960×540 の箱の中央を基準に置く（広がった分は余白）
    const { centerX: cx, centerY: cy } = viewport(this);

    // HUD は見えている範囲の端に置き、画面サイズ変更で置き直す（setupLayout の中）
    this.timer = this.add.text(0, 0, '', textStyle(26, TEXT.main, '700')).setOrigin(0.5);
    this.opponentText = this.add.text(0, 0, '', textStyle(18, TEXT.opponent)).setOrigin(1, 0.5);

    this.tabs = PART_TYPES.map(
      (t, i) =>
        new Button(
          this,
          cx - 360 + i * 240,
          cy - 188,
          ja.draft.partNames[t],
          () => {
            this.tab = t;
            this.refresh();
          },
          { width: 220 },
        ),
    );

    addPanel(this, cx, cy + 30, 920, 350);
    this.stateText = this.add.text(cx - 420, cy - 125, '', textStyle(16, TEXT.sub));
    this.candidateName = this.add.text(cx - 420, cy - 100, '', textStyle(36, TEXT.main, '700'));
    this.statsText = this.add.text(cx - 420, cy - 40, '', { ...textStyle(20), lineSpacing: 8 });

    const bx = cx + 240;
    // 残り回数: ランプ 5 個 + 数字
    this.lamp = new Lamp(this, bx - 70, cy - 110, MAX_DRAWS, { radius: 9, gap: 28 });
    this.drawsLeft = this.add.text(bx + 15, cy - 110, '', textStyle(20)).setOrigin(0, 0.5);
    this.primaryBtn = new Button(this, bx, cy - 45, '', () => this.onPrimary(), {
      width: 340,
      height: BUTTON_MAIN_HEIGHT,
    });
    this.redrawBtn = new Button(this, bx, cy + 50, ja.draft.redraw, () => game.draw(this.tab), {
      width: 340,
      variant: 'danger',
    });
    this.redrawNote = this.add
      .text(bx, cy + 86, ja.draft.redrawNote, textStyle(14, TEXT.warn))
      .setOrigin(0.5, 0);
    new Button(this, bx, cy + 160, ja.draft.compare, () => this.toggleCompare(), {
      width: 200,
      variant: 'secondary',
      fontSize: 18,
    });

    this.toast = new Toast(this);

    setupLayout(this, (v) => {
      this.vp = v;
      this.timer.setPosition(v.centerX, v.top + HUD_TOP + 18);
      this.opponentText.setPosition(v.right - 24, v.top + HUD_TOP + 18);
    });

    autoOff(
      this,
      game.on('change', () => this.refresh()),
      game.on('draft', (err) => {
        if (err) this.toast.show(ja.draft.errors[err] ?? err, 'danger');
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
      btn.setVariant(t === this.tab ? 'primary' : 'secondary');
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
    this.lamp.setLit(left, part.locked);
    this.drawsLeft
      .setText(part.locked ? ja.draft.confirmed : ja.draft.drawsLeft(left))
      .setColor(part.locked ? TEXT.ok : TEXT.main);

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
    const v = this.vp;
    const { centerX: cx, centerY: cy } = v;
    const c = this.add.container(0, 0).setDepth(50);
    // 見えている範囲より十分大きく覆い、画面サイズが変わっても隙間を作らない
    const shade = this.add
      .rectangle(cx, cy, SHADE_SIZE, SHADE_SIZE, 0x000000, 0.75)
      .setInteractive();
    c.add(shade);
    // パネルは内容とボタンの高さが決まってから描く（背面に置くため先に追加）
    const panel = this.add.graphics();
    c.add(panel);
    const texts: Phaser.GameObjects.Text[] = [];
    c.add(
      this.add
        .text(
          cx,
          cy - 180,
          `${ja.draft.partNames[this.tab]} ${ja.draft.compare}`,
          textStyle(24, TEXT.main, '700'),
        )
        .setOrigin(0.5),
    );
    const ids = PART_IDS_BY_TYPE[this.tab];
    const labels = partStatRows(this.tab, ids[0]!).map(([k]) => k);
    texts.push(
      this.add.text(cx - 370, cy - 130, ['', ...labels].join('\n'), {
        ...textStyle(18, TEXT.sub),
        lineSpacing: 10,
      }),
    );
    ids.forEach((id, i) => {
      const values = partStatRows(this.tab, id).map(([, val]) => val);
      texts.push(
        this.add
          .text(cx - 80 + i * 180, cy - 130, [partName(id), ...values].join('\n'), {
            ...textStyle(18),
            lineSpacing: 10,
            align: 'center',
          })
          .setOrigin(0.5, 0),
      );
    });
    c.add(texts);
    // 表の下端 + 余白にボタンを置き、パネルはボタンの下にも余白を取って囲む
    const tableBottom = Math.max(...texts.map((t) => t.y + t.height));
    const btnY = tableBottom + COMPARE_GAP + BUTTON_MIN_HEIGHT / 2;
    c.add(
      new Button(this, cx, btnY, ja.draft.close, () => this.toggleCompare(), {
        width: 180,
        variant: 'secondary',
      }),
    );
    const panelTop = cy - COMPARE_HALF_TOP;
    const panelBottom = btnY + BUTTON_MIN_HEIGHT / 2 + COMPARE_GAP;
    drawPanel(panel, cx - COMPARE_WIDTH / 2, panelTop, COMPARE_WIDTH, panelBottom - panelTop);
    this.compare = c;
  }
}
