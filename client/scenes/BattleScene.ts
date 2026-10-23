import Phaser from 'phaser';
import { ARENA } from '../../shared/arena';
import { BATTLE_DURATION_SEC, INPUT_RATE_MAX, TICK_DT } from '../../shared/config';
import type { InputCommand } from '../../shared/input';
import { computeStats, type RobotStats } from '../../shared/parts';
import type { SnapshotMessage } from '../../shared/protocol';
import { createBattleState, stepPlayer, type PlayerState } from '../../shared/simulation';
import { DEBUG } from '../env';
import { ja } from '../i18n/ja';
import { Controls } from '../input/controls';
import { game } from '../net/game';
import { drawArena, drawArenaDebug, drawHpBar, drawProjectile, drawRobot } from '../ui/draw';
import { COLORS, TEXT, textStyle } from '../ui/theme';
import { SCENE } from './keys';
import { autoOff } from './util';

/** 相手の補間遅延（ミリ秒） */
const INTERP_DELAY_MS = 100;
/** 補間バッファに残す時間（ミリ秒） */
const BUFFER_KEEP_MS = 1000;
/** 送信間隔（秒） */
const SEND_INTERVAL = 1 / INPUT_RATE_MAX;
/** 1 フレームで送る input の上限。停止明けにまとめて送らない */
const MAX_SENDS_PER_FRAME = 3;
/** 未確認入力の履歴上限 */
const MAX_HISTORY = 120;
/** これ未満の補正は即座に反映する（ワールド単位） */
const SNAP_CORRECTION = 3;
/** これを超える補正は滑らかにせず瞬間移動する */
const TELEPORT_CORRECTION = 200;
/** 描画オフセットの減衰速度（1/秒）。約 0.1 秒で 7 割戻る */
const OFFSET_DECAY = 12;
/** 弾の描画を先へ進める上限（秒） */
const MAX_PROJECTILE_EXTRAPOLATION = 0.1;

const SELF_PROJECTILE = 0x9cc2ff;
const OPPONENT_PROJECTILE = 0xffa0a0;

interface Buffered {
  t: number;
  players: PlayerState[];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

/** 対戦: 自機は予測と補正、相手は 100ms 遅延の補間、弾と HP はサーバー値 */
export class BattleScene extends Phaser.Scene {
  private meId = '';
  private oppId = '';
  private statsMe: RobotStats | null = null;
  private controls!: Controls;
  private gfx!: Phaser.GameObjects.Graphics;

  // 自機予測
  private predicted: PlayerState | null = null;
  private prevPredicted: PlayerState | null = null;
  private history: InputCommand[] = [];
  private sendAcc = 0;
  private offsetX = 0;
  private offsetY = 0;
  private correction = 0;

  // サーバー状態
  private latest: SnapshotMessage | null = null;
  private latestAt = 0;
  private latestBytes = 0;
  private buffer: Buffered[] = [];
  /** serverTime − performance.now() の推定（遅延の少ない到着に合わせる） */
  private clockEst: number | null = null;
  /** snapshot 前の表示用 */
  private initialPlayers: PlayerState[] = [];

  // HUD
  private myName!: Phaser.GameObjects.Text;
  private oppName!: Phaser.GameObjects.Text;
  private timer!: Phaser.GameObjects.Text;
  private center!: Phaser.GameObjects.Text;
  private debugText: Phaser.GameObjects.Text | null = null;

  constructor() {
    super(SCENE.battle);
  }

  create(): void {
    this.meId = game.playerId ?? '';
    this.oppId = game.opponent?.playerId ?? '';
    const myLoadout = game.loadouts?.[this.meId] ?? null;
    this.statsMe = myLoadout ? computeStats(myLoadout) : null;
    this.predicted = null;
    this.prevPredicted = null;
    this.history = [];
    this.sendAcc = 0;
    this.offsetX = this.offsetY = 0;
    this.correction = 0;
    this.latest = null;
    this.buffer = [];
    this.clockEst = null;

    // snapshot が来るまではスポーン位置に描く
    const setups = (game.publicState?.players ?? []).flatMap((p, i) => {
      const l = game.loadouts?.[p.playerId];
      return l
        ? [{ id: p.playerId, stats: computeStats(l), spawn: ARENA.spawns[i === 1 ? 1 : 0] }]
        : [];
    });
    this.initialPlayers = createBattleState(setups).players;

    const bg = this.add.graphics();
    drawArena(bg);
    if (DEBUG) drawArenaDebug(bg);
    this.gfx = this.add.graphics();

    const initialSelf = this.initialPlayers.find((p) => p.id === this.meId);
    this.controls = new Controls(this, () => this.selfRenderPos(), initialSelf?.aimAngle ?? 0);

    const w = this.scale.width;
    this.myName = this.add.text(24, 10, game.nameOf(this.meId), textStyle(18, TEXT.me));
    this.oppName = this.add
      .text(w - 24, 10, game.nameOf(this.oppId), textStyle(18, TEXT.opponent))
      .setOrigin(1, 0);
    this.timer = this.add.text(w / 2, 26, '', textStyle(26)).setOrigin(0.5);
    this.center = this.add
      .text(w / 2, this.scale.height / 2, '', { ...textStyle(96), fontStyle: 'bold' })
      .setOrigin(0.5)
      .setDepth(60);
    if (DEBUG) {
      this.debugText = this.add
        .text(w - 16, 64, '', {
          ...textStyle(14, '#ffe066'),
          align: 'right',
          backgroundColor: '#000000aa',
        })
        .setOrigin(1, 0)
        .setDepth(70);
    }

    autoOff(
      this,
      game.on('snapshot', (msg, bytes) => this.onSnapshot(msg, bytes)),
      // 再接続では welcome の後に reveal が届くため、ここで構成を受け取る
      game.on('reveal', (msg) => {
        const l = msg.loadouts[this.meId];
        if (l && !this.statsMe) this.statsMe = computeStats(l);
      }),
      game.on('change', () => {
        this.myName.setText(game.nameOf(this.meId));
        this.oppName.setText(game.nameOf(this.oppId));
      }),
    );
  }

