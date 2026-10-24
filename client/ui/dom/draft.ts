/**
 * ガチャ: 上に 4 部位タブ、左に組立プレビュー、中央にカプセルと候補、右に確定 / 捨てて次を引く。
 * 抽選演出はサーバー応答（候補受信）の後に始め、期限で状態が先に進んだら即終了する
 */
import { PART_IDS_BY_TYPE, type PartId, type PartType } from '../../../shared/parts';
import { PART_TYPES } from '../../../shared/protocol';
import { ja } from '../../i18n/ja';
import { game } from '../../net/game';
import { remainingColor } from '../../scenes/util';
import { partName, partStatRows } from '../partInfo';
import {
  button,
  el,
  imgUrl,
  Lamps,
  partImg,
  pixelImg,
  RobotView,
  setPartImg,
  setText,
  setVariant,
  SILHOUETTE,
} from './kit';
import type { View } from './types';
import { showToast } from './view';

/** 1 部位あたりの抽選上限 */
const MAX_DRAWS = 5;
/** カプセルが揺れる時間 */
const SHAKE_MS = 250;
/** パーツが跳ね出す時間 */
const POP_MS = 350;
/** 確定したパーツがプレビューへ飛ぶ時間 */
const FLY_MS = 300;
/** 残り秒の更新間隔 */
const TICK_MS = 200;

interface Tab {
  btn: HTMLButtonElement;
  check: HTMLElement;
}

export class DraftView implements View {
  private tab: PartType = 'body';
  private tabs = {} as Record<PartType, Tab>;
  private timer!: HTMLElement;
  private opponent!: HTMLElement;
  private preview!: RobotView;
  private stage!: HTMLElement;
  private capsule!: HTMLImageElement;
  private part!: HTMLImageElement;
  private info!: HTMLElement;
  private stateText!: HTMLElement;
  private nameText!: HTMLElement;
  private stats!: HTMLElement;
  private statsKey = '';
  private lamps!: Lamps;
  private drawsLeft!: HTMLElement;
  private primaryBtn!: HTMLButtonElement;
  private redrawBtn!: HTMLButtonElement;
  private note!: HTMLElement;
  private modal: HTMLElement | null = null;
  private closeModal: ((restoreFocus?: boolean) => void) | null = null;
  private compareBtn!: HTMLButtonElement;
  private root!: HTMLElement;

  /** 画面に反映済みの candidateVersion */
  private seen = {} as Record<PartType, number>;
  /** 自分の操作の応答を待っている部位（演出の対象） */
  private expectDraw: PartType | null = null;
  private expectConfirm: PartType | null = null;
  /** 抽選演出中 */
  private animating = false;
  /** 跳ね出すまで候補名・性能を隠す */
  private hideInfo = false;
  private animTimers: number[] = [];
  private flyers: HTMLElement[] = [];
  private tick = 0;
  private offDraft: (() => void) | null = null;

