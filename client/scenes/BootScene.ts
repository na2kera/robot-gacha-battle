import Phaser from 'phaser';
import { BODIES, CORES, LEGS, WEAPONS } from '../../shared/parts';
import { ja } from '../i18n/ja';
import { FONT } from '../ui/theme';
import { SCENE } from './keys';
import { router } from './router';

/** Web フォントを待つ上限。超えたらシステムフォントで進む */
const FONT_TIMEOUT_MS = 2000;
/** 画像一覧と画像の読み込み全体の上限。超えたら図形描画のまま進む */
const IMAGE_TIMEOUT_MS = 8000;

/** 文言の値を再帰的に集める。関数の文言は数値 0 を渡して文字を得る */
function collectText(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'function') {
    const fn = value as (...args: number[]) => unknown;
    collectText(fn(...Array.from({ length: fn.length }, () => 0)), out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectText(v, out);
  }
}

/**
 * 画面に出る文字。Google Fonts の日本語は unicode-range で分割配信されるため、
 * 使う文字を渡して必要な分を読み込ませる（プレイヤー名の文字は事前に分からない）
 */
function uiText(): string {
  const out: string[] = ['0123456789%×+-/:.()！？…—✓'];
  collectText(ja, out);
  for (const defs of [BODIES, LEGS, WEAPONS, CORES]) {
    for (const d of Object.values(defs)) out.push(d.name);
  }
  return [...new Set(out.join(''))].join('');
}

/** Noto Sans JP（index.html で読み込み）の 700/500 が使えるまで待つ。失敗しても進む */
async function waitFonts(): Promise<void> {
  if (!document.fonts?.load) return;
  const text = uiText();
  const loads = Promise.all([
    document.fonts.load(`700 16px ${FONT}`, text),
    document.fonts.load(`500 16px ${FONT}`, text),
  ]).then(
    () => undefined,
    () => undefined,
  );
  let timer = 0;
  const timeout = new Promise<void>((resolve) => {
    timer = window.setTimeout(resolve, FONT_TIMEOUT_MS);
  });
  await Promise.race([loads, timeout]);
  window.clearTimeout(timer);
}

/** 画像一覧。形式は {"images": {"key": "img/xxx.png"}} */
const MANIFEST_URL = '/img/manifest.json';

/** manifest にあっても Phaser のテクスチャにしない画像（DOM 側だけで使う / 使わなくなった） */
const SKIP_KEYS = new Set(['logo']);

async function fetchManifest(signal: AbortSignal): Promise<Record<string, string>> {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache', signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: unknown = await res.json();
    const images = (json as { images?: unknown } | null)?.images;
    if (!images || typeof images !== 'object') throw new Error('images がありません');
    const out: Record<string, string> = {};
    for (const [key, path] of Object.entries(images)) {
      if (typeof path === 'string' && !SKIP_KEYS.has(key)) out[key] = path;
    }
    return out;
  } catch (e) {
    if (!signal.aborted) console.warn('画像一覧を読み込めませんでした', e);
    return {};
  }
}

/**
 * 画像 1 枚を読み込んで decode まで済ませる。Phaser Loader は requestAnimationFrame 駆動で
 * 背景タブでは止まるため、fetch と Image.decode（タブの表示状態に関係なく進む）を使う。
 * ImageBitmap は WebGL へのアップロードで Phaser の乗算済みアルファ設定が効かないため使わない
 */
async function loadImage(path: string, signal: AbortSignal): Promise<HTMLImageElement> {
  const res = await fetch(path, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  try {
    const img = new Image();
    img.src = url;
    if (typeof img.decode === 'function') {
      await img.decode();
    } else {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('decode に失敗しました'));
      });
    }
    return img;
  } finally {
    // decode 済みの画素は Image が保持するため、URL はすぐ解放してよい
    URL.revokeObjectURL(url);
  }
}

/**
 * 起動直後にフォントと画像を待ち、router へ制御を渡す scene。
 * 画像はドット絵なので読み込み後に最近傍（NEAREST）で拡大縮小するよう設定する。
 * 一覧や画像が読めなくても進行は止めない（警告ログのみ）
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENE.boot);
  }

  create(): void {
    // 画像の読み込みが終わらなくても IMAGE_TIMEOUT_MS で打ち切り、router へ進む（図形描画で遊べる）。
    // 打ち切ったら fetch を中断し、decode が後から終わってもテクスチャに登録しない
    // （遊んでいる途中で図形描画から画像へ切り替わらないようにする）
    const abort = new AbortController();
    let timer = 0;
    const imageTimeout = new Promise<void>((resolve) => {
      timer = window.setTimeout(() => {
        console.warn('画像の読み込みが時間内に終わりませんでした');
        abort.abort();
        resolve();
      }, IMAGE_TIMEOUT_MS);
    });
    const images = this.loadImages(abort.signal).finally(() => window.clearTimeout(timer));
    void Promise.all([waitFonts(), Promise.race([images, imageTimeout])]).then(() =>
      router.start(this.game),
    );
  }

  private async loadImages(signal: AbortSignal): Promise<void> {
    const images = await fetchManifest(signal);
    await Promise.all(
      Object.entries(images).map(async ([key, path]) => {
        if (signal.aborted) return;
        try {
          const img = await loadImage(path, signal);
          if (signal.aborted || this.textures.exists(key)) return;
          const texture = this.textures.addImage(key, img);
          texture?.setFilter(Phaser.Textures.FilterMode.NEAREST);
        } catch (e) {
          if (!signal.aborted) console.warn('画像を読み込めませんでした', key, e);
        }
      }),
    );
  }
}
