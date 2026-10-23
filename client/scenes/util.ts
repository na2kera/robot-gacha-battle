import Phaser from 'phaser';

/** scene 終了時に購読を解除する */
export function autoOff(scene: Phaser.Scene, ...offs: (() => void)[]): void {
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    for (const off of offs) off();
  });
}

/** Phaser の DOM Element として使う input 要素 */
export function createTextInput(opts: {
  placeholder: string;
  value: string;
  maxLength: number;
  width: number;
  readOnly?: boolean;
  fontSize?: number;
}): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'text';
  el.placeholder = opts.placeholder;
  el.value = opts.value;
  el.maxLength = opts.maxLength;
  el.readOnly = !!opts.readOnly;
  el.autocomplete = 'off';
  el.spellcheck = false;
  Object.assign(el.style, {
    width: `${opts.width}px`,
    height: '44px',
    boxSizing: 'border-box',
    padding: '0 12px',
    fontSize: `${opts.fontSize ?? 20}px`,
    border: '2px solid #3a4060',
    borderRadius: '6px',
    background: '#10121c',
    color: '#e6e8f0',
    outline: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  return el;
}

/** 残り秒の表示色。30 秒と 10 秒で強調 */
export function remainingColor(sec: number, normal: string, warn: string, danger: string): string {
  if (sec <= 10) return danger;
  if (sec <= 30) return warn;
  return normal;
}