  mount(root: HTMLElement): void {
    const draft = game.privateDraft;
    // 未確定の部位を最初に開く
    this.tab = PART_TYPES.find((t) => !draft?.parts[t].locked) ?? 'body';
    for (const t of PART_TYPES) this.seen[t] = draft?.parts[t].candidateVersion ?? 0;

    this.timer = el('div', { class: 'timer' });
    this.opponent = el('div', { class: 'opponent-count' });

    const tabRow = el('div', { class: 'tabs', role: 'tablist' });
    for (const t of PART_TYPES) {
      const check = el('span', { class: 'tab-check', text: '✓', 'aria-hidden': 'true' });
      const btn = el('button', { type: 'button', class: 'btn tab', role: 'tab' }, [
        pixelImg(`icon_${t}`, 'tab-icon'),
        el('span', { text: ja.draft.partNames[t] }),
        check,
      ]);
      btn.addEventListener('click', () => this.selectTab(t));
      this.tabs[t] = { btn, check };
      tabRow.append(btn);
    }

    this.preview = new RobotView('blue', 'preview-robot');

    this.capsule = pixelImg('capsule_closed', 'capsule');
    this.part = el('img', { class: 'px stage-part', alt: '' });
    this.part.draggable = false;
    this.stage = el('div', { class: 'stage' }, [
      el('span', { class: 'stage-shadow' }),
      this.capsule,
      this.part,
    ]);
    this.stateText = el('div', { class: 'label' });
    this.nameText = el('div', { class: 'part-name' });
    this.stats = el('dl', { class: 'stats' });
    this.info = el('div', { class: 'cand-info' }, [this.stateText, this.nameText, this.stats]);

    this.lamps = new Lamps(MAX_DRAWS);
    this.drawsLeft = el('span', { class: 'draws-left' });
    this.primaryBtn = button('', () => this.onPrimary(), 'primary', 'btn-main');
    this.redrawBtn = button(ja.draft.redraw, () => this.onRedraw(), 'danger');
    this.note = el('p', { class: 'note', text: ja.draft.redrawNote });
    this.compareBtn = button(ja.draft.compare, () => this.openCompare(), 'secondary', 'btn-small');

    this.root = el('div', { class: 'view draft' }, [
      el('div', { class: 'draft-top' }, [el('span'), this.timer, this.opponent]),
      tabRow,
      el('div', { class: 'draft-main' }, [
        el('div', { class: 'panel draft-preview' }, [this.preview.el]),
        el('div', { class: 'panel draft-cand' }, [this.stage, this.info]),
        el('div', { class: 'draft-actions' }, [
          el('div', { class: 'row lamps-row' }, [this.lamps.el, this.drawsLeft]),
          this.primaryBtn,
          this.redrawBtn,
          this.note,
          this.compareBtn,
        ]),
      ]),
    ]);
    root.append(this.root);

    this.offDraft = game.on('draft', (err) => {
      if (err) showToast(ja.draft.errors[err] ?? err, 'danger');
    });
    this.tick = window.setInterval(() => this.updateTimer(), TICK_MS);
    this.updateTimer();
    this.update();
  }

  unmount(): void {
    this.closeModal?.(false);
    this.cancelAnim();
    window.clearInterval(this.tick);
    this.offDraft?.();
    this.offDraft = null;
  }

  private selectTab(t: PartType): void {
    if (t === this.tab) return;
    this.cancelAnim();
    this.tab = t;
    this.update();
  }

  private onPrimary(): void {
    const part = game.privateDraft?.parts[this.tab];
    if (!part || part.locked || game.pending || this.animating) return;
    if (part.candidate === null) {
      this.expectDraw = this.tab;
      game.draw(this.tab);
    } else {
      this.expectConfirm = this.tab;
      game.confirm(this.tab);
    }
  }

  private onRedraw(): void {
    if (game.pending || this.animating) return;
    this.expectDraw = this.tab;
    game.draw(this.tab);
  }

  private updateTimer(): void {
    const ms = game.remainingMs(game.publicState?.deadlineAt ?? game.privateDraft?.deadlineAt);
    if (ms === null) {
      setText(this.timer, '');
      return;
    }
    const sec = Math.ceil(ms / 1000);
    setText(this.timer, ja.common.remaining(sec));
    this.timer.dataset.level = remainingColor(sec, 'normal', 'warn', 'danger');
  }

