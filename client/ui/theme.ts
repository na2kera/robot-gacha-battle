import type Phaser from 'phaser';
/** 図形描画の色とフォント。自分=青、相手=赤 */
export const COLORS = {
  background: 0x1b1e2b,
  arenaBorder: 0x3a4060,
  obstacle: 0x4a5278,
  me: 0x4c8dff,
  opponent: 0xff5c5c,
  target: 0xff5c5c,
  panel: 0x262a3d,
  panelBorder: 0x3a4060,
  button: 0x3d5afe,
  buttonDanger: 0x8a3b3b,
  buttonSecondary: 0x4a5070,
  buttonDisabled: 0x33364a,
  hpBack: 0x33364a,
  hpFill: 0x4cd07d,
  debug: 0xffe066,
} as const;

export const TEXT = {
  main: '#e6e8f0',
  sub: '#9aa0b8',
  warn: '#ffb020',
  danger: '#ff5c5c',
  ok: '#4cd07d',
  me: '#4c8dff',
  opponent: '#ff5c5c',
} as const;

export const FONT = 'system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif';

export function textStyle(
  size: number,
  color: string = TEXT.main,
): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT, fontSize: `${size}px`, color };
}
