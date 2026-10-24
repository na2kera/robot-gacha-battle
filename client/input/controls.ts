/**
 * 対戦・試運転の操作。左半分=移動、右半分=照準の浮動スティック（pointerId で分離）、
 * PC は WASD 移動・マウス照準・左ボタン射撃。
 * 指を離す・pointercancel・画面非表示・縦向きでスティックを解放し、照準角だけ保持する
 */
import Phaser from 'phaser';
import { AIM_DEADZONE } from '../../shared/config';
import type { InputCommand } from '../../shared/input';
import { isPortrait, onOrientationChange } from '../ui/overlay';

/** スティックの最大半径（画面座標 px） */
const STICK_RADIUS = 60;

interface Stick {
  pointerId: number;
  originX: number;
  originY: number;
  /** -1..1 */
  x: number;
  y: number;
}

export type InputSample = Omit<InputCommand, 'seq'>;

export class Controls {
  private move: Stick | null = null;
  private aim: Stick | null = null;
  private aimAngle: number;
  private mouseFiring = false;
  private mouseAim = false;
  private mouseX = 0;
  private mouseY = 0;
  private keys: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key> | null = null;
  private enabled = !isPortrait();
  private gfx: Phaser.GameObjects.Graphics;
  private cleanups: (() => void)[] = [];

  constructor(
    private scene: Phaser.Scene,
    /** マウス照準の基準となる自機の描画位置 */
    private getSelfPos: () => { x: number; y: number },
    initialAim: number,
  ) {
    this.aimAngle = initialAim;
    // スティックは画面座標（Pointer.x/y）で描くため、カメラのスクロールに追従させない
    this.gfx = scene.add.graphics().setDepth(100).setScrollFactor(0);
    const input = scene.input;
    // マウス + タッチ 3 本以上を扱う
    if (input.manager.pointersTotal < 4) input.addPointer(4 - input.manager.pointersTotal);

    const kb = input.keyboard;
    if (kb) {
      this.keys = kb.addKeys('W,A,S,D', false) as Record<
        'W' | 'A' | 'S' | 'D',
        Phaser.Input.Keyboard.Key
      >;
    }

    input.on('pointerdown', this.onDown, this);
    input.on('pointermove', this.onMove, this);
    input.on('pointerup', this.onUp, this);
    input.on('pointerupoutside', this.onUp, this);
    this.cleanups.push(() => {
      input.off('pointerdown', this.onDown, this);
      input.off('pointermove', this.onMove, this);
      input.off('pointerup', this.onUp, this);
      input.off('pointerupoutside', this.onUp, this);
    });

    const canvas = scene.game.canvas;
    // Phaser の Pointer.id と DOM の pointerId は対応しないため、cancel は全タッチを解放する
    const cancel = () => {
      this.move = null;
      this.aim = null;
    };
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('touchcancel', cancel);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') this.releaseAll();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const offOrientation = onOrientationChange((portrait) => {
      this.enabled = !portrait;
      if (portrait) this.releaseAll();
    });
    const onBlur = () => this.releaseAll();
    window.addEventListener('blur', onBlur);
    this.cleanups.push(() => {
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('touchcancel', cancel);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      offOrientation();
    });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  releaseAll(): void {
    this.move = null;
    this.aim = null;
    this.mouseFiring = false;
    this.scene.input.keyboard?.resetKeys();
  }

  /** 現在の入力。無効中は中立（照準角は保持） */
  sample(): InputSample {
    const neutral: InputSample = { moveX: 0, moveY: 0, aimAngle: this.aimAngle, firing: false };
    if (!this.enabled || document.visibilityState === 'hidden') return neutral;

    let moveX = 0;
    let moveY = 0;
    if (this.move) {
      moveX = this.move.x;
      moveY = this.move.y;
    } else if (this.keys) {
      moveX = (this.keys.D.isDown ? 1 : 0) - (this.keys.A.isDown ? 1 : 0);
      moveY = (this.keys.S.isDown ? 1 : 0) - (this.keys.W.isDown ? 1 : 0);
    }
    const len = Math.hypot(moveX, moveY);
    if (len > 1) {
      moveX /= len;
      moveY /= len;
    }

    let firing = false;
    if (this.aim) {
      const aimLen = Math.hypot(this.aim.x, this.aim.y);
      if (aimLen > AIM_DEADZONE) {
        this.aimAngle = Math.atan2(this.aim.y, this.aim.x);
        firing = true;
      }
    } else if (this.mouseAim) {
      // マウスは画面座標で持ち、カメラ（基準の箱を中央に置くためスクロールする）でワールド座標に直す
      const self = this.getSelfPos();
      const world = this.scene.cameras.main.getWorldPoint(this.mouseX, this.mouseY);
      const dx = world.x - self.x;
      const dy = world.y - self.y;
      if (dx !== 0 || dy !== 0) this.aimAngle = Math.atan2(dy, dx);
      firing = this.mouseFiring;
    }
    return { moveX, moveY, aimAngle: this.aimAngle, firing };
  }

  /** スティックの描画。毎フレーム呼ぶ */
  draw(): void {
    const g = this.gfx;
    g.clear();
    for (const s of [this.move, this.aim]) {
      if (!s) continue;
      g.fillStyle(0xffffff, 0.08);
      g.fillCircle(s.originX, s.originY, STICK_RADIUS);
      g.lineStyle(2, 0xffffff, 0.25);
      g.strokeCircle(s.originX, s.originY, STICK_RADIUS);
      g.fillStyle(0xffffff, 0.35);
      g.fillCircle(s.originX + s.x * STICK_RADIUS, s.originY + s.y * STICK_RADIUS, 22);
    }
  }

  private onDown(p: Phaser.Input.Pointer): void {
    if (!p.wasTouch) {
      this.mouseAim = true;
      this.mouseX = p.x;
      this.mouseY = p.y;
      if (p.leftButtonDown()) this.mouseFiring = true;
      return;
    }
    if (!this.enabled) return;
    const stick: Stick = { pointerId: p.id, originX: p.x, originY: p.y, x: 0, y: 0 };
    if (p.x < this.scene.scale.gameSize.width / 2) {
      if (!this.move) this.move = stick;
    } else if (!this.aim) {
      this.aim = stick;
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (!p.wasTouch) {
      this.mouseAim = true;
      this.mouseX = p.x;
      this.mouseY = p.y;
      return;
    }
    for (const s of [this.move, this.aim]) {
      if (!s || s.pointerId !== p.id) continue;
      let dx = (p.x - s.originX) / STICK_RADIUS;
      let dy = (p.y - s.originY) / STICK_RADIUS;
      const len = Math.hypot(dx, dy);
      if (len > 1) {
        dx /= len;
        dy /= len;
      }
      s.x = dx;
      s.y = dy;
    }
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (!p.wasTouch) {
      if (!p.leftButtonDown()) this.mouseFiring = false;
      return;
    }
    if (this.move?.pointerId === p.id) this.move = null;
    if (this.aim?.pointerId === p.id) this.aim = null;
  }

  private destroy(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    this.releaseAll();
  }
}
