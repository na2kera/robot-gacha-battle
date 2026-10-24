/** Phaser の scene キー。ホーム・ルーム・ガチャ・公開・結果・接続中は DOM 画面（client/ui/dom） */
export const SCENE = {
  boot: 'boot',
  /** DOM 画面の表示中に動かす空の scene */
  idle: 'idle',
  trial: 'trial',
  battle: 'battle',
} as const;

export type SceneKey = (typeof SCENE)[keyof typeof SCENE];
