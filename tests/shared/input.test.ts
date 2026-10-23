import { describe, expect, it } from 'vitest';
import { validateInput } from '../../shared/input';

const base = { seq: 5, moveX: 0.3, moveY: -0.4, aimAngle: 1, firing: true };

describe('validateInput', () => {
  it('正しい入力を通す', () => {
    expect(validateInput(base, 4)).toEqual(base);
  });

  it('形が不正なものを拒否', () => {
    for (const raw of [null, undefined, 1, 'x', [], {}]) {
      expect(validateInput(raw, -1)).toBeNull();
    }
    const { firing: _f, ...noFiring } = base;
    expect(validateInput(noFiring, -1)).toBeNull();
    expect(validateInput({ ...base, firing: 1 }, -1)).toBeNull();
  });

  it('数値以外・NaN・Infinity を拒否', () => {
    for (const key of ['seq', 'moveX', 'moveY', 'aimAngle'] as const) {
      for (const bad of ['1', NaN, Infinity, -Infinity, null, true]) {
        expect(validateInput({ ...base, [key]: bad }, -1)).toBeNull();
      }
    }
  });

  it('移動の範囲外を拒否', () => {
    expect(validateInput({ ...base, moveX: 1.01 }, -1)).toBeNull();
    expect(validateInput({ ...base, moveX: -1.01 }, -1)).toBeNull();
    expect(validateInput({ ...base, moveY: 1.5 }, -1)).toBeNull();
    expect(validateInput({ ...base, moveY: -2 }, -1)).toBeNull();
    expect(validateInput({ ...base, moveX: 1, moveY: -1 }, -1)).not.toBeNull();
  });

  it('seq が整数でない・負・古いものを拒否', () => {
    expect(validateInput({ ...base, seq: 5.5 }, -1)).toBeNull();
    expect(validateInput({ ...base, seq: -1 }, -2)).toBeNull();
    expect(validateInput({ ...base, seq: Number.MAX_SAFE_INTEGER + 2 }, -1)).toBeNull();
    expect(validateInput({ ...base, seq: 5 }, 5)).toBeNull();
    expect(validateInput({ ...base, seq: 5 }, 6)).toBeNull();
    expect(validateInput({ ...base, seq: 6 }, 5)).not.toBeNull();
  });

  it('長さ 1 を超える移動ベクトルを正規化', () => {
    const r = validateInput({ ...base, moveX: 1, moveY: 1 }, -1);
    expect(r).not.toBeNull();
    expect(Math.hypot(r!.moveX, r!.moveY)).toBeCloseTo(1, 12);
    expect(r!.moveX).toBeCloseTo(Math.SQRT1_2, 12);
    // 長さ 1 以下はそのまま
    const s = validateInput({ ...base, moveX: 0.5, moveY: 0 }, -1);
    expect(s!.moveX).toBe(0.5);
  });

  it('照準角を -π..π に正規化', () => {
    const r = validateInput({ ...base, aimAngle: 3 * Math.PI + 0.5 }, -1);
    expect(r!.aimAngle).toBeCloseTo(-Math.PI + 0.5, 9);
  });
});
