/**
 * 通信プロトコルの型と検証。仕様書 8・9・10・12 章。
 * クライアント→サーバーは parseClientMessage で実行時検証する。
 * サーバー→クライアントはサーバーを信頼するため型のみ定義する。
 */
import { validateInput } from './input';
import type { Loadout, PartId, PartType } from './parts';
import type { JudgeReason, PlayerState, ProjectileState } from './simulation';

export const PROTOCOL_VERSION = 1;
/** 1 メッセージの UTF-8 バイト長上限 */
export const MAX_MESSAGE_BYTES = 64 * 1024;
/** sessionToken 文字列の長さ上限 */
export const MAX_SESSION_TOKEN_LENGTH = 256;
/** requestId 文字列の長さ上限 */
export const MAX_REQUEST_ID_LENGTH = 64;
/** プレイヤー名の長さ上限（コードポイント数） */
export const MAX_PLAYER_NAME_LENGTH = 12;

export type RoomPhase =
  'WAITING' | 'DRAFTING' | 'REVEAL' | 'COUNTDOWN' | 'BATTLE' | 'RESULT' | 'CLOSED' | 'ABORTED';

export type ErrorCode =
  | 'invalid_message'
  | 'unauthenticated'
  | 'auth_failed'
  | 'protocol_mismatch'
  | 'stale_match'
  | 'stale_candidate'
  | 'draw_limit'
  | 'part_locked'
  | 'rate_limited'
  | 'room_full'
  | 'room_not_found'
  | 'bad_phase'
  | 'invalid_input'
  | 'message_too_large'
  | 'internal';

export const PART_TYPES: readonly PartType[] = ['body', 'legs', 'weapon', 'core'];

// ---------------------------------------------------------------------------
// クライアント→サーバー
// ---------------------------------------------------------------------------

/**
 * 認証。matchId を含めない: 認証前のクライアントは現在の matchId を知らず、welcome で受け取るため。
 * protocolVersion は接続ごとにここで 1 回だけ照合する（不一致は呼び出し側が protocol_mismatch を返す）。
 * 以降のメッセージは認証済み接続のバージョンに従うため protocolVersion を持たない
 */
export interface AuthenticateMessage {
  type: 'authenticate';
  sessionToken: string;
  protocolVersion: number;
}

export interface ReadyMessage {
  type: 'ready';
  matchId: number;
  value: boolean;
}

export interface DraftDrawMessage {
  type: 'draftDraw';
  matchId: number;
  partType: PartType;
  requestId: string;
  /** 未抽選なら 0 */
  candidateVersion: number;
}

export interface DraftConfirmMessage {
  type: 'draftConfirm';
  matchId: number;
  partType: PartType;
  requestId: string;
  candidateVersion: number;
}

/**
 * 入力。seq は 0 以上の安全な整数であることだけ確認済み。
 * 前回 seq との新旧比較と matchId の照合は呼び出し側（サーバー）が行う
 */
export interface InputMessage {
  type: 'input';
  matchId: number;
  seq: number;
  /** 長さ 1 を超える場合は正規化済み */
  moveX: number;
  moveY: number;
  /** -π..π に正規化済み */
  aimAngle: number;
  firing: boolean;
}

export interface RematchMessage {
  type: 'rematch';
  matchId: number;
  value: boolean;
}

export interface LeaveMessage {
  type: 'leave';
  matchId: number;
}

/** RTT 計測。試合と無関係に往復させるため matchId を含めない */
export interface PingMessage {
  type: 'ping';
  clientTime: number;
}

export type ClientMessage =
  | AuthenticateMessage
  | ReadyMessage
  | DraftDrawMessage
  | DraftConfirmMessage
  | InputMessage
  | RematchMessage
  | LeaveMessage
  | PingMessage;

export type ClientMessageType = ClientMessage['type'];

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; code: ErrorCode };

// ---------------------------------------------------------------------------
// サーバー→クライアント
// ---------------------------------------------------------------------------

export interface PlayerPublicInfo {
  playerId: string;
  name: string;
  connected: boolean;
  ready: boolean;
  /** 確定済み部位数（0〜4）。候補や構成は含めない */
  confirmedParts: number;
}

