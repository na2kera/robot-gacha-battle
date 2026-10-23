/**
 * ゲームクライアントの状態管理。socket から受けたメッセージで部屋・ガチャ・対戦の状態を保持し、
 * scene へイベントで配る。scene は表示と入力だけを担当し、送信はここのメソッドを使う。
 * 古い matchId のメッセージは捨てる
 */
import type { InputCommand } from '../../shared/input';
import type { Loadout, PartType } from '../../shared/parts';
import {
  PART_TYPES,
  type ClientMessage,
  type PlayerPublicInfo,
  type PrivateDraftState,
  type ResultMessage,
  type RevealMessage,
  type RoomPublicState,
  type ServerMessage,
  type SnapshotMessage,
} from '../../shared/protocol';
import { Emitter } from './emitter';
import { clearSession, saveSession, type StoredSession } from './session';
import { GameSocket, ROOM_NOT_FOUND, type SocketStatus } from './socket';

/** 応答を待つ時間。超えたら操作をやり直せるようにする */
const DRAFT_TIMEOUT_MS = 8000;

export interface PendingDraft {
  kind: 'draftDraw' | 'draftConfirm';
  partType: PartType;
  requestId: string;
  candidateVersion: number;
  sentAt: number;
}

export type GameEvents = {
  /** 部屋・ガチャの状態が変わった */
  change: [];
  /** 新しい matchId（再戦）に切り替わった */
  newMatch: [];
  draft: [error: string | null];
  reveal: [msg: RevealMessage];
  snapshot: [msg: SnapshotMessage, bytes: number];
  result: [msg: ResultMessage];
  status: [status: SocketStatus];
  fatal: [code: string];
  /** leave などでセッションを終えた */
  ended: [];
  /** welcome を受けた（初回接続・再接続とも） */
  welcome: [];
};

function emptyDraft(deadlineAt: number | null): PrivateDraftState {
  const parts = {} as PrivateDraftState['parts'];
  for (const t of PART_TYPES) {
    parts[t] = {
      candidate: null,
      candidateVersion: 0,
      drawCount: 0,
      locked: false,
      confirmed: null,
    };
  }
  return { parts, deadlineAt };
}

