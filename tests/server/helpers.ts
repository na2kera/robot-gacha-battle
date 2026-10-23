import { SELF, env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import type { GameRoom } from '../../server/game-room';
import type { PartType } from '../../shared/parts';
import {
  PART_TYPES,
  PROTOCOL_VERSION,
  type CreateRoomResponse,
  type DraftResultMessage,
  type ServerMessage,
} from '../../shared/protocol';

export const ORIGIN = 'https://example.com';

let ipCounter = 0;
/** Rate limit を避けるため呼び出しごとに別の IP にする */
export function nextIp(): string {
  ipCounter++;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export function post(path: string, body: unknown, ip = nextIp()): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export async function createRoom(name = 'あ'): Promise<CreateRoomResponse> {
  const res = await post('/api/rooms', { name });
  if (res.status !== 201) throw new Error(`create failed ${res.status}`);
  return (await res.json()) as CreateRoomResponse;
}

export async function joinRoom(code: string, name = 'い'): Promise<CreateRoomResponse> {
  const res = await post(`/api/rooms/${code}/join`, { name });
  if (res.status !== 200) throw new Error(`join failed ${res.status}`);
  return (await res.json()) as CreateRoomResponse;
}

export function roomStub(code: string): DurableObjectStub<GameRoom> {
  return env.GAME_ROOM.get(env.GAME_ROOM.idFromName(code));
}

/** 期限判定の時計だけを進める（alarm は実行しない） */
export async function advanceClock(code: string, ms: number): Promise<void> {
  await runInDurableObject(roomStub(code), (instance: GameRoom) => {
    instance.clockOffsetMs += ms;
  });
}

/** 期限判定の時計を進めて alarm を実行する（実時間で待たない） */
export async function advanceAndFireAlarm(code: string, ms: number): Promise<boolean> {
  const stub = roomStub(code);
  await runInDurableObject(stub, (instance: GameRoom) => {
    instance.clockOffsetMs += ms;
  });
  return runDurableObjectAlarm(stub);
}

type MessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class TestClient {
  readonly messages: ServerMessage[] = [];
  readonly raw: string[] = [];
  closeEvent: { code: number; reason: string } | null = null;
  private cursor = 0;

  constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const text = e.data as string;
      this.raw.push(text);
      this.messages.push(JSON.parse(text) as ServerMessage);
    });
    ws.addEventListener('close', (e) => {
      this.closeEvent = { code: e.code, reason: e.reason };
    });
  }

  static async open(code: string, origin: string | null = ORIGIN): Promise<TestClient> {
    const res = await openSocket(code, origin);
    if (res.status !== 101 || !res.webSocket) throw new Error(`upgrade failed ${res.status}`);
    res.webSocket.accept();
    return new TestClient(res.webSocket);
  }

  /** 接続して認証し、welcome を待つ */
  static async connect(code: string, sessionToken: string): Promise<TestClient> {
    const client = await TestClient.open(code);
    client.send({ type: 'authenticate', sessionToken, protocolVersion: PROTOCOL_VERSION });
    await client.waitFor('welcome');
    return client;
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  /** cursor 以降で条件に合う最初のメッセージを待ち、その次まで cursor を進める */
  async waitFor<T extends ServerMessage['type']>(
    type: T,
    predicate: (m: MessageOf<T>) => boolean = () => true,
    timeoutMs = 3000,
  ): Promise<MessageOf<T>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (let i = this.cursor; i < this.messages.length; i++) {
        const m = this.messages[i]!;
        if (m.type === type && predicate(m as MessageOf<T>)) {
          this.cursor = i + 1;
          return m as MessageOf<T>;
        }
      }
      if (Date.now() > deadline) {
        throw new Error(`timeout waiting for ${type}; got ${this.messages.map((m) => m.type)}`);
      }
      await sleep(5);
    }
  }

  async waitForClose(timeoutMs = 3000): Promise<{ code: number; reason: string }> {
    const deadline = Date.now() + timeoutMs;
    while (!this.closeEvent) {
      if (Date.now() > deadline) throw new Error('timeout waiting for close');
      await sleep(5);
    }
    return this.closeEvent;
  }

  close(): void {
    this.ws.close(1000, 'bye');
  }
}

export function openSocket(code: string, origin: string | null = ORIGIN): Promise<Response> {
  const headers: Record<string, string> = { Upgrade: 'websocket' };
  if (origin !== null) headers.Origin = origin;
  return SELF.fetch(`${ORIGIN}/api/rooms/${code}/socket`, { headers });
}

export interface TwoPlayers {
  code: string;
  a: TestClient;
  b: TestClient;
  aId: string;
  bId: string;
  aToken: string;
  bToken: string;
}

export async function setupTwoPlayers(): Promise<TwoPlayers> {
  const created = await createRoom('あ');
  const joined = await joinRoom(created.roomCode, 'い');
  const a = await TestClient.connect(created.roomCode, created.sessionToken);
  const b = await TestClient.connect(created.roomCode, joined.sessionToken);
  return {
    code: created.roomCode,
    a,
    b,
    aId: created.playerId,
    bId: joined.playerId,
    aToken: created.sessionToken,
    bToken: joined.sessionToken,
  };
}

export async function toDrafting(p: TwoPlayers): Promise<void> {
  p.a.send({ type: 'ready', matchId: 1, value: true });
  p.b.send({ type: 'ready', matchId: 1, value: true });
  await p.a.waitFor('roomState', (m) => m.phase === 'DRAFTING');
  await p.b.waitFor('roomState', (m) => m.phase === 'DRAFTING');
}

let requestCounter = 0;
export function nextRequestId(): string {
  return `req-${++requestCounter}`;
}

/** 全部位を 1 回抽選して確定する。最後の確定の requestId と結果を返す */
export async function completeDraft(
  client: TestClient,
  matchId = 1,
): Promise<{ requestId: string; result: DraftResultMessage }> {
  let last: { requestId: string; result: DraftResultMessage } | null = null;
  for (const partType of PART_TYPES as readonly PartType[]) {
    const drawId = nextRequestId();
    client.send({ type: 'draftDraw', matchId, partType, requestId: drawId, candidateVersion: 0 });
    const drawn = await client.waitFor('draftResult', (m) => m.requestId === drawId);
    const confirmId = nextRequestId();
    client.send({
      type: 'draftConfirm',
      matchId,
      partType,
      requestId: confirmId,
      candidateVersion: drawn.candidateVersion,
    });
    const result = await client.waitFor('draftResult', (m) => m.requestId === confirmId);
    last = { requestId: confirmId, result };
  }
  return last!;
}

/** DRAFTING → REVEAL → COUNTDOWN → BATTLE まで進める */
export async function toBattle(p: TwoPlayers): Promise<void> {
  await toDrafting(p);
  await completeDraft(p.a);
  await completeDraft(p.b);
  await p.a.waitFor('reveal');
  await p.a.waitFor('roomState', (m) => m.phase === 'REVEAL');
  await advanceAndFireAlarm(p.code, 3001);
  await p.a.waitFor('roomState', (m) => m.phase === 'COUNTDOWN');
  await advanceAndFireAlarm(p.code, 3001);
  await p.a.waitFor('roomState', (m) => m.phase === 'BATTLE');
  await p.b.waitFor('roomState', (m) => m.phase === 'BATTLE');
}
