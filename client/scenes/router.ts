/**
 * scene 遷移。GameClient の状態（phase・ガチャ完了・reveal・result・接続状態）から
 * 表示すべき scene を決め、変わった時だけ切り替える。scene 側は遷移を判断しない
 */
import type Phaser from 'phaser';
import { ja } from '../i18n/ja';
import { game } from '../net/game';
import { setBanner } from '../ui/overlay';
import { SCENE, type SceneKey } from './keys';

/** 公開画面の最短表示時間 */
const REVEAL_HOLD_MS = 3000;

export interface StatusData {
  message: string;
  /** 接続待ち（true）か回復不能エラー（false）か */
  connecting: boolean;
}

class Router {
  private phaser: Phaser.Game | null = null;
  private current: SceneKey | null = null;
  private fatalCode: string | null = null;
  private revealUntil = 0;
  private lastData = '';

  start(phaser: Phaser.Game): void {
    this.phaser = phaser;
    this.current = SCENE.boot;
    game.on('change', () => this.sync());
    game.on('ended', () => this.sync());
    game.on('result', () => this.sync());
    game.on('reveal', () => {
      this.revealUntil = Date.now() + REVEAL_HOLD_MS;
      this.sync();
      setTimeout(() => this.sync(), REVEAL_HOLD_MS + 20);
    });
    game.on('fatal', (code) => {
      this.fatalCode = code;
      this.sync();
    });
    game.on('status', (s) => {
      if (s === 'reconnecting' && game.publicState) setBanner(ja.common.reconnecting, true);
      else setBanner(null);
      this.sync();
    });
    this.sync();
  }

  /** 回復不能エラーを閉じてホームへ */
  dismissFatal(): void {
    this.fatalCode = null;
    game.abandon();
  }

  private desired(): { key: SceneKey; data?: object } {
    if (this.fatalCode) {
      const data: StatusData = {
        message: ja.fatal[this.fatalCode] ?? ja.fatal.unknown!,
        connecting: false,
      };
      return { key: SCENE.status, data };
    }
    if (!game.session) return { key: SCENE.home };
    const phase = game.phase;
    if (!phase) {
      const data: StatusData = { message: ja.common.connecting, connecting: true };
      return { key: SCENE.status, data };
    }
    switch (phase) {
      case 'WAITING':
        return { key: SCENE.room };
      case 'DRAFTING':
        if (game.loadouts) return { key: SCENE.reveal };
        return { key: game.draftComplete ? SCENE.trial : SCENE.draft };
      case 'REVEAL':
        return { key: SCENE.reveal };
      case 'COUNTDOWN':
      case 'BATTLE':
        if (this.current === SCENE.reveal && Date.now() < this.revealUntil) {
          return { key: SCENE.reveal };
        }
        return { key: SCENE.battle };
      case 'RESULT':
      case 'ABORTED':
        return { key: SCENE.result };
      case 'CLOSED': {
        if (game.result) return { key: SCENE.result };
        const data: StatusData = { message: ja.fatal.closed!, connecting: false };
        return { key: SCENE.status, data };
      }
    }
  }

  sync(): void {
    if (!this.phaser) return;
    const { key, data } = this.desired();
    // 同じ scene でも渡すデータ（status の文言）が変われば作り直す
    const json = JSON.stringify(data ?? null);
    if (key === this.current && json === this.lastData) return;
    this.lastData = json;
    if (this.current) this.phaser.scene.stop(this.current);
    this.current = key;
    this.phaser.scene.start(key, data);
  }
}

export const router = new Router();
