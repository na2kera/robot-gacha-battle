/**
 * WebSocket クライアント。接続直後に authenticate を送り、切断時は指数バックオフで自動再接続する。
 * recoverable: false のエラー（replaced / auth_failed / protocol_mismatch）では再接続しない。
 * 1 秒ごとに ping を送り、pong から RTT を計測する
 */
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../../shared/protocol';
import { Emitter } from './emitter';

/** サーバーが回復不能エラーで閉じる close コード */
const FATAL_CLOSE_CODES: Record<number, string> = {
  4002: 'protocol_mismatch',
  4003: 'auth_failed',
  4004: 'replaced',
};

const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 8000;
const PING_INTERVAL_MS = 1000;
const RTT_SAMPLES = 10;
/** 最後の受信からこれを超えたら接続が死んだとみなして張り直す */
const RECEIVE_TIMEOUT_MS = 5000;
/** open 前に閉じた接続がこの回数続くごとに、部屋がまだあるかを HTTP で確認する */
const FAILED_OPENS_PER_CHECK = 3;
/** 部屋の存在確認の待ち時間上限 */
const ROOM_CHECK_TIMEOUT_MS = 5000;
/** 部屋が見つからない（存在確認が 404）時に fatal で通知するコード */
export const ROOM_NOT_FOUND = 'room_not_found';
/** 送信バッファがこれを超えたら詰まりとみなして張り直す */
const MAX_BUFFERED_BYTES = 64 * 1024;

export type SocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'fatal' | 'closed';

export type SocketEvents = {
  message: [msg: ServerMessage, bytes: number];
  status: [status: SocketStatus];
  fatal: [code: string];
};

const encoder = new TextEncoder();

export class GameSocket extends Emitter<SocketEvents> {
  private ws: WebSocket | null = null;
  private roomCode = '';
  private sessionToken = '';
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  private rttSamples: number[] = [];
  status: SocketStatus = 'idle';
  /** serverTime − Date.now() の推定値（ミリ秒） */
  serverOffset = 0;
  private hasPongOffset = false;
  private lastReceivedAt = 0;
  private lastTickAt = 0;
  /** open 前に閉じた接続の連続回数 */
  private failedOpens = 0;
  /** start / stop ごとに増やし、古い非同期処理（存在確認）の結果を捨てる */
  private generation = 0;

  constructor() {
    super();
    document.addEventListener('visibilitychange', () => {
      // 復帰時は待たずに張り直す
      if (
        document.visibilityState === 'visible' &&
        !this.stopped &&
        this.status === 'reconnecting'
      ) {
        this.reconnectNow();
      }
    });
  }

  start(roomCode: string, sessionToken: string): void {
    this.stop();
    this.generation++;
    this.roomCode = roomCode;
    this.sessionToken = sessionToken;
    this.stopped = false;
    this.attempt = 0;
    this.failedOpens = 0;
    this.open();
  }

