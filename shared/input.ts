/**
 * クライアント入力の検証。仕様書 10 章。座標やダメージは受け付けない。
 */

export interface InputCommand {
  /** 単調増加する整数 */
  seq: number;
  /** 移動ベクトル。長さ 0..1 に正規化済み */
  moveX: number;
  moveY: number;
  /** 照準角（ラジアン、-π..π に正規化済み） */
  aimAngle: number;
  firing: boolean;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 不正な形・NaN・Infinity・範囲外・古い seq を null で拒否する。
 * 移動ベクトルは長さ 1 を超えたら正規化する
 */
export function validateInput(raw: unknown, lastSeq: number): InputCommand | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const { seq, moveX, moveY, aimAngle, firing } = r;

  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0 || seq <= lastSeq) {
    return null;
  }
  if (!isFiniteNumber(moveX) || moveX < -1 || moveX > 1) return null;
  if (!isFiniteNumber(moveY) || moveY < -1 || moveY > 1) return null;
  if (!isFiniteNumber(aimAngle)) return null;
  if (typeof firing !== 'boolean') return null;

  let x = moveX;
  let y = moveY;
  const len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
  }
  return {
    seq,
    moveX: x,
    moveY: y,
    aimAngle: Math.atan2(Math.sin(aimAngle), Math.cos(aimAngle)),
    firing,
  };
}
