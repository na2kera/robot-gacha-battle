import Phaser from 'phaser';
import { ARENA } from '../../shared/arena';
import { TICK_DT } from '../../shared/config';
import { computeStats, PHASE1_LOADOUT, type RobotStats, type WeaponId } from '../../shared/parts';
import {
  createBattleState,
  stepBattle,
  type BattleState,
  type PlayerState,
} from '../../shared/simulation';
import { DEBUG } from '../env';
import { ja } from '../i18n/ja';
import { Controls } from '../input/controls';
import { game } from '../net/game';
import { buildArena, ProjectileLayer } from '../ui/arenaView';
import { drawHpBar, drawRobot, HpLag } from '../ui/draw';
import { flashImage, floatText } from '../ui/fx';
import { HUD_TOP, setupLayout } from '../ui/layout';
import { RobotSprite } from '../ui/RobotSprite';
import { COLORS, TEXT, textStyle } from '../ui/theme';
import { Toast } from '../ui/Toast';
import { SCENE } from './keys';
import { remainingColor } from './util';

const TARGET_ID = '__trial_target__';
/** 的が撃破されてから復活するまで（ミリ秒） */
const TARGET_RESPAWN_MS = 3000;
/** 1 フレームで追いつく最大時間（秒） */
const MAX_FRAME_DT = 0.25;
/** 操作説明のトーストを出す時間（フェード 0.2 秒を含めて約 2 秒） */
const HINT_MS = 1800;
/** 自弾の図形色（画像が無い時） */
const SELF_PROJECTILE = 0x9cc2ff;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 試運転: サーバー非関与。自機と動かない的をローカルの共有シミュレーションで動かす */
export class TrialScene extends Phaser.Scene {
  private meId = '';
  private state!: BattleState;
  private prev!: BattleState;
  private statsById = new Map<string, RobotStats>();
  private targetSetup!: { id: string; stats: RobotStats; spawn: { x: number; y: number } };
  private acc = 0;
  private seq = 0;
  private respawnAt: number | null = null;
  private controls!: Controls;
  private gfx!: Phaser.GameObjects.Graphics;
  private hudGfx!: Phaser.GameObjects.Graphics;
  private robot!: RobotSprite;
  private dummy: Phaser.GameObjects.Image | null = null;
  private bullets!: ProjectileLayer;
  private world!: Phaser.GameObjects.Container;
  private lastTargetHp: number | null = null;
  private weapon: WeaponId | null = null;
  private timer!: Phaser.GameObjects.Text;
  private opponentText!: Phaser.GameObjects.Text;
  private targetHp!: Phaser.GameObjects.Text;
  private targetLag = new HpLag();
  private ready = false;

  constructor() {
    super(SCENE.trial);
  }

  create(): void {
    this.ready = false;
    const loadout = game.myLoadout;
    const meId = game.playerId;
    if (!loadout || !meId) return;
    this.meId = meId;
    const stats = computeStats(loadout);
    // 相手の構成は公開前に分からないため、的はフェーズ1標準構成の判定半径・HP を使う
    const targetStats = computeStats(PHASE1_LOADOUT);
    const myIdx = game.spawnIndexOf(meId);
    const setup = { id: meId, stats, spawn: ARENA.spawns[myIdx] };
    this.targetSetup = {
      id: TARGET_ID,
      stats: targetStats,
      spawn: ARENA.spawns[myIdx === 0 ? 1 : 0],
    };
    this.statsById = new Map([
      [meId, stats],
      [TARGET_ID, targetStats],
    ]);
    this.state = createBattleState([setup, this.targetSetup]);
    this.prev = this.state;
    this.acc = 0;
    this.seq = 0;
    this.respawnAt = null;
    this.targetLag = new HpLag();
    this.lastTargetHp = null;
    this.weapon = loadout.weapon;

    // アリーナ外の余白は床の延長色（床タイルがあればタイルで覆う）
    this.cameras.main.setBackgroundColor(COLORS.floor);
    this.world = this.add.container(0, 0);
    buildArena(this, this.world, DEBUG);
    this.dummy = this.textures.exists('dummy') ? this.add.image(0, 0, 'dummy') : null;
    if (this.dummy) this.world.add(this.dummy);
    this.robot = new RobotSprite(this, 0, 0, 'blue', loadout);
    this.world.add(this.robot);
    const bulletLayer = this.add.container(0, 0);
    this.world.add(bulletLayer);
    this.bullets = new ProjectileLayer(this, bulletLayer);
    this.gfx = this.add.graphics();
    this.world.add(this.gfx);
    this.hudGfx = this.add.graphics();

    const self = this.state.players[0]!;
    this.controls = new Controls(this, () => this.renderPos(this.meId), self.aimAngle);

    // HUD は見えている範囲の端に置き、画面サイズ変更で置き直す
    const title = this.add.text(0, 0, ja.trial.title, textStyle(20, TEXT.main, '700'));
    const hint = this.add.text(0, 0, ja.trial.hint, textStyle(14, TEXT.sub));
    this.timer = this.add.text(0, 0, '', textStyle(24, TEXT.main, '700')).setOrigin(0.5);
    this.opponentText = this.add.text(0, 0, '', textStyle(18, TEXT.opponent)).setOrigin(1, 0.5);
    setupLayout(this, (v) => {
      title.setPosition(v.left + 16, v.top + HUD_TOP);
      hint.setPosition(v.left + 16, v.top + HUD_TOP + 28);
      this.timer.setPosition(v.centerX, v.top + HUD_TOP + 12);
      this.opponentText.setPosition(v.right - 16, v.top + HUD_TOP + 12);
    });
    this.targetHp = this.add.text(0, 0, '', textStyle(14)).setOrigin(0.5, 1);
    this.ready = true;

    // 開始時に操作説明を短く出す
    const touch = this.sys.game.device.input.touch;
    new Toast(this).show(touch ? ja.trial.controlsTouch : ja.trial.controlsPc, 'info', HINT_MS);
  }

