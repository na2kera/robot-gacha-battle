import type Phaser from 'phaser';

/**
 * デザイントークン「カプセル工房」。自分=青、相手=赤は全画面で固定。
 * 図形描画は数値、Text と DOM は文字列で使う
 */
export const PALETTE = {
  background: 0x172333,
  surface: 0x293b50,
  border: 0x3c5068,
  text: 0xfff3dc,
  accent: 0xffd166,
  danger: 0xe5484d,
  success: 0x4cd07d,
  me: 0x4c8dff,
  opponent: 0xff5c5c,
} as const;

/** 数値の色を CSS の #rrggbb に */
export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** 色を暗く（amount<0）または明るく（amount>0）する。amount は -1..1 */
export function shade(color: number, amount: number): number {
  const ch = (shift: number) => {
    const v = (color >> shift) & 0xff;
    const t = amount < 0 ? 0 : 255;
    return Math.round(v + (t - v) * Math.abs(amount));
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** 彩度を落とす（無効表示用）。amount は 0..1 */
export function desaturate(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const mix = (v: number) => Math.round(v + (gray - v) * amount);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}

export const COLORS = {
  background: PALETTE.background,
  /** アリーナの床。アリーナ外の余白もこの色で塗る */
  floor: 0x1e2d40,
  arenaBorder: PALETTE.border,
  obstacle: PALETTE.border,
  obstacleTop: 0x4d6482,
  me: PALETTE.me,
  opponent: PALETTE.opponent,
  target: PALETTE.opponent,
  panel: PALETTE.surface,
  panelBorder: PALETTE.border,
  accent: PALETTE.accent,
  danger: PALETTE.danger,
  success: PALETTE.success,
  button: PALETTE.accent,
  buttonDanger: PALETTE.danger,
  /** secondary ボタンの面。パネル（surface）の上でも本体が見えるよう縁色を使う */
  buttonSecondary: PALETTE.border,
  /** secondary ボタンの縁（どの背景でも輪郭を出す） */
  buttonSecondaryEdge: 0x6a83a3,
  buttonDisabled: 0x34465a,
  /** 凹んだ面（入力欄・HP バーの背景） */
  inset: 0x101a26,
  hpBack: 0x101a26,
  hpFill: PALETTE.success,
  /** HP バーの遅延分（減少直後に白っぽく残る部分） */
  hpLag: 0xfff3dc,
  /** 消灯中のランプ */
  lampOff: 0x1b2838,
  shadow: 0x0b121b,
  debug: 0xffe066,
} as const;

export const TEXT = {
  main: css(PALETTE.text),
  sub: '#a9b5c4',
  /** 強調色の面に載せる濃い文字 */
  onAccent: '#2a1e05',
  accent: css(PALETTE.accent),
  warn: css(PALETTE.accent),
  danger: css(PALETTE.danger),
  ok: css(PALETTE.success),
  me: css(PALETTE.me),
  opponent: css(PALETTE.opponent),
} as const;

/** Noto Sans JP は index.html で読み込み、BootScene で読み込み完了を待つ */
export const FONT =
  '"Noto Sans JP", system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif';

export type FontWeight = '500' | '700';

/** 高 DPI の画面で文字が粗くならないよう、端末の画素密度で文字を描く */
function textResolution(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
}

export function textStyle(
  size: number,
  color: string = TEXT.main,
  weight: FontWeight = '500',
): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: FONT,
    fontSize: `${size}px`,
    fontStyle: weight,
    color,
    resolution: textResolution(),
  };
}