  private onSnapshot(msg: SnapshotMessage, bytes: number): void {
    // 順序付き通信だが、念のため古い tick は捨てる
    if (this.latest && msg.tick < this.latest.tick) return;
    const now = performance.now();
    this.latest = msg;
    this.latestAt = now;
    this.latestBytes = bytes;

    const sample = msg.serverTime - now;
    if (this.clockEst === null || sample > this.clockEst) this.clockEst = sample;
    else this.clockEst += (sample - this.clockEst) * 0.02;
    this.buffer.push({ t: msg.serverTime, players: msg.players });
    const renderT = now + this.clockEst - INTERP_DELAY_MS;
    while (this.buffer.length > 2 && this.buffer[1]!.t < renderT - BUFFER_KEEP_MS)
      this.buffer.shift();

    this.reconcile(msg);
  }

  /** lastProcessedInputSeq の位置（snapshot の自機）へ戻し、未確認の入力を再適用する */
  private reconcile(msg: SnapshotMessage): void {
    const server = msg.players.find((p) => p.id === this.meId);
    if (!server || !this.statsMe) {
      this.predicted = this.prevPredicted = null;
      return;
    }
    const last = msg.lastProcessedInputSeq[this.meId] ?? -1;
    this.history = this.history.filter((c) => c.seq > last);
    let p: PlayerState = server;
    for (const cmd of this.history) p = stepPlayer(p, cmd, this.statsMe, TICK_DT);

    if (!this.predicted || !this.prevPredicted) {
      this.predicted = p;
      this.prevPredicted = p;
      this.correction = 0;
      return;
    }
    const dx = p.x - this.predicted.x;
    const dy = p.y - this.predicted.y;
    const dist = Math.hypot(dx, dy);
    this.correction = dist;
    if (dist >= TELEPORT_CORRECTION) {
      this.offsetX = this.offsetY = 0;
      this.prevPredicted = p;
    } else {
      if (dist >= SNAP_CORRECTION) {
        // 見た目の位置を保ったまま、オフセットを時間で 0 へ戻す
        this.offsetX -= dx;
        this.offsetY -= dy;
      }
      this.prevPredicted = {
        ...this.prevPredicted,
        x: this.prevPredicted.x + dx,
        y: this.prevPredicted.y + dy,
      };
    }
    this.predicted = p;
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.25);
    const phase = game.phase;
    const sample = this.controls.sample();

    if (phase === 'BATTLE' && this.latest) {
      this.sendAcc += dt;
      let sent = 0;
      while (this.sendAcc >= SEND_INTERVAL && sent < MAX_SENDS_PER_FRAME) {
        this.sendAcc -= SEND_INTERVAL;
        sent++;
        const cmd: InputCommand = { seq: game.nextInputSeq(), ...sample };
        game.sendInput(cmd);
        if (this.predicted && this.statsMe) {
          this.history.push(cmd);
          if (this.history.length > MAX_HISTORY) this.history.shift();
          this.prevPredicted = this.predicted;
          this.predicted = stepPlayer(this.predicted, cmd, this.statsMe, TICK_DT);
        }
      }
      if (this.sendAcc >= SEND_INTERVAL) this.sendAcc = 0;
    }

    const decay = Math.exp(-OFFSET_DECAY * dt);
    this.offsetX *= decay;
    this.offsetY *= decay;
    if (Math.hypot(this.offsetX, this.offsetY) < 0.1) this.offsetX = this.offsetY = 0;

    this.render(sample.aimAngle);
    this.updateHud(phase);
    this.controls.draw();
  }