  override update(time: number, delta: number): void {
    if (!this.ready) return;
    this.acc += Math.min(delta / 1000, MAX_FRAME_DT);
    while (this.acc >= TICK_DT) {
      this.acc -= TICK_DT;
      const cmd = { seq: ++this.seq, ...this.controls.sample() };
      this.prev = this.state;
      this.state = stepBattle(this.state, new Map([[this.meId, cmd]]), this.statsById, TICK_DT);
    }
    this.handleTarget(time);
    this.render(delta);

    const ms = game.remainingMs(game.publicState?.deadlineAt);
    if (ms !== null) {
      const sec = Math.ceil(ms / 1000);
      this.timer
        .setText(ja.common.remaining(sec))
        .setColor(remainingColor(sec, TEXT.main, TEXT.warn, TEXT.danger));
    }
    this.opponentText.setText(ja.common.opponentConfirmed(game.opponent?.confirmedParts ?? 0));
  }

  private handleTarget(time: number): void {
    const idx = this.state.players.findIndex((p) => p.id === TARGET_ID);
    const target = this.state.players[idx];
    if (!target || target.alive) return;
    if (this.respawnAt === null) this.respawnAt = time + TARGET_RESPAWN_MS;
    if (time < this.respawnAt) return;
    this.respawnAt = null;
    const fresh = createBattleState([this.targetSetup]).players[0]!;
    this.state.players[idx] = fresh;
    this.prev = {
      ...this.prev,
      players: this.prev.players.map((p) => (p.id === TARGET_ID ? fresh : p)),
    };
  }

  private lerpPlayer(id: string): PlayerState | null {
    const cur = this.state.players.find((p) => p.id === id);
    if (!cur) return null;
    const prev = this.prev.players.find((p) => p.id === id) ?? cur;
    const t = this.acc / TICK_DT;
    return { ...cur, x: lerp(prev.x, cur.x, t), y: lerp(prev.y, cur.y, t) };
  }

  private renderPos(id: string): { x: number; y: number } {
    return this.lerpPlayer(id) ?? { x: 0, y: 0 };
  }

  private render(delta: number): void {
    const g = this.gfx;
    g.clear();
    this.hudGfx.clear();
    const target = this.lerpPlayer(TARGET_ID);
    if (target) {
      if (this.dummy) {
        this.dummy.setPosition(target.x, target.y).setAlpha(target.alive ? 1 : 0.3);
        if (DEBUG) {
          g.lineStyle(1, COLORS.debug, 1);
          g.strokeCircle(target.x, target.y, target.radius);
        }
      } else {
        drawRobot(g, target, COLORS.target, DEBUG);
      }
      // 当たった時だけ白く光らせ、減った量を浮かせる
      if (this.lastTargetHp !== null && target.hp < this.lastTargetHp) {
        const dmg = Math.round(this.lastTargetHp - target.hp);
        if (this.dummy) flashImage(this, this.dummy);
        if (dmg > 0) {
          floatText(this, this.world, target.x, target.y - target.radius, String(dmg), TEXT.accent);
        }
      }
      this.lastTargetHp = target.hp;
      drawHpBar(
        this.hudGfx,
        target.x - 30,
        target.y - target.radius - 20,
        60,
        target.hp / target.maxHp,
        COLORS.hpFill,
        this.targetLag.update(target.hp / target.maxHp, delta),
      );
      this.targetHp
        .setPosition(target.x, target.y - target.radius - 22)
        .setText(`${ja.trial.target} ${Math.ceil(target.hp)}/${target.maxHp}`);
    }
    const me = this.lerpPlayer(this.meId);
    if (me) {
      const aim = this.controls.sample().aimAngle;
      this.robot
        .setPosition(me.x, me.y)
        .setAim(aim)
        .setAlpha(me.alive ? 1 : 0.3);
      if (DEBUG) {
        g.lineStyle(1, COLORS.debug, 1);
        g.strokeCircle(me.x, me.y, me.radius);
      }
    }
    const t = this.acc / TICK_DT;
    this.bullets.update(
      this.state.projectiles.map((p) => ({
        id: p.id,
        x: p.x + p.vx * TICK_DT * t,
        y: p.y + p.vy * TICK_DT * t,
        vx: p.vx,
        vy: p.vy,
        radius: p.radius,
        weapon: this.weapon,
        color: SELF_PROJECTILE,
      })),
      g,
      DEBUG,
    );
    this.controls.draw();
  }
}