  update(): void {
    const draft = game.privateDraft;
    if (!draft) return;
    setText(this.opponent, ja.common.opponentConfirmed(game.opponent?.confirmedParts ?? 0));

    const part = draft.parts[this.tab];
    // 自分の抽選の応答で新しい候補が来たら演出する
    if (
      this.expectDraw === this.tab &&
      part.candidateVersion > this.seen[this.tab] &&
      part.candidate !== null &&
      !part.locked
    ) {
      this.expectDraw = null;
      this.startDrawAnim(part.candidate);
    } else if (this.expectConfirm === this.tab && part.locked && part.confirmed) {
      this.expectConfirm = null;
      this.flyToPreview();
    }
    // 期限の自動確定などで先に確定したら演出を打ち切る
    if (part.locked && this.animating) this.cancelAnim();
    for (const t of PART_TYPES) this.seen[t] = draft.parts[t].candidateVersion;
    // 応答（成功・エラー・時間切れ）で pending が消えたら待ちを解く
    if (!game.pending) {
      this.expectDraw = null;
      this.expectConfirm = null;
    }

    for (const t of PART_TYPES) {
      const p = draft.parts[t];
      const tab = this.tabs[t];
      tab.btn.setAttribute('aria-selected', String(t === this.tab));
      setVariant(tab.btn, t === this.tab ? 'primary' : 'secondary');
      tab.btn.classList.toggle('locked', p.locked);
      tab.check.hidden = !p.locked;
      // プレビュー: 確定部位は実体、未確定は候補（無ければ標準形）のシルエット
      const id = p.locked ? p.confirmed : (p.candidate ?? SILHOUETTE[t]);
      this.preview.setPart(t, id, p.locked);
    }

    const pending = game.pending !== null;
    const id = part.locked ? part.confirmed : part.candidate;
    if (!this.animating) this.renderStage(id, part.locked);
    this.info.classList.toggle('hidden-during-anim', this.hideInfo);
    setText(
      this.stateText,
      part.locked ? ja.draft.confirmed : part.candidate ? ja.draft.candidate : ja.draft.notDrawn,
    );
    setText(this.nameText, id ? partName(id) : '—');
    this.renderStats(id);

    const left = MAX_DRAWS - part.drawCount;
    this.lamps.set(left, part.locked);
    setText(this.drawsLeft, part.locked ? ja.draft.confirmed : ja.draft.drawsLeft(left));
    this.drawsLeft.classList.toggle('ok', part.locked);

    const hasCandidate = part.candidate !== null;
    this.primaryBtn.hidden = part.locked;
    this.redrawBtn.hidden = part.locked || !hasCandidate;
    this.note.hidden = part.locked || !hasCandidate;
    setText(
      this.primaryBtn,
      pending ? ja.draft.pending : hasCandidate ? ja.draft.confirm : ja.draft.drawFree,
    );
    this.primaryBtn.disabled = pending || this.animating;
    this.redrawBtn.disabled = pending || this.animating || left <= 0;
  }

  /** 演出なしの表示。未抽選は閉じたカプセル、候補は開いたカプセル + パーツ、確定はパーツのみ */
  private renderStage(id: PartId | null, locked: boolean): void {
    const state = locked ? 'locked' : id ? 'open' : 'closed';
    this.stage.dataset.state = state;
    const capsule = imgUrl(state === 'closed' ? 'capsule_closed' : 'capsule_open');
    if (this.capsule.getAttribute('src') !== capsule) this.capsule.src = capsule;
    this.part.hidden = id === null;
    if (id) setPartImg(this.part, id);
  }

