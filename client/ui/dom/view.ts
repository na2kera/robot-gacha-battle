/**
 * DOM 画面（#ui レイヤー）の切り替え。表示中はキャンバス（#app）を隠す。
 * Phaser は止めず、試運転・対戦のときだけ setView(null) でキャンバスを見せる
 */
import { el } from './kit';
import type { ToastKind, View } from './types';

export type { View } from './types';

let ui: HTMLElement | null = null;
let screen: HTMLElement | null = null;
let toastEl: HTMLElement | null = null;
let current: View | null = null;

const TOAST_MS = 2200;
let toastTimer = 0;

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} がありません`);
  return node;
}

/** 起動時に 1 回呼ぶ */
export function initUi(): void {
  ui = byId('ui');
  screen = el('div', { class: 'screen-host' });
  toastEl = el('div', { class: 'toast', role: 'status', hidden: true });
  ui.replaceChildren(screen, toastEl);
  ui.hidden = true;
  // iOS Safari は touchstart の購読が無いと :active（ボタンの沈み）を付けない
  document.addEventListener('touchstart', () => undefined, { passive: true });
}

/** 画面を切り替える。null ならキャンバスを表示する */
export function setView(view: View | null): void {
  if (!ui || !screen) initUi();
  current?.unmount();
  current = null;
  screen!.replaceChildren();
  hideToast();
  const canvas = document.getElementById('app');
  if (view) {
    ui!.hidden = false;
    if (canvas) canvas.style.visibility = 'hidden';
    current = view;
    view.mount(screen!);
  } else {
    ui!.hidden = true;
    if (canvas) canvas.style.visibility = '';
  }
}

/** 状態が変わったときに表示中の画面へ反映する */
export function updateView(): void {
  current?.update?.();
}

/** 画面上部の短い通知。新しい通知で置き換える */
export function showToast(text: string, kind: ToastKind = 'info'): void {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.dataset.kind = kind;
  toastEl.hidden = false;
  // 連続表示でもアニメーションをやり直す
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, TOAST_MS);
}

function hideToast(): void {
  window.clearTimeout(toastTimer);
  if (toastEl) {
    toastEl.hidden = true;
    toastEl.classList.remove('show');
  }
}
