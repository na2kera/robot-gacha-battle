/**
 * 暗号学的乱数のヘルパー。剰余バイアスを避けるため棄却法を使う。
 */

/** ルームコードの文字。紛らわしい 0/O/1/I/L を除いた大文字英数字（31 文字） */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 10;

/** 0 以上 n 未満（n は 1〜256）の一様な整数を返す */
export function randomIndex(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 256) throw new RangeError('n は 1〜256');
  const limit = 256 - (256 % n);
  const buf = new Uint8Array(16);
  for (;;) {
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit) return b % n;
    }
  }
}

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[randomIndex(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** 大文字化して形式を確認する。不正なら null */
export function normalizeRoomCode(raw: string): string | null {
  const code = raw.toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const c of code) {
    if (!ROOM_CODE_ALPHABET.includes(c)) return null;
  }
  return code;
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 256bit の sessionToken（base64url） */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/** SHA-256 の16進表現 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