  private renderStats(id: PartId | null): void {
    const key = id ?? '';
    if (key === this.statsKey) return;
    this.statsKey = key;
    const rows = id ? partStatRows(this.tab, id) : [];
    this.stats.replaceChildren(
      ...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]),
    );
  }

  /** 揺れ（0.25 秒）→ 割れる → パーツが下から跳ね出す（0.35 秒） */
  private startDrawAnim(id: PartId): void {
    this.cancelAnim();
    this.animating = true;
    this.hideInfo = true;
    this.stage.dataset.state = 'closed';
    this.capsule.src = imgUrl('capsule_closed');
    this.part.hidden = true;
    setPartImg(this.part, id);
    this.capsule.classList.add('is-shaking');
    this.animTimers.push(
      window.setTimeout(() => {
        this.capsule.classList.remove('is-shaking');
        this.capsule.src = imgUrl('capsule_open');
        this.stage.dataset.state = 'open';
        this.part.hidden = false;
        this.part.classList.add('is-pop');
        this.hideInfo = false;
        this.info.classList.remove('hidden-during-anim');
      }, SHAKE_MS),
      window.setTimeout(() => {
        this.part.classList.remove('is-pop');
        this.animating = false;
        this.update();
      }, SHAKE_MS + POP_MS),
    );
  }

  /** 確定したパーツの絵をプレビューへ飛ばす */
  private flyToPreview(): void {
    if (this.part.hidden) return;
    const from = this.part.getBoundingClientRect();
    const to = this.preview.el.getBoundingClientRect();
    if (from.width === 0 || to.width === 0) return;
    const flyer = this.part.cloneNode() as HTMLImageElement;
    flyer.className = 'px flyer';
    Object.assign(flyer.style, {
      left: `${from.left}px`,
      top: `${from.top}px`,
      width: `${from.width}px`,
      height: `${from.height}px`,
    });
    document.body.append(flyer);
    this.flyers.push(flyer);
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const scale = Math.min(1, (to.width * 0.6) / from.width);
    void flyer.offsetWidth;
    flyer.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    flyer.style.opacity = '0.2';
    this.animTimers.push(
      window.setTimeout(() => {
        flyer.remove();
        this.flyers = this.flyers.filter((f) => f !== flyer);
        this.preview.el.classList.remove('is-snap');
        void this.preview.el.offsetWidth;
        this.preview.el.classList.add('is-snap');
      }, FLY_MS),
    );
  }

  private cancelAnim(): void {
    for (const t of this.animTimers) window.clearTimeout(t);
    this.animTimers = [];
    for (const f of this.flyers) f.remove();
    this.flyers = [];
    this.capsule?.classList.remove('is-shaking');
    this.part?.classList.remove('is-pop');
    this.animating = false;
    this.hideInfo = false;
    this.info?.classList.remove('hidden-during-anim');
  }

  private openCompare(): void {
    if (this.modal) return;
    const ids = PART_IDS_BY_TYPE[this.tab];
    const labels = partStatRows(this.tab, ids[0]!).map(([k]) => k);
    const head = el('tr', {}, [
      el('th'),
      ...ids.map((id) =>
        el('th', { scope: 'col' }, [
          partImg(id, 'blue', 'compare-img'),
          el('div', { text: partName(id) }),
        ]),
      ),
    ]);
    const body = labels.map((label, row) =>
      el('tr', {}, [
        el('th', { scope: 'row', text: label }),
        ...ids.map((id) => el('td', { text: partStatRows(this.tab, id)[row]![1] })),
      ]),
    );
    // Escape・背景クリック・「閉じる」で閉じ、フォーカスを「比較表」ボタンへ戻す
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    const close = (restoreFocus = true) => {
      document.removeEventListener('keydown', onKey);
      this.modal?.remove();
      this.modal = null;
      this.closeModal = null;
      if (restoreFocus && this.compareBtn.isConnected) this.compareBtn.focus();
    };
    const closeBtn = button(ja.draft.close, () => close(), 'secondary');
    const titleId = 'compare-title';
    this.modal = el(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      [
        el('div', { class: 'panel modal-box' }, [
          el('h2', {
            class: 'modal-title',
            id: titleId,
            text: `${ja.draft.partNames[this.tab]} ${ja.draft.compare}`,
          }),
          el('div', { class: 'modal-scroll' }, [
            el('table', { class: 'compare' }, [el('thead', {}, [head]), el('tbody', {}, body)]),
          ]),
          closeBtn,
        ]),
      ],
    );
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) close();
    });
    document.addEventListener('keydown', onKey);
    this.closeModal = close;
    this.root.append(this.modal);
    closeBtn.focus();
  }
}