/** 両プレイヤーに送ってよい部屋の公開状態 */
export interface RoomPublicState {
  phase: RoomPhase;
  /** フェーズの絶対期限（サーバー時刻ミリ秒）。期限なしは null */
  deadlineAt: number | null;
  players: PlayerPublicInfo[];
}

export interface PrivateDraftPart {
  candidate: PartId | null;
  candidateVersion: number;
  drawCount: number;
  locked: boolean;
  confirmed: PartId | null;
}

/** 本人にだけ送るガチャ状態 */
export interface PrivateDraftState {
  parts: Record<PartType, PrivateDraftPart>;
  deadlineAt: number | null;
}

export type ResultReason = JudgeReason | 'disconnect' | 'aborted';

interface ServerMessageBase {
  protocolVersion: typeof PROTOCOL_VERSION;
  /** サーバー時刻（ミリ秒） */
  serverTime: number;
}

export interface WelcomeMessage extends ServerMessageBase {
  type: 'welcome';
  playerId: string;
  roomCode: string;
  matchId: number;
  publicState: RoomPublicState;
  privateDraft: PrivateDraftState | null;
}

export interface DraftResultMessage extends ServerMessageBase {
  type: 'draftResult';
  matchId: number;
  requestId: string;
  partType: PartType;
  candidateVersion: number;
  candidate: PartId;
  drawCount: number;
  locked: boolean;
}

export interface RoomStateMessage extends ServerMessageBase, RoomPublicState {
  type: 'roomState';
  /** rematch で増えるため roomState でも通知する */
  matchId: number;
}

export interface RevealMessage extends ServerMessageBase {
  type: 'reveal';
  matchId: number;
  /** playerId → 構成 */
  loadouts: Record<string, Loadout>;
}

export interface SnapshotMessage extends ServerMessageBase {
  type: 'snapshot';
  matchId: number;
  tick: number;
  elapsedSec: number;
  players: PlayerState[];
  projectiles: ProjectileState[];
  /** playerId → 最後に処理した input の seq。未処理は -1 */
  lastProcessedInputSeq: Record<string, number>;
}

export interface ResultMessage extends ServerMessageBase {
  type: 'result';
  matchId: number;
  /** 引き分け・無効試合は null */
  winnerId: string | null;
  reason: ResultReason;
  /** playerId → 現在 HP / 最大 HP */
  hpRatios: Record<string, number>;
  /** playerId → 構成。公開前に無効となった場合は空 */
  loadouts: Record<string, Loadout>;
}

export interface PongMessage extends ServerMessageBase {
  type: 'pong';
  clientTime: number;
}

export interface ErrorMessage extends ServerMessageBase {
  type: 'error';
  code: ErrorCode;
  message?: string;
  requestId?: string;
  /** false なら接続を閉じる／やり直しが必要 */
  recoverable: boolean;
}

export type ServerMessage =
  | WelcomeMessage
  | DraftResultMessage
  | RoomStateMessage
  | RevealMessage
  | SnapshotMessage
  | ResultMessage
  | PongMessage
  | ErrorMessage;

export type ServerMessageType = ServerMessage['type'];

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 共通フィールドを除いたサーバーメッセージ本体 */
export type ServerMessageBody = DistributiveOmit<ServerMessage, keyof ServerMessageBase>;

/** 共通フィールド（protocolVersion・serverTime）を付けてサーバーメッセージを作る */
export function serverMessage<B extends ServerMessageBody>(
  body: B,
  serverTime: number,
): B & ServerMessageBase {
  return { ...body, protocolVersion: PROTOCOL_VERSION, serverTime };
}

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

export interface CreateRoomRequest {
  name: string;
}

export interface CreateRoomResponse {
  roomCode: string;
  playerId: string;
  sessionToken: string;
  shareUrl: string;
}

export interface JoinRoomRequest {
  name: string;
}

export type JoinRoomResponse = CreateRoomResponse;

/** 制御文字（C0・DEL・C1） */
const CONTROL_CHAR = /\p{Cc}/u;

