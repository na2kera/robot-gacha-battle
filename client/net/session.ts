/**
 * 接続情報の永続化。sessionStorage に 1 つのオブジェクトで保存し、同じタブでの復帰に使う。
 * 名前だけは localStorage に記憶する
 */

export interface StoredSession {
  sessionToken: string;
  roomCode: string;
  playerId: string;
}

const SESSION_KEY = 'rgb.session';
const NAME_KEY = 'rgb.name';

export function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof v.sessionToken === 'string' &&
      typeof v.roomCode === 'string' &&
      typeof v.playerId === 'string'
    ) {
      return { sessionToken: v.sessionToken, roomCode: v.roomCode, playerId: v.playerId };
    }
  } catch {
    // 壊れた値は無視する
  }
  return null;
}

export function saveSession(s: StoredSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // 保存できなくても同じページ内では続行できる
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // 無視
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // 無視
  }
}
