/** HTTP API の fetch ラッパ。same-origin。失敗時は body の error を持つ ApiError を投げる */
import type {
  CreateRoomRequest,
  CreateRoomResponse,
  JoinRoomRequest,
  JoinRoomResponse,
} from '../../shared/protocol';

export class ApiError extends Error {
  constructor(
    /** サーバーの error コード。通信失敗は 'network'、不明は 'unknown' */
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('network', 0);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const code =
      typeof data === 'object' &&
      data !== null &&
      typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : 'unknown';
    throw new ApiError(code, res.status);
  }
  return data as T;
}

export function createRoom(req: CreateRoomRequest): Promise<CreateRoomResponse> {
  return post('/api/rooms', req);
}

export function joinRoom(code: string, req: JoinRoomRequest): Promise<JoinRoomResponse> {
  return post(`/api/rooms/${encodeURIComponent(code)}/join`, req);
}