  private serverPlayers(): PlayerState[] {
    return this.latest?.players ?? this.initialPlayers;
  }

  private selfRenderPos(): { x: number; y: number } {
    const self = this.selfPose(0);
    return self ?? { x: 0, y: 0 };
  }

  private selfPose(aimAngle: number | null): PlayerState | null {
    const server = this.serverPlayers().find((p) => p.id === this.meId);
    if (!server) return null;
    if (!this.predicted || !this.prevPredicted) {
      return aimAngle === null ? server : { ...server, aimAngle };
    }
    const t = Math.min(Math.max(this.sendAcc / SEND_INTERVAL, 0), 1);
    return {
      ...server,
      x: lerp(this.prevPredicted.x, this.predicted.x, t) + this.offsetX,
      y: lerp(this.prevPredicted.y, this.predicted.y, t) + this.offsetY,
      moveDirAngle: this.predicted.moveDirAngle,
      aimAngle: aimAngle ?? this.predicted.aimAngle,
    };
  }

  /** 相手を約 100ms 遅らせて snapshot 間で補間する */
  private opponentPose(): PlayerState | null {
    if (this.buffer.length === 0 || this.clockEst === null) {
      return this.serverPlayers().find((p) => p.id === this.oppId) ?? null;
    }
    const renderT = performance.now() + this.clockEst - INTERP_DELAY_MS;
    const find = (b: Buffered) => b.players.find((p) => p.id === this.oppId) ?? null;
    let i = this.buffer.length - 1;
    while (i > 0 && this.buffer[i]!.t > renderT) i--;
    const a = this.buffer[i]!;
    const b = this.buffer[i + 1];
    const pa = find(a);
    if (!b || !pa) return pa;
    const pb = find(b);
    if (!pb) return pa;
    const span = b.t - a.t;
    const t = span > 0 ? Math.min(Math.max((renderT - a.t) / span, 0), 1) : 1;
    // HP・生死は最新のサーバー値
    const current = this.latest?.players.find((p) => p.id === this.oppId) ?? pb;
    return {
      ...current,
      x: lerp(pa.x, pb.x, t),
      y: lerp(pa.y, pb.y, t),
      aimAngle: lerpAngle(pa.aimAngle, pb.aimAngle, t),
      moveDirAngle: lerpAngle(pa.moveDirAngle, pb.moveDirAngle, t),
    };
  }

  private render(aimAngle: number): void {
    const g = this.gfx;
    g.clear();
    const opp = this.opponentPose();
    if (opp) drawRobot(g, opp, COLORS.opponent, DEBUG);
    const self = this.selfPose(aimAngle);
    if (self) drawRobot(g, self, COLORS.me, DEBUG);

    if (this.latest) {
      const age = Math.min(
        (performance.now() - this.latestAt) / 1000,
        MAX_PROJECTILE_EXTRAPOLATION,
      );
      for (const p of this.latest.projectiles) {
        drawProjectile(
          g,
          { x: p.x + p.vx * age, y: p.y + p.vy * age, radius: p.radius },
          p.ownerId === this.meId ? SELF_PROJECTILE : OPPONENT_PROJECTILE,
          DEBUG,
        );
      }
    }

    const players = this.serverPlayers();
    const me = players.find((p) => p.id === this.meId);
    const op = players.find((p) => p.id === this.oppId);
    const w = this.scale.width;
    if (me) drawHpBar(g, 24, 38, 260, me.hp / me.maxHp, COLORS.me);
    if (op) drawHpBar(g, w - 24 - 260, 38, 260, op.hp / op.maxHp, COLORS.opponent);
  }

  private updateHud(phase: string | null): void {
    let elapsed = 0;
    if (this.latest) {
      elapsed = this.latest.elapsedSec + Math.min((performance.now() - this.latestAt) / 1000, 0.2);
    }
    const remaining = Math.max(0, Math.ceil(BATTLE_DURATION_SEC - elapsed));
    this.timer
      .setText(ja.common.seconds(remaining))
      .setColor(remaining <= 10 ? TEXT.danger : TEXT.main);

    if (phase === 'COUNTDOWN') {
      const ms = game.remainingMs(game.publicState?.deadlineAt) ?? 0;
      this.center.setText(String(Math.max(1, Math.ceil(ms / 1000))));
    } else if (phase === 'BATTLE' && elapsed < 1) {
      this.center.setText(ja.battle.go);
    } else {
      this.center.setText('');
    }

    if (this.debugText) {
      const rtt = game.socket.rtt;
      const age = this.latest ? performance.now() - this.latestAt : 0;
      this.debugText.setText(
        [
          ja.debug.rtt(rtt.avg, rtt.max),
          ja.debug.fps(this.game.loop.actualFps),
          ja.debug.snapAge(age),
          ja.debug.snapSize(this.latestBytes),
          ja.debug.correction(this.correction),
        ].join('\n'),
      );
    }
  }
}
