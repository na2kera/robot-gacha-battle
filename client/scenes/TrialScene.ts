import Phaser from 'phaser';
import { ARENA } from '../../shared/arena';
import { TICK_DT } from '../../shared/config';
import { computeStats, PHASE1_LOADOUT, type RobotStats } from '../../shared/parts';
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
import { drawArena, drawArenaDebug, drawHpBar, drawProjectile, drawRobot } from '../ui/draw';
import { COLORS, TEXT, textStyle } from '../ui/theme';
import { SCENE } from './keys';
import { remainingColor } from './util';

const TARGET_ID = '__trial_target__';
/** 的が撃破されてから復活するまで（ミリ秒） */
const TARGET_RESPAWN_MS = 3000;
/** 1 フレームで追いつく最大時間（秒） */
const MAX_FRAME_DT = 0.25;

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
  private timer!: Phaser.GameObjects.Text;
  private opponentText!: Phaser.GameObjects.Text;
  private targetHp!: Phaser.GameObjects.Text;
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

    const bg = this.add.graphics();
    drawArena(bg);
    if (DEBUG) drawArenaDebug(bg);
    this.gfx = this.add.graphics();

    const self = this.state.players[0]!;
    this.controls = new Controls(this, () => this.renderPos(this.meId), self.aimAngle);

    const w = this.scale.width;
    this.add.text(16, 12, ja.trial.title, textStyle(20));
    this.add.text(16, 40, ja.trial.hint, textStyle(14, TEXT.sub));
    this.timer = this.add.text(w / 2, 24, '', textStyle(24)).setOrigin(0.5);
    this.opponentText = this.add
      .text(w - 16, 24, '', textStyle(18, TEXT.opponent))
      .setOrigin(1, 0.5);
    this.targetHp = this.add.text(0, 0, '', textStyle(14)).setOrigin(0.5, 1);
    this.ready = true;
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
    this.render();

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

  private render(): void {
    const g = this.gfx;
    g.clear();
    const target = this.lerpPlayer(TARGET_ID);
    if (target) {
      drawRobot(g, target, COLORS.target, DEBUG);
      drawHpBar(
        g,
        target.x - 30,
        target.y - target.radius - 20,
        60,
        target.hp / target.maxHp,
        COLORS.hpFill,
      );
      this.targetHp
        .setPosition(target.x, target.y - target.radius - 22)
        .setText(`${ja.trial.target} ${Math.ceil(target.hp)}/${target.maxHp}`);
    }
    const me = this.lerpPlayer(this.meId);
    if (me) {
      const aim = this.controls.sample().aimAngle;
      drawRobot(g, { ...me, aimAngle: aim }, COLORS.me, DEBUG);
    }
    const t = this.acc / TICK_DT;
    for (const p of this.state.projectiles) {
      drawProjectile(
        g,
        { x: p.x + p.vx * TICK_DT * t, y: p.y + p.vy * TICK_DT * t, radius: p.radius },
        0x9cc2ff,
        DEBUG,
      );
    }
    this.controls.draw();
  }
}