/**
 * プレイヤー名の検証。trim 後 1〜12 コードポイント、制御文字なし。
 * HTML エスケープはしない（描画側が textContent / Phaser Text で扱う）。
 * 合字の絵文字（ZWJ 連結など）は構成コードポイントごとに数える
 */
export function validatePlayerName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (CONTROL_CHAR.test(name)) return null;
  const length = [...name].length;
  if (length < 1 || length > MAX_PLAYER_NAME_LENGTH) return null;
  return name;
}

// ---------------------------------------------------------------------------
// 検証
// ---------------------------------------------------------------------------

/**
 * UTF-8 バイト長。孤立サロゲートは U+FFFD（3 バイト）として数える。
 * shared は lib.dom を使えないため TextEncoder を使わず自前で数える
 */
export function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

function isMessageTooLarge(raw: string): boolean {
  // UTF-16 1 単位は UTF-8 で 1〜3 バイト。上界・下界で正確な計数を省く
  if (raw.length > MAX_MESSAGE_BYTES) return true;
  if (raw.length * 3 <= MAX_MESSAGE_BYTES) return false;
  return utf8ByteLength(raw) > MAX_MESSAGE_BYTES;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function isBoundedString(v: unknown, maxLength: number): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= maxLength;
}

function isPartType(v: unknown): v is PartType {
  return typeof v === 'string' && (PART_TYPES as readonly string[]).includes(v);
}

type Fields = Record<string, unknown>;

function parseDraft(
  type: 'draftDraw' | 'draftConfirm',
  matchId: number,
  r: Fields,
): DraftDrawMessage | DraftConfirmMessage | null {
  const { partType, requestId, candidateVersion } = r;
  if (!isPartType(partType)) return null;
  if (!isBoundedString(requestId, MAX_REQUEST_ID_LENGTH)) return null;
  if (!isNonNegativeInt(candidateVersion)) return null;
  return { type, matchId, partType, requestId, candidateVersion };
}

function parseFields(r: Fields): ClientMessage | null {
  const type = r.type;
  if (type === 'authenticate') {
    const { sessionToken, protocolVersion } = r;
    if (!isBoundedString(sessionToken, MAX_SESSION_TOKEN_LENGTH)) return null;
    if (!isNonNegativeInt(protocolVersion)) return null;
    return { type, sessionToken, protocolVersion };
  }
  if (type === 'ping') {
    const { clientTime } = r;
    if (typeof clientTime !== 'number' || !Number.isFinite(clientTime)) return null;
    return { type, clientTime };
  }

  // ここから先は matchId 必須
  const { matchId } = r;
  if (!isNonNegativeInt(matchId)) return null;
  switch (type) {
    case 'ready':
    case 'rematch':
      if (typeof r.value !== 'boolean') return null;
      return { type, matchId, value: r.value };
    case 'leave':
      return { type, matchId };
    case 'draftDraw':
    case 'draftConfirm':
      return parseDraft(type, matchId, r);
    case 'input': {
      // 形・範囲・正規化は validateInput に任せる。lastSeq = -1 で新旧判定を無効化し、呼び出し側が行う
      const input = validateInput(r, -1);
      if (!input) return null;
      return { type, matchId, ...input };
    }
    default:
      return null;
  }
}

/**
 * クライアントメッセージの検証。余分なフィールドは捨てる。
 * input の形・範囲が不正なら invalid_input、それ以外の不正は invalid_message。
 * protocolVersion の一致・matchId の新旧・seq の新旧・フェーズの妥当性は呼び出し側が判定する
 */
export function parseClientMessage(raw: string): ParseResult {
  if (typeof raw !== 'string') return { ok: false, code: 'invalid_message' };
  if (isMessageTooLarge(raw)) return { ok: false, code: 'message_too_large' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'invalid_message' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, code: 'invalid_message' };
  }
  const fields = data as Fields;
  const message = parseFields(fields);
  if (message) return { ok: true, message };
  return { ok: false, code: fields.type === 'input' ? 'invalid_input' : 'invalid_message' };
}