  /** 再接続しない終了 */
  stop(): void {
    this.stopped = true;
    this.generation++;
    this.clearTimers();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
      try {
        ws.close(1000);
      } catch {
        // 無視
      }
    }
    if (this.status !== 'fatal') this.setStatus('closed');
  }

  /** バックオフを待たず今すぐ張り直す */
  reconnectNow(): void {
    if (this.stopped || this.status === 'fatal') return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.attempt = 0;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
      try {
        ws.close();
      } catch {
        // 無視
      }
    }
    this.open();
  }

  send(msg: ClientMessage): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      // 無制限に積まず張り直す
      ws.close(4000, 'congested');
      return false;
    }
    ws.send(JSON.stringify(msg));
    return true;
  }

  get rtt(): { avg: number; max: number } {
    if (this.rttSamples.length === 0) return { avg: 0, max: 0 };
    const sum = this.rttSamples.reduce((a, b) => a + b, 0);
    return { avg: sum / this.rttSamples.length, max: Math.max(...this.rttSamples) };
  }

  serverNow(): number {
    return Date.now() + this.serverOffset;
  }

  private open(): void {
    this.clearTimers();
    this.setStatus(
      this.attempt === 0 && this.status !== 'reconnecting' ? 'connecting' : 'reconnecting',
    );
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${scheme}//${location.host}/api/rooms/${encodeURIComponent(this.roomCode)}/socket`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.failedOpens = 0;
      this.lastReceivedAt = Date.now();
      this.lastTickAt = Date.now();
      ws.send(
        JSON.stringify({
          type: 'authenticate',
          sessionToken: this.sessionToken,
          protocolVersion: PROTOCOL_VERSION,
        } satisfies ClientMessage),
      );
      this.pingTimer = setInterval(() => {
        const now = Date.now();
        // バックグラウンドでタイマーが間引かれた直後は、受信途絶と区別できないため判定しない
        const throttled = now - this.lastTickAt > PING_INTERVAL_MS * 2;
        this.lastTickAt = now;
        if (!throttled && now - this.lastReceivedAt > RECEIVE_TIMEOUT_MS) {
          // pong も含めて何も届かない: 既存接続を捨てて張り直す
          this.dropAndReconnect(ws);
          return;
        }
        this.send({ type: 'ping', clientTime: Date.now() });
      }, PING_INTERVAL_MS);
    };
    ws.onmessage = (ev) => {
      this.lastReceivedAt = Date.now();
      if (typeof ev.data !== 'string') return;
      this.handleMessage(ev.data);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      const fatal = FATAL_CLOSE_CODES[ev.code];
      if (fatal) {
        this.fail(fatal);
        return;
      }
      if (this.stopped || this.status === 'fatal') return;
      if (!opened && ++this.failedOpens >= FAILED_OPENS_PER_CHECK) {
        // Upgrade が続けて失敗: 部屋が消えたのか回線の問題かを HTTP で確かめる
        this.failedOpens = 0;
        void this.checkRoomThenReconnect();
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose が続くのでそちらで扱う
    };
  }

  private handleMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null || typeof msg.type !== 'string') return;
    const bytes = encoder.encode(raw).length;
    const now = Date.now();

    if (msg.type === 'pong') {
      const rtt = now - msg.clientTime;
      if (rtt >= 0) {
        this.rttSamples.push(rtt);
        if (this.rttSamples.length > RTT_SAMPLES) this.rttSamples.shift();
        this.serverOffset = msg.serverTime + rtt / 2 - now;
        this.hasPongOffset = true;
      }
      return;
    }
    if (!this.hasPongOffset && typeof msg.serverTime === 'number') {
      this.serverOffset = msg.serverTime - now;
    }
    // recoverable: false（replaced / auth_failed / protocol_mismatch など）は再接続しない
    if (msg.type === 'error' && !msg.recoverable) {
      this.fail(msg.code);
      return;
    }
    if (msg.type === 'welcome') {
      this.attempt = 0;
      this.setStatus('open');
    }
    this.emit('message', msg, bytes);
  }

  private fail(code: string): void {
    if (this.status === 'fatal') return;
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
      try {
        ws.close();
      } catch {
        // 無視
      }
    }
    this.setStatus('fatal');
    this.emit('fatal', code);
  }

  /**
   * Upgrade なしの GET で部屋の有無を確認する。404 なら部屋なしとして終了し、
   * それ以外（426・ネットワークエラー・タイムアウト）は再接続を続ける
   */
  private async checkRoomThenReconnect(): Promise<void> {
    const gen = this.generation;
    this.setStatus('reconnecting');
    let notFound = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ROOM_CHECK_TIMEOUT_MS);
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(this.roomCode)}/socket`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        signal: ctrl.signal,
      });
      notFound = res.status === 404;
    } catch {
      // 回線の問題とみなして再接続を続ける
    } finally {
      clearTimeout(timer);
    }
    if (gen !== this.generation || this.stopped || this.status === 'fatal' || this.ws) return;
    if (notFound) {
      this.fail(ROOM_NOT_FOUND);
      return;
    }
    this.scheduleReconnect();
  }

  private dropAndReconnect(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
    try {
      ws.close();
    } catch {
      // 無視
    }
    this.clearTimers();
    if (this.stopped || this.status === 'fatal') return;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.setStatus('reconnecting');
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** this.attempt, BACKOFF_MAX_MS);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setStatus(status: SocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit('status', status);
  }
}
