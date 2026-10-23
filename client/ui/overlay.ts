/**
 * Phaser の外に置く HTML オーバーレイ（縦向き案内・再接続バナー）。
 * 文字は textContent で入れ、HTML として解釈しない
 */
import { ja } from '../i18n/ja';

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} がありません`);
  return el;
}

/** 縦向きなら true */
export function isPortrait(): boolean {
  return (
    window.matchMedia('(orientation: portrait)').matches || window.innerHeight > window.innerWidth
  );
}

const orientationListeners = new Set<(portrait: boolean) => void>();

export function onOrientationChange(fn: (portrait: boolean) => void): () => void {
  orientationListeners.add(fn);
  return () => orientationListeners.delete(fn);
}

export function setupOverlays(onReconnect: () => void): void {
  const rotate = byId('rotate-overlay');
  rotate.textContent = ja.common.rotate;
  let last: boolean | null = null;
  const update = () => {
    const p = isPortrait();
    rotate.hidden = !p;
    if (p !== last) {
      last = p;
      for (const fn of orientationListeners) fn(p);
    }
  };
  window.addEventListener('resize', update);
  window.matchMedia('(orientation: portrait)').addEventListener('change', update);
  update();

  const button = byId('banner-button');
  button.textContent = ja.common.reconnect;
  button.addEventListener('click', onReconnect);
}

/** 画面上部の再接続バナー。text が null なら隠す */
export function setBanner(text: string | null, showButton = false): void {
  const banner = byId('banner');
  banner.hidden = text === null;
  byId('banner-text').textContent = text ?? '';
  byId('banner-button').hidden = !showButton;
}
