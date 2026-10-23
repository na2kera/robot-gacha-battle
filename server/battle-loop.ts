/**
 * BATTLE 中の固定 step ループ。仕様書 11 章。
 * setTimeout の再帰で約 30Hz に起き、実時間の差を蓄積して TICK_DT ごとに stepBattle する。
 * 1 コール最大 MAX_STEPS_PER_CALL step。蓄積が STALL_ABORT_MS を超えたら停止を通知する。
 * タイマーは stop()/pause() で必ず解除する。
 */
import { ARENA } from '../shared/arena';
import {
  BATTLE_DURATION_SEC,
  INPUT_TIMEOUT_MS,
  MAX_STEPS_PER_CALL,
  SNAPSHOT_RATE,
  STALL_ABORT_MS,
  TICK_DT,
  TICK_RATE,
} from '../shared/config';
import type { InputCommand } from '../shared/input';
import { computeStats, type Loadout, type RobotStats } from '../shared/parts';
import {
  createBattleState,
  judge,
  stepBattle,
  type BattleState,
  type JudgeResult,
} from '../shared/simulation';

const TICK_MS = TICK_DT * 1000;
const TICKS_PER_SNAPSHOT = Math.max(1, Math.round(TICK_RATE / SNAPSHOT_RATE));
/** 1 コールで追いつけない遅れをログに出す閾値 */
const LAG_LOG_MS = 200;

export interface BattleLoopCallbacks {
  onSnapshot(state: BattleState, lastProcessedInputSeq: Record<string, number>): void;
  onEnd(result: JudgeResult): void;
  onStall(): void;
}

export interface BattleEntrant {
  playerId: string;
  loadout: Loadout;
}

interface LatestInput {
  command: InputCommand;
  receivedAt: number;
}

export class BattleLoop {
  state: BattleState;
  private readonly stats = new Map<string, RobotStats>();
  private readonly latest = new Map<string, LatestInput>();
  private readonly lastAcceptedSeq = new Map<string, number>();
  private readonly lastProcessedSeq = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastTime = 0;
  private accumulatedMs = 0;
  private finished = false;
  private lastLagLogAt = 0;

  constructor(
    entrants: readonly [BattleEntrant, BattleEntrant],
    private readonly callbacks: BattleLoopCallbacks,
    private readonly clock: () => number = Date.now,
  ) {
    this.state = createBattleState(
      entrants.map((e, i) => {
        const stats = computeStats(e.loadout);
        this.stats.set(e.playerId, stats);
        this.lastProcessedSeq.set(e.playerId, -1);
        return { id: e.playerId, stats, spawn: ARENA.spawns[i]! };
      }),
    );
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.finished || this.timer !== null) return;
    this.lastTime = this.clock();
    this.schedule();
  }

  /** 両者切断。タイマーを止め、停止中の時間は蓄積しない */
  pause(): void {
    this.clearTimer();
  }

  stop(): void {
    this.finished = true;
    this.clearTimer();
  }

  /** seq が前回以下なら false */
  acceptInput(playerId: string, command: InputCommand): boolean {
    if (!this.stats.has(playerId)) return false;
    const last = this.lastAcceptedSeq.get(playerId) ?? -1;
    if (command.seq <= last) return false;
    this.lastAcceptedSeq.set(playerId, command.seq);
    this.latest.set(playerId, { command, receivedAt: this.clock() });
    return true;
  }

  /** 切断時に入力を中立にする */
  clearInput(playerId: string): void {
    this.latest.delete(playerId);
  }

  lastProcessedInputSeq(): Record<string, number> {
    return Object.fromEntries(this.lastProcessedSeq);
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const wait = Math.max(0, TICK_MS - this.accumulatedMs);
    this.timer = setTimeout(() => this.run(), wait);
  }

  private run(): void {
    this.timer = null;
    if (this.finished) return;
    const now = this.clock();
    this.accumulatedMs += Math.max(0, now - this.lastTime);
    this.lastTime = now;
    if (this.accumulatedMs > STALL_ABORT_MS) {
      this.stop();
      this.callbacks.onStall();
      return;
    }

    let steps = 0;
    let snapshotDue = false;
    while (this.accumulatedMs >= TICK_MS && steps < MAX_STEPS_PER_CALL) {
      const inputs = new Map<string, InputCommand | null>();
      for (const id of this.stats.keys()) {
        const latest = this.latest.get(id);
        if (latest && now - latest.receivedAt <= INPUT_TIMEOUT_MS) {
          inputs.set(id, latest.command);
          this.lastProcessedSeq.set(id, latest.command.seq);
        } else {
          inputs.set(id, null);
        }
      }
      this.state = stepBattle(this.state, inputs, this.stats, TICK_DT);
      this.accumulatedMs -= TICK_MS;
      steps++;
      if (this.state.tick % TICKS_PER_SNAPSHOT === 0) snapshotDue = true;

      const result = judge(this.state, BATTLE_DURATION_SEC);
      if (result) {
        this.stop();
        this.callbacks.onSnapshot(this.state, this.lastProcessedInputSeq());
        this.callbacks.onEnd(result);
        return;
      }
    }
    if (this.accumulatedMs >= LAG_LOG_MS && now - this.lastLagLogAt >= 1000) {
      this.lastLagLogAt = now;
      console.log(`tick lag ${Math.round(this.accumulatedMs)}ms`);
    }
    if (snapshotDue) this.callbacks.onSnapshot(this.state, this.lastProcessedInputSeq());
    this.schedule();
  }
}
