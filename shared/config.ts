/**
 * 通信・シミュレーションの定数。仕様書 10・11 章の初期値。
 * ゲームバランスの数値（HP・速度・ダメージ等）は parts.ts に置く。
 */

/** サーバー simulation の更新頻度（Hz） */
export const TICK_RATE = 30;
/** 固定 step の dt（秒） */
export const TICK_DT = 1 / TICK_RATE;
/** snapshot 送信頻度（Hz） */
export const SNAPSHOT_RATE = 15;
/** クライアント input 送信の最大頻度（Hz） */
export const INPUT_RATE_MAX = 30;
/** この時間 input が届かなければ移動・攻撃を中立にする（ミリ秒） */
export const INPUT_TIMEOUT_MS = 300;
/** 試合時間（秒） */
export const BATTLE_DURATION_SEC = 90;
/** 試合開始前のカウントダウン（秒） */
export const COUNTDOWN_SEC = 3;
/** 照準スティックのデッドゾーン。超えている間は自動射撃 */
export const AIM_DEADZONE = 0.2;
/** 1 コールで追いつき処理する最大 step 数 */
export const MAX_STEPS_PER_CALL = 5;
/** これを超える異常停止は無効試合（ミリ秒） */
export const STALL_ABORT_MS = 2000;

/** 1 step に受け付ける dt の上限（秒）。異常な dt で巨大移動させない */
export const MAX_STEP_DT = TICK_DT * 3;
/**
 * ロボット移動のサブステップ 1 回あたりの最大移動量（ワールド単位）。
 * 最も薄い障害物（30）の半分より十分小さく保ち、壁の飛び越えを防ぐ
 */
export const MOVE_SUBSTEP_MAX_DISTANCE = 8;
/** 発射位置を本体外周＋弾半径からさらに離す距離（ワールド単位） */
export const MUZZLE_GAP = 1;
/** 浮動小数点の比較許容値 */
export const SIM_EPSILON = 1e-6;
/** 時間切れ判定で HP 比率を同率とみなす許容値。小数ダメージの累積誤差で勝敗を決めない */
export const HP_RATIO_EPSILON = 1e-9;
