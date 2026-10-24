/**
 * DOM 画面の部品。要素は createElement と textContent で組み、文字列を HTML として解釈しない
 * （プレイヤー名などを innerHTML に入れない）
 */
import type { Loadout, PartId, PartType } from '../../../shared/parts';
import { ja } from '../../i18n/ja';
import type { ButtonVariant } from './types';

type Child = Node | string | null | undefined | false;
type AttrValue = string | number | boolean | null | undefined | ((ev: Event) => void);

/**
 * 要素を作る。class → className、text → textContent、on* に関数を渡すとイベント登録、
 * 真偽値は属性の有無、それ以外は setAttribute
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (typeof value === 'function') node.addEventListener(key.replace(/^on/, ''), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** 画像のパス。キーは public/img/manifest.json のキー（= ファイル名） */
export function imgUrl(key: string): string {
  return `/img/${key}.png`;
}

/** ドット絵の img */
export function pixelImg(key: string, className = ''): HTMLImageElement {
  const img = el('img', { class: `px ${className}`.trim(), src: imgUrl(key), alt: '' });
  img.draggable = false;
  return img;
}

export type Side = 'blue' | 'red';

/**
 * パーツ正面絵（part_<id>）。相手側（赤）は part_<id>_red を使い、
 * 読み込めなければ青版に戻す
 */
export function setPartImg(img: HTMLImageElement, id: PartId, side: Side = 'blue'): void {
  const key = `${id}:${side}`;
  if (img.dataset.part === key) return;
  img.dataset.part = key;
  const blue = imgUrl(`part_${id}`);
  if (side === 'blue') {
    img.onerror = null;
    img.src = blue;
    return;
  }
  img.onerror = () => {
    img.onerror = null;
    img.src = blue;
  };
  img.src = imgUrl(`part_${id}_red`);
}

export function partImg(id: PartId, side: Side = 'blue', className = ''): HTMLImageElement {
  const img = el('img', { class: `px ${className}`.trim(), alt: '' });
  img.draggable = false;
  setPartImg(img, id, side);
  return img;
}

/** 立体ボタン */
export function button(
  text: string,
  onClick: () => void,
  variant: ButtonVariant = 'primary',
  className = '',
): HTMLButtonElement {
  const b = el('button', { type: 'button', class: `btn ${className}`.trim(), text });
  setVariant(b, variant);
  b.addEventListener('click', () => {
    if (!b.disabled) onClick();
  });
  return b;
}

export function setVariant(b: HTMLButtonElement, variant: ButtonVariant): void {
  b.dataset.variant = variant;
}

/** テキストが変わる時だけ書き換える */
export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** 残り回数などのランプ列 */
export class Lamps {
  readonly el: HTMLElement;
  private leds: HTMLElement[];

  constructor(count: number, className = '') {
    this.leds = Array.from({ length: count }, () => el('span', { class: 'lamp' }));
    this.el = el('span', { class: `lamps ${className}`.trim() }, this.leds);
  }

  /** 点灯数。done=true なら全灯を成功色にする */
  set(lit: number, done = false): void {
    this.leds.forEach((led, i) => {
      led.classList.toggle('on', done || i < lit);
      led.classList.toggle('done', done);
    });
  }
}

/** 重ねる順（下から）。見下ろし視点の層 td_<partId>_<色> */
const LAYERS: readonly PartType[] = ['legs', 'body', 'core', 'weapon'];

/** 未確定の部位をシルエットで見せる時の形 */
export const SILHOUETTE: Record<PartType, PartId> = {
  body: 'body_standard',
  legs: 'legs_biped',
  weapon: 'weapon_machinegun',
  core: 'core_vital',
};

/**
 * 見下ろし視点の機体。4 層の img を重ねる。赤は左向きに反転する。
 * 大きさは CSS 変数 --robot で決める
 */
export class RobotView {
  readonly el: HTMLElement;
  private layers = {} as Record<PartType, HTMLImageElement>;

  constructor(
    private readonly side: Side,
    className = '',
  ) {
    const inner = el('span', { class: 'robot-inner' });
    for (const t of LAYERS) {
      const img = el('img', { class: `px robot-layer layer-${t}`, alt: '' });
      img.draggable = false;
      this.layers[t] = img;
      inner.append(img);
    }
    this.el = el('span', { class: `robot ${side} ${className}`.trim() }, [inner]);
  }

  /** 1 部位を設定する。id が null なら隠す。solid=false はシルエット */
  setPart(type: PartType, id: PartId | null, solid: boolean): void {
    const img = this.layers[type];
    img.hidden = id === null;
    if (id !== null) {
      const src = imgUrl(`td_${id}_${this.side}`);
      if (img.getAttribute('src') !== src) img.src = src;
    }
    img.classList.toggle('silhouette', !solid);
  }

  /** 構成全体。null なら全部位シルエット */
  setLoadout(loadout: Loadout | null): void {
    for (const t of LAYERS) {
      if (loadout) this.setPart(t, loadout[t], true);
      else this.setPart(t, SILHOUETTE[t], false);
    }
  }

  layer(type: PartType): HTMLImageElement {
    return this.layers[type];
  }
}

/** 部位の重ね順（公開の装着演出で使う） */
export const ROBOT_LAYERS = LAYERS;

/**
 * プレイヤー名の表示。自分なら名前の右に「あなた」のチップを添える（名前の文字列には足さない）。
 * 名前は 1 行で、入りきらない時だけ省略記号にする。色は親の --side
 */
export class NameTag {
  readonly el: HTMLElement;
  private text: HTMLElement;
  private chip: HTMLElement;

  constructor(className = '') {
    this.text = el('span', { class: 'name-text' });
    this.chip = el('span', { class: 'you-chip off', text: ja.common.you });
    this.el = el('div', { class: `name-tag ${className}`.trim() }, [this.text, this.chip]);
  }

  set(name: string, me = false): this {
    setText(this.text, name);
    // 省略された時に全文を見られるようにする
    if (this.text.title !== name) this.text.title = name;
    // 縦積み（.name-stack）では左右の高さを揃えるため、消さずに見えなくするだけにする（ui.css）
    this.chip.classList.toggle('off', !me);
    return this;
  }
}
