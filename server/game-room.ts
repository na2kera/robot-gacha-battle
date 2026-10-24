/**
 * GameRoom Durable Object。1 ルーム 1 Object。仕様書 7〜12 章、docs/flow.md。
 *
 * - 休止（Hibernation）から復元できるよう、ルームメタ・参加者・ガチャ状態・requestId の結果・
 *   公開済み構成・直近の結果・BATTLE マーカーを storage に保存する
 * - 期限処理は単一の alarm にまとめる。alarm では保存済みの phase/deadlineAt と現在時刻から
 *   やるべきことを再計算し、次に最も近い期限で setAlarm し直す
 * - BATTLE の座標・弾はメモリのみ。BATTLE マーカーがあるのにメモリが無ければ中断（aborted）
 */
import { DurableObject } from 'cloudflare:workers';
import { BATTLE_DURATION_SEC, COUNTDOWN_SEC } from '../shared/config';
import type { Loadout } from '../shared/parts';
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  serverMessage,
  type AuthenticateMessage,
  type ClientMessage,
  type DraftConfirmMessage,
  type DraftDrawMessage,
  type ErrorCode,
  type PlayerPublicInfo,
  type ResultMessage,
  type ResultReason,
  type RoomPhase,
  type RoomPublicState,
  type ServerMessageBody,
  type SnapshotMessage,
} from '../shared/protocol';
import type { BattleState } from '../shared/simulation';
import { BattleLoop } from './battle-loop';
import {
  AUTH_TIMEOUT_MS,
  CLOSE_AUTH_FAILED,
  CLOSE_AUTH_TIMEOUT,
  CLOSE_NORMAL,
  CLOSE_PROTOCOL_MISMATCH,
  CLOSE_REPLACED,
  CLOSE_SILENT,
  DRAFTING_MS,
  EMPTY_CLOSE_MS,
  INPUT_MESSAGES_PER_SEC,
  INPUT_SILENCE_MS,
  MAX_UNAUTHENTICATED_SOCKETS,
  OTHER_MESSAGES_PER_SEC,
  RECONNECT_GRACE_MS,
  RESULT_TTL_MS,
  REVEAL_MS,
  ROOM_CAPACITY,
  WAITING_TTL_MS,
} from './constants';
import {
  appendLog,
  applyConfirm,
  applyDraw,
  autoComplete,
  confirmedCount,
  emptyDraft,
  emptyRequestLog,
  findLoggedResult,
  isComplete,
  toLoadout,
  type DraftParts,
  type DraftResultBody,
  type RequestLog,
} from './draft';
import { generateSessionToken, sha256Hex } from './random';

// ---------------------------------------------------------------------------
// 保存する型
// ---------------------------------------------------------------------------

export interface RoomMeta {
  code: string;
  phase: RoomPhase;
  createdAt: number;
  matchId: number;
  /** フェーズの絶対期限。BATTLE は試合終了予定（停止時間ぶん延長済み） */
  deadlineAt: number | null;
  /** 全員が切断した時刻。誰か接続中なら null */
  emptySince: number | null;
}

export interface PlayerRecord {
  slot: 0 | 1;
  playerId: string;
  name: string;
  /** sessionToken の SHA-256（16進）。平文は保存しない */
  tokenHash: string;
  ready: boolean;
  rematch: boolean;
}

export interface BattleMarker {
  matchId: number;
  startedAt: number;
  /** 両者切断で止めた時間の合計（試合期限の延長量） */
  pausedMs: number;
}

/** WebSocket attachment。休止から認証状態を復元する */
type Attachment =
  { authenticated: false; connectedAt: number } | { authenticated: true; playerId: string };

type ResultBody = Omit<ResultMessage, 'protocolVersion' | 'serverTime'>;
type SnapshotBody = Omit<SnapshotMessage, 'protocolVersion' | 'serverTime'>;

interface BattleRuntime {
  marker: BattleMarker;
  loop: BattleLoop;
  /** playerId → 切断時刻 */
  disconnectedAt: Map<string, number>;
  /** 両者切断で停止した時刻 */
  pausedAt: number | null;
  lastSnapshot: SnapshotBody | null;
  /**
   * playerId → 最後に認証済みメッセージを受け取った実時刻（Date.now）。無通信検知に使う。
   * tick ループと同じく実時間で測る（clockOffsetMs の影響を受けない）
   */
  lastHeardAt: Map<string, number>;
}

interface RateCounter {
  windowStart: number;
  input: number;
  other: number;
  notified: boolean;
}

export type CreateRoomOutcome =
  { ok: true; playerId: string; sessionToken: string } | { ok: false; error: 'exists' };

export type JoinRoomOutcome =
  | { ok: true; playerId: string; sessionToken: string }
  | { ok: false; error: 'room_not_found' | 'room_full' };

