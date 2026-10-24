/**
 * 画面遷移。GameClient の状態（phase・ガチャ完了・reveal・result・接続状態）から
 * 表示すべき画面を決め、変わった時だけ切り替える。画面側は遷移を判断しない。
 * 試運転・対戦は Phaser の scene、それ以外は DOM 画面（client/ui/dom）
 */
import type Phaser from 'phaser';
import { ja } from '../i18n/ja';
import { game } from '../net/game';
import { DraftView } from '../ui/dom/draft';
import { HomeView } from '../ui/dom/home';
import { ResultView } from '../ui/dom/result';
import { RevealView } from '../ui/dom/reveal';
import { RoomView } from '../ui/dom/room';
import { StatusView, type StatusData } from '../ui/dom/status';
import { setView, updateView, type View } from '../ui/dom/view';
import { setBanner } from '../ui/overlay';
import { SCENE, type SceneKey } from './keys';

/** 公開画面の最短表示時間 */
const REVEAL_HOLD_MS = 3000;

/** 表示する画面。DOM 画面と Phaser の scene（trial / battle） */
type ScreenKey = 'home' | 'status' | 'room' | 'draft' | 'reveal' | 'result' | 'trial' | 'battle';

function createView(
  key: ScreenKey,
  data: StatusData | undefined,
  dismiss: () => void,
): View | null {
  switch (key) {
    case 'home':
      return new HomeView();
    case 'status':
      return new StatusView(data ?? { message: ja.common.connecting, connecting: true }, dismiss);
    case 'room':
      return new RoomView();
    case 'draft':
      return new DraftView();
    case 'reveal':
      return new RevealView();
    case 'result':
      return new ResultView();
    case 'trial':
    case 'battle':
      return null;
  }
}

class Router {
  private phaser: Phaser.Game | null = null;
  private current: ScreenKey | null = null;
  /** 動いている Phaser の scene */
  private scene: SceneKey | null = null;
  private fatalCode: string | null = null;
  private revealUntil = 0;
  private lastData = '';

  start(phaser: Phaser.Game): void {
    this.phaser = phaser;
    this.scene = SCENE.boot;
    const refresh = () => {
      this.sync();
      updateView();
    };
    game.on('change', refresh);
    game.on('ended', refresh);
    game.on('result', refresh);
    game.on('draft', () => updateView());
    game.on('reveal', () => {
      this.revealUntil = Date.now() + REVEAL_HOLD_MS;
      refresh();
      setTimeout(() => this.sync(), REVEAL_HOLD_MS + 20);
    });
    game.on('fatal', (code) => {
      this.fatalCode = code;
      refresh();
    });
    game.on('status', (s) => {
      if (s === 'reconnecting' && game.publicState) setBanner(ja.common.reconnecting, true);
      else setBanner(null);
      refresh();
    });
    this.sync();
  }

  /** 回復不能エラーを閉じてホームへ */
  dismissFatal(): void {
    this.fatalCode = null;
    game.abandon();
  }

  private desired(): { key: ScreenKey; data?: StatusData } {
    if (this.fatalCode) {
      return {
        key: 'status',
        data: { message: ja.fatal[this.fatalCode] ?? ja.fatal.unknown!, connecting: false },
      };
    }
    if (!game.session) return { key: 'home' };
    const phase = game.phase;
    if (!phase) return { key: 'status', data: { message: ja.common.connecting, connecting: true } };
    switch (phase) {
      case 'WAITING':
        return { key: 'room' };
      case 'DRAFTING':
        if (game.loadouts) return { key: 'reveal' };
        return { key: game.draftComplete ? 'trial' : 'draft' };
      case 'REVEAL':
        return { key: 'reveal' };
      case 'COUNTDOWN':
      case 'BATTLE':
        if (this.current === 'reveal' && Date.now() < this.revealUntil) return { key: 'reveal' };
        return { key: 'battle' };
      case 'RESULT':
      case 'ABORTED':
        return { key: 'result' };
      case 'CLOSED':
        if (game.result) return { key: 'result' };
        return { key: 'status', data: { message: ja.fatal.closed!, connecting: false } };
    }
  }

  sync(): void {
    if (!this.phaser) return;
    const { key, data } = this.desired();
    // 同じ画面でも渡すデータ（status の文言）が変われば作り直す
    const json = JSON.stringify(data ?? null);
    if (key === this.current && json === this.lastData) return;
    this.lastData = json;
    this.current = key;
    const view = createView(key, data, () => this.dismissFatal());
    if (view) {
      this.startScene(SCENE.idle);
      setView(view);
    } else {
      setView(null);
      this.startScene(key === 'trial' ? SCENE.trial : SCENE.battle);
    }
  }

  private startScene(key: SceneKey): void {
    if (!this.phaser || this.scene === key) return;
    if (this.scene) this.phaser.scene.stop(this.scene);
    this.scene = key;
    this.phaser.scene.start(key);
  }
}

export const router = new Router();