function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // 非セキュアコンテキスト（LAN の http）では randomUUID が無いため getRandomValues で代用
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export class GameClient extends Emitter<GameEvents> {
  readonly socket = new GameSocket();
  session: StoredSession | null = null;
  matchId = -1;
  publicState: RoomPublicState | null = null;
  privateDraft: PrivateDraftState | null = null;
  /** reveal で受けた構成（playerId → 構成） */
  loadouts: Record<string, Loadout> | null = null;
  result: ResultMessage | null = null;
  /** 自分が送った rematch の値 */
  rematchRequested = false;
  pending: PendingDraft | null = null;
  /** 最後に welcome を受けた時刻（Date.now） */
  welcomedAt = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  /** ホームに出すお知らせ（ja.apiError のキー）。表示したら消す */
  homeNotice: string | null = null;
  /** 最後に送った input の seq。試合（matchId）ごとに 0 から単調増加し、再接続でも戻さない */
  private inputSeq = 0;

  constructor() {
    super();
    this.socket.on('message', (msg, bytes) => this.handle(msg, bytes));
    this.socket.on('status', (s) => this.emit('status', s));
    this.socket.on('fatal', (code) => {
      if (code === ROOM_NOT_FOUND) {
        // 部屋が消えている: セッションを捨ててホームで知らせる
        this.homeNotice = code;
        this.abandon();
        return;
      }
      this.emit('fatal', code);
    });
  }

  get playerId(): string | null {
    return this.session?.playerId ?? null;
  }

  get phase(): RoomPublicState['phase'] | null {
    return this.publicState?.phase ?? null;
  }

  get me(): PlayerPublicInfo | null {
    return this.publicState?.players.find((p) => p.playerId === this.playerId) ?? null;
  }

  get opponent(): PlayerPublicInfo | null {
    return this.publicState?.players.find((p) => p.playerId !== this.playerId) ?? null;
  }

  /** プレイヤーのスポーン番号。publicState.players の並び順に従う */
  spawnIndexOf(playerId: string): 0 | 1 {
    const i = this.publicState?.players.findIndex((p) => p.playerId === playerId) ?? 0;
    return i === 1 ? 1 : 0;
  }

  nameOf(playerId: string): string {
    return this.publicState?.players.find((p) => p.playerId === playerId)?.name ?? '';
  }

  serverNow(): number {
    return this.socket.serverNow();
  }

  /** deadlineAt までの残りミリ秒。期限なしは null */
  remainingMs(deadlineAt: number | null | undefined): number | null {
    if (deadlineAt === null || deadlineAt === undefined) return null;
    return Math.max(0, deadlineAt - this.serverNow());
  }

  start(session: StoredSession): void {
    this.reset();
    this.session = session;
    saveSession(session);
    this.socket.start(session.roomCode, session.sessionToken);
    this.emit('change');
  }

  reconnectNow(): void {
    this.socket.reconnectNow();
  }

  /** セッションを捨ててホームへ戻る（サーバーへは送らない） */
  abandon(): void {
    this.socket.stop();
    clearSession();
    this.reset();
    this.session = null;
    this.emit('ended');
  }

  leave(): void {
    this.send({ type: 'leave', matchId: this.matchId });
    this.abandon();
  }

  setReady(value: boolean): void {
    this.send({ type: 'ready', matchId: this.matchId, value });
  }

  setRematch(value: boolean): void {
    if (this.send({ type: 'rematch', matchId: this.matchId, value })) {
      this.rematchRequested = value;
      this.emit('change');
    }
  }

  /** 送れたら true。切断中は false */
  sendInput(cmd: InputCommand): boolean {
    return this.send({ type: 'input', matchId: this.matchId, ...cmd });
  }

  /** 次に送る input の seq */
  nextInputSeq(): number {
    return ++this.inputSeq;
  }

  draw(partType: PartType): void {
    this.sendDraft('draftDraw', partType);
  }

  confirm(partType: PartType): void {
    this.sendDraft('draftConfirm', partType);
  }

  /** 4 部位すべて確定済みか */
  get draftComplete(): boolean {
    const d = this.privateDraft;
    return !!d && PART_TYPES.every((t) => d.parts[t].locked);
  }

  /** 自分の確定構成。未完成なら null */
  get myLoadout(): Loadout | null {
    const pid = this.playerId;
    if (pid && this.loadouts?.[pid]) return this.loadouts[pid];
    const d = this.privateDraft;
    if (!d || !this.draftComplete) return null;
    const { body, legs, weapon, core } = d.parts;
    if (!body.confirmed || !legs.confirmed || !weapon.confirmed) return null;
    return {
      body: body.confirmed,
      legs: legs.confirmed,
      weapon: weapon.confirmed,
      core: core.confirmed,
    } as Loadout;
  }

  private sendDraft(kind: PendingDraft['kind'], partType: PartType): void {
    if (this.pending || !this.privateDraft) return;
    const part = this.privateDraft.parts[partType];
    const pending: PendingDraft = {
      kind,
      partType,
      requestId: newRequestId(),
      candidateVersion: part.candidateVersion,
      sentAt: Date.now(),
    };
    this.pending = pending;
    this.sendPending();
    this.pendingTimer = setTimeout(() => {
      if (this.pending?.requestId !== pending.requestId) return;
      this.clearPending();
      this.emit('draft', 'timeout');
      this.emit('change');
    }, DRAFT_TIMEOUT_MS);
    this.emit('change');
  }

  private sendPending(): void {
    const p = this.pending;
    if (!p) return;
    this.send({
      type: p.kind,
      matchId: this.matchId,
      partType: p.partType,
      requestId: p.requestId,
      candidateVersion: p.candidateVersion,
    });
  }

  private clearPending(): void {
    this.pending = null;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }

  private send(msg: ClientMessage): boolean {
    return this.socket.send(msg);
  }

  private reset(): void {
    this.clearPending();
    this.matchId = -1;
    this.publicState = null;
    this.privateDraft = null;
    this.loadouts = null;
    this.result = null;
    this.rematchRequested = false;
    this.inputSeq = 0;
  }

  /** 新しい試合に切り替える。ガチャ・公開・結果の状態を捨てる */
  private beginMatch(matchId: number): void {
    this.clearPending();
    this.matchId = matchId;
    this.privateDraft = null;
    this.loadouts = null;
    this.result = null;
    this.rematchRequested = false;
    this.inputSeq = 0;
  }

  /** RESULT 中の players[].ready はサーバー上の再戦同意 */
  private syncRematch(): void {
    if (this.publicState?.phase === 'RESULT') this.rematchRequested = !!this.me?.ready;
  }

  private handle(msg: ServerMessage, bytes: number): void {
    switch (msg.type) {
      case 'welcome': {
        if (this.session) {
          this.session = { ...this.session, playerId: msg.playerId, roomCode: msg.roomCode };
          saveSession(this.session);
        }
        if (msg.matchId !== this.matchId) this.beginMatch(msg.matchId);
        this.publicState = msg.publicState;
        this.privateDraft =
          msg.privateDraft ??
          (msg.publicState.phase === 'DRAFTING' ? emptyDraft(msg.publicState.deadlineAt) : null);
        this.welcomedAt = Date.now();
        this.syncRematch();
        // 応答前に切れた操作は同じ requestId で再送する（サーバー側で冪等）
        if (this.pending) this.sendPending();
        this.emit('welcome');
        this.emit('change');
        return;
      }
      case 'roomState': {
        if (msg.matchId < this.matchId) return;
        const isNew = msg.matchId > this.matchId;
        if (isNew) this.beginMatch(msg.matchId);
        this.publicState = { phase: msg.phase, deadlineAt: msg.deadlineAt, players: msg.players };
        if (msg.phase === 'CLOSED') {
          // サーバーが部屋を削除して接続を閉じるため、再接続しない。結果表示は残す
          this.socket.stop();
          clearSession();
        }
        if (msg.phase === 'DRAFTING') {
          if (!this.privateDraft) this.privateDraft = emptyDraft(msg.deadlineAt);
          else this.privateDraft.deadlineAt = msg.deadlineAt;
        }
        this.syncRematch();
        if (isNew) this.emit('newMatch');
        this.emit('change');
        return;
      }
      case 'draftResult': {
        if (msg.matchId !== this.matchId || !this.privateDraft) return;
        const part = this.privateDraft.parts[msg.partType];
        // requestId が未知（期限切れの自動確定 'auto' など）でも状態は反映する。古い応答では上書きしない
        if (msg.candidateVersion > part.candidateVersion) {
          part.candidate = msg.candidate;
          part.candidateVersion = msg.candidateVersion;
          part.drawCount = msg.drawCount;
          part.locked = msg.locked;
          part.confirmed = msg.locked ? msg.candidate : null;
        } else if (msg.candidateVersion === part.candidateVersion) {
          // 同じ version（冪等再送など）では確定を後退させない
          part.candidate = msg.candidate;
          part.drawCount = Math.max(part.drawCount, msg.drawCount);
          if (msg.locked) {
            part.locked = true;
            part.confirmed = msg.candidate;
          }
        }
        if (this.pending?.requestId === msg.requestId) this.clearPending();
        this.emit('draft', null);
        this.emit('change');
        return;
      }
      case 'reveal': {
        if (msg.matchId !== this.matchId) return;
        this.loadouts = msg.loadouts;
        this.emit('reveal', msg);
        return;
      }
      case 'snapshot': {
        if (msg.matchId !== this.matchId) return;
        // リロード直後はサーバーが最後に処理した seq の次から送る
        const last = this.playerId ? msg.lastProcessedInputSeq[this.playerId] : undefined;
        if (last !== undefined && last > this.inputSeq) this.inputSeq = last;
        this.emit('snapshot', msg, bytes);
        return;
      }
      case 'result': {
        if (msg.matchId !== this.matchId) return;
        this.result = msg;
        if (Object.keys(msg.loadouts).length > 0) this.loadouts = msg.loadouts;
        this.emit('result', msg);
        return;
      }
      case 'error': {
        if (msg.requestId && this.pending?.requestId === msg.requestId) {
          this.clearPending();
          this.emit('draft', msg.code);
          this.emit('change');
        }
        return;
      }
      case 'pong':
        return;
    }
  }
}

/** アプリ全体で 1 つのクライアント */
export const game = new GameClient();