const KEY_META = 'meta';
const KEY_PLAYERS = 'players';
const KEY_LOADOUTS = 'loadouts';
const KEY_RESULT = 'result';
const KEY_BATTLE = 'battle';
const draftKey = (playerId: string): string => `draft:${playerId}`;
const logKey = (playerId: string): string => `reqlog:${playerId}`;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function attachmentOf(ws: WebSocket): Attachment {
  const a = ws.deserializeAttachment() as Attachment | null;
  return a ?? { authenticated: false, connectedAt: 0 };
}

function safeClose(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // 既に閉じている
  }
}

function hpRatiosOf(state: BattleState): Record<string, number> {
  const ratios: Record<string, number> = {};
  for (const p of state.players) ratios[p.id] = p.maxHp > 0 ? Math.max(0, p.hp) / p.maxHp : 0;
  return ratios;
}

export class GameRoom extends DurableObject<Env> {
  /**
   * テスト専用: 期限判定に使う時計のずれ（ミリ秒）。runInDurableObject から操作する。
   * フィールドは RPC に公開されない。tick ループの実時間には影響しない
   */
  clockOffsetMs = 0;

  private meta: RoomMeta | null = null;
  private players: PlayerRecord[] = [];
  private readonly drafts = new Map<string, DraftParts>();
  private readonly requestLogs = new Map<string, RequestLog>();
  private loadouts: Record<string, Loadout> | null = null;
  private lastResult: ResultBody | null = null;
  private battle: BattleRuntime | null = null;
  private readonly rateCounters = new WeakMap<WebSocket, RateCounter>();
  /** close/error を受けた接続。readyState が更新されない場合に備えて記録する */
  private readonly goneSockets = new WeakSet<WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(() => this.load());
  }

  private now(): number {
    return Date.now() + this.clockOffsetMs;
  }

  // -------------------------------------------------------------------------
  // 復元
  // -------------------------------------------------------------------------

  private async load(): Promise<void> {
    const storage = this.ctx.storage;
    const stored = await storage.get<unknown>([
      KEY_META,
      KEY_PLAYERS,
      KEY_LOADOUTS,
      KEY_RESULT,
      KEY_BATTLE,
    ]);
    this.meta = (stored.get(KEY_META) as RoomMeta | undefined) ?? null;
    if (!this.meta) return;
    this.players = (stored.get(KEY_PLAYERS) as PlayerRecord[] | undefined) ?? [];
    this.loadouts = (stored.get(KEY_LOADOUTS) as Record<string, Loadout> | undefined) ?? null;
    this.lastResult = (stored.get(KEY_RESULT) as ResultBody | undefined) ?? null;
    for (const p of this.players) {
      const draft = await storage.get<DraftParts>(draftKey(p.playerId));
      const log = await storage.get<RequestLog>(logKey(p.playerId));
      this.drafts.set(p.playerId, draft ?? emptyDraft());
      this.requestLogs.set(p.playerId, log ?? emptyRequestLog());
    }
    if (stored.get(KEY_BATTLE)) {
      // 試合中に Object が作り直された（再起動・デプロイ・退避）。休止からの通常復帰とは区別する
      console.log('battle marker found without memory: aborted');
      await this.finishMatch(null, 'aborted', {});
    }
  }

  // -------------------------------------------------------------------------
  // Worker から呼ぶ RPC
  // -------------------------------------------------------------------------

  /** 未初期化なら初期化して作成者を参加させる。初期化済みなら失敗（コード衝突） */
  async create(code: string, name: string): Promise<CreateRoomOutcome> {
    const sessionToken = generateSessionToken();
    const tokenHash = await sha256Hex(sessionToken);
    // ハッシュ計算の await 後に判定と初期化を同期的に行う（原子的）
    if (this.meta) return { ok: false, error: 'exists' };
    const now = this.now();
    this.meta = {
      code,
      phase: 'WAITING',
      createdAt: now,
      matchId: 1,
      deadlineAt: now + WAITING_TTL_MS,
      emptySince: null,
    };
    const player = this.addPlayer(0, name, tokenHash);
    await this.ctx.storage.put({
      [KEY_META]: this.meta,
      [KEY_PLAYERS]: this.players,
      [draftKey(player.playerId)]: this.drafts.get(player.playerId),
      [logKey(player.playerId)]: this.requestLogs.get(player.playerId),
    });
    await this.scheduleAlarm();
    console.log('room created');
    return { ok: true, playerId: player.playerId, sessionToken };
  }

  /** 空き枠を原子的に確保する。未初期化・終了・期限切れは room_not_found */
  async join(name: string): Promise<JoinRoomOutcome> {
    const sessionToken = generateSessionToken();
    const tokenHash = await sha256Hex(sessionToken);
    const m = this.meta;
    if (!m || m.phase === 'CLOSED') return { ok: false, error: 'room_not_found' };
    if (m.phase === 'WAITING' && m.deadlineAt !== null && this.now() >= m.deadlineAt) {
      return { ok: false, error: 'room_not_found' };
    }
    if (this.players.length >= ROOM_CAPACITY || m.phase !== 'WAITING') {
      return { ok: false, error: 'room_full' };
    }
    const slot = this.players.some((p) => p.slot === 0) ? 1 : 0;
    const player = this.addPlayer(slot, name, tokenHash);
    await this.ctx.storage.put({
      [KEY_PLAYERS]: this.players,
      [draftKey(player.playerId)]: this.drafts.get(player.playerId),
      [logKey(player.playerId)]: this.requestLogs.get(player.playerId),
    });
    console.log(`player joined ${player.playerId}`);
    this.broadcastRoomState();
    return { ok: true, playerId: player.playerId, sessionToken };
  }

  private addPlayer(slot: 0 | 1, name: string, tokenHash: string): PlayerRecord {
    const player: PlayerRecord = {
      slot,
      playerId: crypto.randomUUID(),
      name,
      tokenHash,
      ready: false,
      rematch: false,
    };
    this.players.push(player);
    this.players.sort((a, b) => a.slot - b.slot);
    this.drafts.set(player.playerId, emptyDraft());
    this.requestLogs.set(player.playerId, emptyRequestLog());
    return player;
  }

  // -------------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    if (!this.meta || this.meta.phase === 'CLOSED') return json({ error: 'room_not_found' }, 404);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'upgrade_required' }, 426);
    }
    const unauthenticated = this.openSockets().filter((ws) => !attachmentOf(ws).authenticated);
    if (unauthenticated.length >= MAX_UNAUTHENTICATED_SOCKETS) {
      return json({ error: 'rate_limited' }, 429);
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const attachment: Attachment = { authenticated: false, connectedAt: this.now() };
    server.serializeAttachment(attachment);
    await this.scheduleAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // 置換済み・閉じかけの接続からの操作は無視する
    if (!this.isOpen(ws)) return;
    if (!this.meta) {
      safeClose(ws, CLOSE_NORMAL, 'closed');
      return;
    }
    const parsed =
      typeof message === 'string'
        ? parseClientMessage(message)
        : ({ ok: false, code: 'invalid_message' } as const);
    const bucket = parsed.ok && parsed.message.type === 'input' ? 'input' : 'other';
    if (!this.consumeRate(ws, bucket)) return;
    if (!parsed.ok) {
      this.sendError(ws, parsed.code, true);
      return;
    }
    const msg = parsed.message;
    const att = attachmentOf(ws);
    if (!att.authenticated) {
      if (msg.type === 'authenticate') await this.authenticate(ws, msg);
      else this.sendError(ws, 'unauthenticated', true);
      return;
    }
    const player = this.players.find((p) => p.playerId === att.playerId);
    if (!player) {
      this.sendError(ws, 'auth_failed', false);
      safeClose(ws, CLOSE_AUTH_FAILED, 'auth_failed');
      return;
    }
    // 無通信検知用。input に限らず認証済みメッセージなら生存とみなす
    this.battle?.lastHeardAt.set(player.playerId, Date.now());
    await this.dispatch(ws, player, msg);
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // クライアントからの close に応答してハンドシェイクを完了させる
    const reply = code === 1000 || (code >= 3000 && code <= 4999) ? code : CLOSE_NORMAL;
    safeClose(ws, reply, 'closed');
    await this.onSocketGone(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  private async onSocketGone(ws: WebSocket): Promise<void> {
    this.goneSockets.add(ws);
    if (!this.meta) return;
    const att = attachmentOf(ws);
    if (att.authenticated && !this.isConnected(att.playerId)) {
      await this.handleDisconnect(att.playerId);
    } else {
      await this.scheduleAlarm();
    }
  }

  /** 1 秒窓の頻度制限。超過したら窓ごとに 1 回だけ error を返して無視する */
  private consumeRate(ws: WebSocket, bucket: 'input' | 'other'): boolean {
    const now = this.now();
    let c = this.rateCounters.get(ws);
    if (!c || now - c.windowStart >= 1000) {
      c = { windowStart: now, input: 0, other: 0, notified: false };
      this.rateCounters.set(ws, c);
    }
    c[bucket]++;
    const limit = bucket === 'input' ? INPUT_MESSAGES_PER_SEC : OTHER_MESSAGES_PER_SEC;
    if (c[bucket] <= limit) return true;
    if (!c.notified) {
      c.notified = true;
      this.sendError(ws, 'rate_limited', true);
    }
    return false;
  }

  private async authenticate(ws: WebSocket, msg: AuthenticateMessage): Promise<void> {
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      this.sendError(ws, 'protocol_mismatch', false);
      safeClose(ws, CLOSE_PROTOCOL_MISMATCH, 'protocol_mismatch');
      return;
    }
    const hash = await sha256Hex(msg.sessionToken);
    if (!this.isOpen(ws)) return;
    const m = this.meta;
    const player = m ? this.players.find((p) => p.tokenHash === hash) : undefined;
    if (!m || !player) {
      console.log('auth_failed');
      this.sendError(ws, 'auth_failed', false);
      safeClose(ws, CLOSE_AUTH_FAILED, 'auth_failed');
      return;
    }
    // 認証済みにする前に期限を処理する（猶予切れ後の再接続で切断負けを回避させない）
    await this.advance();
    if (!this.isOpen(ws)) return;
    if (!this.meta) {
      safeClose(ws, CLOSE_NORMAL, 'closed');
      return;
    }
    const playerId = player.playerId;
    const attachment: Attachment = { authenticated: true, playerId };
    ws.serializeAttachment(attachment);
    // 同じ token の旧接続を置換する
    for (const other of this.openSockets()) {
      if (other === ws) continue;
      const a = attachmentOf(other);
      if (a.authenticated && a.playerId === playerId) {
        this.sendError(other, 'replaced', false);
        safeClose(other, CLOSE_REPLACED, 'replaced');
        this.goneSockets.add(other);
      }
    }
    console.log(`connect ${playerId}`);
    this.meta.emptySince = null;
    await this.resumeBattleFor(playerId);
    this.sendWelcome(ws, player);
    this.broadcastRoomState();
    await this.ctx.storage.put(KEY_META, this.meta);
    await this.advance();
  }

  private sendWelcome(ws: WebSocket, player: PlayerRecord): void {
    const m = this.meta!;
    const draft = this.drafts.get(player.playerId) ?? emptyDraft();
    this.send(ws, {
      type: 'welcome',
      playerId: player.playerId,
      roomCode: m.code,
      matchId: m.matchId,
      publicState: this.publicState(),
      privateDraft:
        m.phase === 'WAITING'
          ? null
          : { parts: draft, deadlineAt: m.phase === 'DRAFTING' ? m.deadlineAt : null },
    });
    if (
      (m.phase === 'REVEAL' || m.phase === 'COUNTDOWN' || m.phase === 'BATTLE') &&
      this.loadouts
    ) {
      this.send(ws, { type: 'reveal', matchId: m.matchId, loadouts: this.loadouts });
    }
    if (m.phase === 'BATTLE' && this.battle?.lastSnapshot) this.send(ws, this.battle.lastSnapshot);
    if (m.phase === 'RESULT' && this.lastResult) this.send(ws, this.lastResult);
  }

  private async dispatch(ws: WebSocket, player: PlayerRecord, msg: ClientMessage): Promise<void> {
    const m = this.meta!;
    switch (msg.type) {
      case 'ping':
        this.send(ws, { type: 'pong', clientTime: msg.clientTime });
        return;
      case 'authenticate':
        this.sendError(ws, 'invalid_message', true);
        return;
      default:
        break;
    }
    const requestId =
      msg.type === 'draftDraw' || msg.type === 'draftConfirm' ? msg.requestId : undefined;
    if (msg.matchId !== m.matchId) {
      this.sendError(ws, 'stale_match', true, requestId);
      return;
    }
    switch (msg.type) {
      case 'leave':
        await this.handleLeave(ws, player);
        return;
      case 'ready':
        if (m.phase !== 'WAITING') return this.sendError(ws, 'bad_phase', true);
        player.ready = msg.value;
        await this.ctx.storage.put(KEY_PLAYERS, this.players);
        this.broadcastRoomState();
        await this.advance();
        return;
      case 'draftDraw':
      case 'draftConfirm': {
        // 現在の試合の再送は phase に関係なく保存済みの結果を返す（最後の確定で REVEAL に進んだ後など）
        const logged = findLoggedResult(
          this.requestLogs.get(player.playerId)!,
          msg.partType,
          msg.requestId,
        );
        if (logged) {
          this.send(ws, logged);
          return;
        }
        // 期限切れなら先に自動確定などを処理し、その後の phase で判定する
        await this.advance();
        if (!this.meta || !this.isOpen(ws)) return;
        if (this.meta.phase !== 'DRAFTING' || this.meta.matchId !== msg.matchId) {
          return this.sendError(ws, 'bad_phase', true, requestId);
        }
        await this.handleDraft(ws, player, msg);
        return;
      }
      case 'input': {
        if (m.phase !== 'BATTLE' || !this.battle) return this.sendError(ws, 'bad_phase', true);
        const { seq, moveX, moveY, aimAngle, firing } = msg;
        const accepted = this.battle.loop.acceptInput(player.playerId, {
          seq,
          moveX,
          moveY,
          aimAngle,
          firing,
        });
        if (!accepted) this.sendError(ws, 'invalid_input', true);
        return;
      }
      case 'rematch':
        if (m.phase !== 'RESULT') return this.sendError(ws, 'bad_phase', true);
        player.rematch = msg.value;
        await this.ctx.storage.put(KEY_PLAYERS, this.players);
        if (this.players.length === ROOM_CAPACITY && this.players.every((p) => p.rematch)) {
          m.matchId++;
          await this.startDrafting(this.now());
          await this.scheduleAlarm();
        } else {
          this.broadcastRoomState();
        }
        return;
    }
  }

  private async handleDraft(
    ws: WebSocket,
    player: PlayerRecord,
    msg: DraftDrawMessage | DraftConfirmMessage,
  ): Promise<void> {
    const m = this.meta!;
    const playerId = player.playerId;
    const draft = this.drafts.get(playerId)!;
    const log = this.requestLogs.get(playerId)!;
    const { partType, requestId } = msg;

    // 再送は保存済みの結果を返す（二重消費しない）
    const logged = findLoggedResult(log, partType, requestId);
    if (logged) {
      this.send(ws, logged);
      return;
    }
    const before = draft[partType];
    const outcome =
      msg.type === 'draftDraw'
        ? applyDraw(before, partType, msg.candidateVersion)
        : applyConfirm(before, msg.candidateVersion);
    if (!outcome.ok) {
      this.sendError(ws, outcome.code, true, requestId);
      return;
    }
    const part = outcome.part;
    draft[partType] = part;
    const shown = part.locked ? part.confirmed : part.candidate;
    const result: DraftResultBody = {
      type: 'draftResult',
      matchId: m.matchId,
      requestId,
      partType,
      candidateVersion: part.candidateVersion,
      candidate: shown!,
      drawCount: part.drawCount,
      locked: part.locked,
    };
    appendLog(log, partType, { requestId, result });
    // 保存完了後に返信する
    await this.ctx.storage.put({ [draftKey(playerId)]: draft, [logKey(playerId)]: log });
    this.send(ws, result);
    if (!before.locked && part.locked) {
      this.broadcastRoomState();
      await this.advance();
    }
  }

  private async handleLeave(ws: WebSocket, player: PlayerRecord): Promise<void> {
    const m = this.meta!;
    console.log(`leave ${player.playerId}`);
    if (m.phase === 'BATTLE' && this.battle) {
      const other = this.players.find((p) => p.playerId !== player.playerId);
      await this.finishMatch(
        other?.playerId ?? null,
        'disconnect',
        hpRatiosOf(this.battle.loop.state),
      );
      safeClose(ws, CLOSE_NORMAL, 'leave');
      return;
    }
    await this.closeRoom('leave');
  }

  private async handleDisconnect(playerId: string): Promise<void> {
    const m = this.meta;
    if (!m) return;
    const b = this.battle;
    if (m.phase === 'BATTLE' && b?.disconnectedAt.has(playerId)) {
      // 無通信で切断扱いにした接続の close が後から届いた等。最初の切断時刻のまま猶予を数える
      await this.scheduleAlarm();
      return;
    }
    console.log(`disconnect ${playerId}`);
    const now = this.now();
    const anyoneConnected = this.players.some((p) => this.isConnected(p.playerId));
    if (!anyoneConnected) m.emptySince = now;
    if (m.phase === 'BATTLE' && b) {
      b.disconnectedAt.set(playerId, now);
      b.loop.clearInput(playerId);
      if (!anyoneConnected && b.pausedAt === null) {
        b.loop.pause();
        b.pausedAt = now;
        console.log('battle paused');
      }
    }
    await this.ctx.storage.put(KEY_META, m);
    this.broadcastRoomState();
    await this.advance();
  }

  /** BATTLE 中の復帰。両者切断で止めていたら再開し、停止時間ぶん期限を延長する */
  private async resumeBattleFor(playerId: string): Promise<void> {
    const b = this.battle;
    const m = this.meta;
    if (!b || !m || m.phase !== 'BATTLE') return;
    b.disconnectedAt.delete(playerId);
    b.lastHeardAt.set(playerId, Date.now());
    if (b.pausedAt === null) return;
    const paused = Math.max(0, this.now() - b.pausedAt);
    b.pausedAt = null;
    b.marker.pausedMs += paused;
    if (m.deadlineAt !== null) m.deadlineAt += paused;
    b.loop.start();
    console.log(`battle resumed after ${paused}ms`);
    await this.ctx.storage.put({ [KEY_BATTLE]: b.marker, [KEY_META]: m });
  }

  // -------------------------------------------------------------------------
  // 期限と遷移
  // -------------------------------------------------------------------------

  override async alarm(): Promise<void> {
    if (!this.meta) return;
    const now = this.now();
    for (const ws of this.openSockets()) {
      const a = attachmentOf(ws);
      if (!a.authenticated && now >= a.connectedAt + AUTH_TIMEOUT_MS) {
        safeClose(ws, CLOSE_AUTH_TIMEOUT, 'auth_timeout');
        this.goneSockets.add(ws);
      }
    }
    await this.advance();
  }

  /** 現在時刻と状態から遷移を進め、次の alarm を設定する */
  private async advance(): Promise<void> {
    for (let i = 0; i < 8 && this.meta; i++) {
      if (!(await this.stepPhase(this.now()))) break;
    }
    if (this.meta) await this.scheduleAlarm();
  }

  /** 遷移したら true */
  private async stepPhase(now: number): Promise<boolean> {
    const m = this.meta!;
    if (m.phase !== 'BATTLE' && m.emptySince !== null && now >= m.emptySince + EMPTY_CLOSE_MS) {
      await this.closeRoom('empty');
      return false;
    }
    const deadline = m.deadlineAt ?? Number.POSITIVE_INFINITY;
    switch (m.phase) {
      case 'WAITING':
        if (now >= deadline) {
          await this.closeRoom('waiting_expired');
          return false;
        }
        if (this.players.length === ROOM_CAPACITY && this.players.every((p) => p.ready)) {
          await this.startDrafting(now);
          return true;
        }
        return false;
      case 'DRAFTING': {
        const complete = this.players.every((p) => isComplete(this.drafts.get(p.playerId)!));
        if (!complete) {
          if (now < deadline) return false;
          await this.autoCompleteDrafts();
          return true;
        }
        return this.advanceWhenConnected(now, deadline, () => this.startReveal(now));
      }
      case 'REVEAL':
        if (now < deadline) return false;
        return this.advanceWhenConnected(now, deadline, () => this.startCountdown(now));
      case 'COUNTDOWN':
        if (now < deadline) return false;
        return this.advanceWhenConnected(now, deadline, () => this.startBattle(now));
      case 'BATTLE':
        return this.checkBattleGrace(now);
      case 'RESULT':
        if (now >= deadline) await this.closeRoom('result_expired');
        return false;
      default:
        return false;
    }
  }

  /** 両者接続中なら次へ。期限から猶予を過ぎても揃わなければ中断 */
  private async advanceWhenConnected(
    now: number,
    deadline: number,
    next: () => Promise<void>,
  ): Promise<boolean> {
    if (this.allConnected()) {
      await next();
      return true;
    }
    if (now >= deadline + RECONNECT_GRACE_MS) {
      await this.finishMatch(null, 'aborted', {});
      return true;
    }
    return false;
  }

  private async checkBattleGrace(now: number): Promise<boolean> {
    const b = this.battle;
    if (!b) {
      await this.finishMatch(null, 'aborted', {});
      return true;
    }
    const expired = [...b.disconnectedAt.values()].some((t) => now >= t + RECONNECT_GRACE_MS);
    if (!expired) return false;
    const connected = this.players.filter((p) => this.isConnected(p.playerId));
    const ratios = hpRatiosOf(b.loop.state);
    if (connected.length === 1)
      await this.finishMatch(connected[0]!.playerId, 'disconnect', ratios);
    else await this.finishMatch(null, 'aborted', ratios);
    return true;
  }

  private async scheduleAlarm(): Promise<void> {
    const m = this.meta;
    const storage = this.ctx.storage;
    if (!m) {
      await storage.deleteAlarm();
      return;
    }
    const now = this.now();
    const times: number[] = [];
    for (const ws of this.openSockets()) {
      const a = attachmentOf(ws);
      if (!a.authenticated) times.push(a.connectedAt + AUTH_TIMEOUT_MS);
    }
    if (m.phase !== 'BATTLE' && m.emptySince !== null) times.push(m.emptySince + EMPTY_CLOSE_MS);
    const deadline = m.deadlineAt;
    switch (m.phase) {
      case 'WAITING':
      case 'RESULT':
        if (deadline !== null) times.push(deadline);
        break;
      case 'DRAFTING':
      case 'REVEAL':
      case 'COUNTDOWN':
        if (deadline !== null)
          times.push(now < deadline ? deadline : deadline + RECONNECT_GRACE_MS);
        break;
      case 'BATTLE':
        if (!this.battle) times.push(now);
        else
          for (const t of this.battle.disconnectedAt.values()) times.push(t + RECONNECT_GRACE_MS);
        break;
      default:
        break;
    }
    if (times.length === 0) {
      await storage.deleteAlarm();
      return;
    }
    const next = Math.min(...times) - this.clockOffsetMs;
    await storage.setAlarm(Math.max(next, Date.now()));
  }

  private setPhase(phase: RoomPhase, deadlineAt: number | null): void {
    const m = this.meta!;
    console.log(`phase ${m.phase} -> ${phase} (match ${m.matchId})`);
    m.phase = phase;
    m.deadlineAt = deadlineAt;
  }

  private async startDrafting(now: number): Promise<void> {
    this.setPhase('DRAFTING', now + DRAFTING_MS);
    const entries: Record<string, unknown> = { [KEY_META]: this.meta };
    for (const p of this.players) {
      p.ready = false;
      p.rematch = false;
      this.drafts.set(p.playerId, emptyDraft());
      this.requestLogs.set(p.playerId, emptyRequestLog());
      entries[draftKey(p.playerId)] = this.drafts.get(p.playerId);
      entries[logKey(p.playerId)] = this.requestLogs.get(p.playerId);
    }
    entries[KEY_PLAYERS] = this.players;
    this.loadouts = null;
    this.lastResult = null;
    await this.ctx.storage.put(entries);
    await this.ctx.storage.delete([KEY_LOADOUTS, KEY_RESULT]);
    this.broadcastRoomState();
  }

  /** 期限切れ: 候補ありは確定、未抽選は 1 回だけ抽選して確定。本人に draftResult を送る */
  private async autoCompleteDrafts(): Promise<void> {
    const m = this.meta!;
    console.log('drafting deadline: auto complete');
    const entries: Record<string, unknown> = {};
    const notices: [string, DraftResultBody][] = [];
    for (const p of this.players) {
      const draft = this.drafts.get(p.playerId)!;
      for (const partType of autoComplete(draft)) {
        const part = draft[partType];
        notices.push([
          p.playerId,
          {
            type: 'draftResult',
            matchId: m.matchId,
            requestId: 'auto',
            partType,
            candidateVersion: part.candidateVersion,
            candidate: part.confirmed!,
            drawCount: part.drawCount,
            locked: true,
          },
        ]);
      }
      entries[draftKey(p.playerId)] = draft;
    }
    await this.ctx.storage.put(entries);
    for (const [playerId, body] of notices) this.sendTo(playerId, body);
    this.broadcastRoomState();
  }

  private async startReveal(now: number): Promise<void> {
    const loadouts: Record<string, Loadout> = {};
    for (const p of this.players) loadouts[p.playerId] = toLoadout(this.drafts.get(p.playerId)!)!;
    this.loadouts = loadouts;
    this.setPhase('REVEAL', now + REVEAL_MS);
    await this.ctx.storage.put({ [KEY_META]: this.meta, [KEY_LOADOUTS]: loadouts });
    this.broadcast({ type: 'reveal', matchId: this.meta!.matchId, loadouts });
    this.broadcastRoomState();
  }

  private async startCountdown(now: number): Promise<void> {
    this.setPhase('COUNTDOWN', now + COUNTDOWN_SEC * 1000);
    await this.ctx.storage.put(KEY_META, this.meta);
    this.broadcastRoomState();
  }

  private async startBattle(now: number): Promise<void> {
    const m = this.meta!;
    const loadouts = this.loadouts!;
    const marker: BattleMarker = { matchId: m.matchId, startedAt: now, pausedMs: 0 };
    this.setPhase('BATTLE', now + BATTLE_DURATION_SEC * 1000);
    // 開始前にマーカーを保存する
    await this.ctx.storage.put({ [KEY_BATTLE]: marker, [KEY_META]: m });
    const [a, b] = this.players as [PlayerRecord, PlayerRecord];
    const matchId = m.matchId;
    const loop = new BattleLoop(
      [
        { playerId: a.playerId, loadout: loadouts[a.playerId]! },
        { playerId: b.playerId, loadout: loadouts[b.playerId]! },
      ],
      {
        onSnapshot: (state, lastProcessedInputSeq) =>
          this.onSnapshot(matchId, state, lastProcessedInputSeq),
        onEnd: (result) => {
          this.finishMatch(result.winnerId, result.reason, result.hpRatios).catch(() =>
            console.log('error internal (finish)'),
          );
        },
        onStall: () => {
          console.log('battle stalled: aborted');
          this.finishMatch(null, 'aborted', hpRatiosOf(loop.state)).catch(() =>
            console.log('error internal (stall)'),
          );
        },
      },
    );
    const startedAt = Date.now();
    this.battle = {
      marker,
      loop,
      disconnectedAt: new Map(),
      pausedAt: null,
      lastSnapshot: null,
      lastHeardAt: new Map(this.players.map((p) => [p.playerId, startedAt])),
    };
    this.broadcastRoomState();
    this.onSnapshot(matchId, loop.state, loop.lastProcessedInputSeq());
    loop.start();
  }

  private onSnapshot(
    matchId: number,
    state: BattleState,
    lastProcessedInputSeq: Record<string, number>,
  ): void {
    const b = this.battle;
    if (!b) return;
    const body: SnapshotBody = {
      type: 'snapshot',
      matchId,
      tick: state.tick,
      elapsedSec: state.elapsedSec,
      players: state.players,
      projectiles: state.projectiles,
      lastProcessedInputSeq,
    };
    b.lastSnapshot = body;
    this.broadcast(body);
    this.checkSilence();
  }

  /**
   * BATTLE 中（tick 進行中）に INPUT_SILENCE_MS を超えて何も届かない接続を切断扱いにする。
   * snapshot 送信ごとに呼ぶ。両者切断で loop が止まっている間は呼ばれない（猶予は alarm が扱う）
   */
  private checkSilence(): void {
    const b = this.battle;
    if (!b || b.pausedAt !== null || this.meta?.phase !== 'BATTLE') return;
    const now = Date.now();
    for (const p of this.players) {
      const playerId = p.playerId;
      if (b.disconnectedAt.has(playerId)) continue;
      const last = b.lastHeardAt.get(playerId);
      if (last === undefined || now - last <= INPUT_SILENCE_MS) continue;
      const sockets = this.openSockets().filter((ws) => {
        const a = attachmentOf(ws);
        return a.authenticated && a.playerId === playerId;
      });
      // 接続が無ければ close/error の処理（handleDisconnect）に任せる
      if (sockets.length === 0) continue;
      console.log(`silent ${playerId} ${now - last}ms`);
      for (const ws of sockets) {
        safeClose(ws, CLOSE_SILENT, 'silent');
        this.goneSockets.add(ws);
      }
      // disconnectedAt の記録と pause の判定は最初の await より前に同期的に行われる
      this.handleDisconnect(playerId).catch(() => console.log('error internal (silent)'));
    }
  }

  /** 試合を終えて RESULT へ。タイマーを必ず止め、BATTLE マーカーを削除する */
  private async finishMatch(
    winnerId: string | null,
    reason: ResultReason,
    hpRatios: Record<string, number>,
  ): Promise<void> {
    const m = this.meta;
    if (!m) return;
    if (this.battle) {
      this.battle.loop.stop();
      this.battle = null;
    }
    const now = this.now();
    this.setPhase('RESULT', now + RESULT_TTL_MS);
    for (const p of this.players) p.rematch = false;
    const result: ResultBody = {
      type: 'result',
      matchId: m.matchId,
      winnerId,
      reason,
      hpRatios,
      loadouts: this.loadouts ?? {},
    };
    this.lastResult = result;
    console.log(`match ${m.matchId} result ${reason}`);
    await this.ctx.storage.put({
      [KEY_META]: m,
      [KEY_RESULT]: result,
      [KEY_PLAYERS]: this.players,
    });
    await this.ctx.storage.delete(KEY_BATTLE);
    this.broadcast(result);
    this.broadcastRoomState();
    await this.scheduleAlarm();
  }

  /** CLOSED: 全接続を閉じ、storage を削除する */
  private async closeRoom(reason: string): Promise<void> {
    const m = this.meta;
    console.log(`room closed (${reason})`);
    if (this.battle) {
      this.battle.loop.stop();
      this.battle = null;
    }
    if (m) {
      m.phase = 'CLOSED';
      m.deadlineAt = null;
      this.broadcastRoomState();
    }
    for (const ws of this.ctx.getWebSockets()) safeClose(ws, CLOSE_NORMAL, 'closed');
    this.meta = null;
    this.players = [];
    this.drafts.clear();
    this.requestLogs.clear();
    this.loadouts = null;
    this.lastResult = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // -------------------------------------------------------------------------
  // 接続と送信
  // -------------------------------------------------------------------------

  private isOpen(ws: WebSocket): boolean {
    return !this.goneSockets.has(ws) && ws.readyState === WebSocket.READY_STATE_OPEN;
  }

  private openSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => this.isOpen(ws));
  }

  private isConnected(playerId: string): boolean {
    return this.openSockets().some((ws) => {
      const a = attachmentOf(ws);
      return a.authenticated && a.playerId === playerId;
    });
  }

  private allConnected(): boolean {
    return (
      this.players.length === ROOM_CAPACITY &&
      this.players.every((p) => this.isConnected(p.playerId))
    );
  }

  private publicState(): RoomPublicState {
    const m = this.meta!;
    const players: PlayerPublicInfo[] = this.players.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      connected: this.isConnected(p.playerId),
      // RESULT では再戦の同意を ready として示す
      ready: m.phase === 'RESULT' ? p.rematch : p.ready,
      confirmedParts: m.phase === 'WAITING' ? 0 : confirmedCount(this.drafts.get(p.playerId)!),
    }));
    return { phase: m.phase, deadlineAt: m.deadlineAt, players };
  }

  private broadcastRoomState(): void {
    if (!this.meta) return;
    this.broadcast({ type: 'roomState', matchId: this.meta.matchId, ...this.publicState() });
  }

  private send(ws: WebSocket, body: ServerMessageBody): void {
    if (!this.isOpen(ws)) return;
    try {
      ws.send(JSON.stringify(serverMessage(body, this.now())));
    } catch {
      this.markSendFailed(ws);
    }
  }

  /** 送信に失敗した接続には以後送らない。切断処理は close イベントで行う */
  private markSendFailed(ws: WebSocket): void {
    this.goneSockets.add(ws);
    safeClose(ws, 1011, 'send_failed');
  }

  private sendError(
    ws: WebSocket,
    code: ErrorCode,
    recoverable: boolean,
    requestId?: string,
  ): void {
    this.send(ws, {
      type: 'error',
      code,
      recoverable,
      ...(requestId !== undefined ? { requestId } : {}),
    });
  }

  private sendTo(playerId: string, body: ServerMessageBody): void {
    for (const ws of this.openSockets()) {
      const a = attachmentOf(ws);
      if (a.authenticated && a.playerId === playerId) this.send(ws, body);
    }
  }

  /** 認証済みの全接続へ送る */
  private broadcast(body: ServerMessageBody): void {
    const text = JSON.stringify(serverMessage(body, this.now()));
    for (const ws of this.openSockets()) {
      if (!attachmentOf(ws).authenticated) continue;
      try {
        ws.send(text);
      } catch {
        this.markSendFailed(ws);
      }
    }
  }
}
