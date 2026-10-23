/**
 * サーバー側の進行・運用の定数。仕様書 4・9・12 章と docs/flow.md の初期値。
 * 通信・シミュレーションの定数は shared/config.ts を使う。
 */

/** 定員 */
export const ROOM_CAPACITY = 2;
/** 部位ごとの抽選回数上限。上限到達で自動確定 */
export const MAX_DRAWS_PER_PART = 5;
/** WAITING の有効期限（作成から） */
export const WAITING_TTL_MS = 10 * 60 * 1000;
/** DRAFTING の制限時間 */
export const DRAFTING_MS = 120 * 1000;
/** REVEAL の表示時間 */
export const REVEAL_MS = 3 * 1000;
/** RESULT の有効期限 */
export const RESULT_TTL_MS = 5 * 60 * 1000;
/** 全員切断がこの時間続いたら CLOSED */
export const EMPTY_CLOSE_MS = 5 * 60 * 1000;
/** 切断からの復帰猶予。フェーズ期限後の未接続待ちにも使う */
export const RECONNECT_GRACE_MS = 10 * 1000;
/** 接続から authenticate までの制限時間 */
export const AUTH_TIMEOUT_MS = 5 * 1000;
/** ルームあたりの未認証接続の上限 */
export const MAX_UNAUTHENTICATED_SOCKETS = 4;
/** 1 接続あたりの毎秒の受信上限 */
export const INPUT_MESSAGES_PER_SEC = 60;
export const OTHER_MESSAGES_PER_SEC = 10;
/** requestId → draftResult を部位ごとに保持する件数 */
export const REQUEST_LOG_PER_PART = 20;
/** ルーム作成時のコード衝突の再試行回数 */
export const ROOM_CREATE_ATTEMPTS = 5;
/** HTTP body の上限（文字数） */
export const MAX_HTTP_BODY_CHARS = 1024;
/** WebSocket の close コード */
export const CLOSE_AUTH_TIMEOUT = 4001;
export const CLOSE_PROTOCOL_MISMATCH = 4002;
export const CLOSE_AUTH_FAILED = 4003;
export const CLOSE_REPLACED = 4004;
export const CLOSE_NORMAL = 1000;
