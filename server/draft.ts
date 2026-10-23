/**
 * ガチャ（DRAFTING）の状態遷移。docs/flow.md「ガチャの処理」。
 * 状態の保存と送信は呼び出し側（GameRoom）が行う。
 */
import { PART_IDS_BY_TYPE, type Loadout, type PartId, type PartType } from '../shared/parts';
import {
  PART_TYPES,
  type DraftResultMessage,
  type ErrorCode,
  type PrivateDraftPart,
} from '../shared/protocol';
import { MAX_DRAWS_PER_PART, REQUEST_LOG_PER_PART } from './constants';
import { randomIndex } from './random';

export type DraftParts = Record<PartType, PrivateDraftPart>;

export type DraftResultBody = Omit<DraftResultMessage, 'protocolVersion' | 'serverTime'>;

export interface RequestLogEntry {
  requestId: string;
  result: DraftResultBody;
}

/** 部位ごとの直近の requestId → 結果 */
export type RequestLog = Record<PartType, RequestLogEntry[]>;

export type DraftOutcome = { ok: true; part: PrivateDraftPart } | { ok: false; code: ErrorCode };

export function emptyDraft(): DraftParts {
  const part = (): PrivateDraftPart => ({
    candidate: null,
    candidateVersion: 0,
    drawCount: 0,
    locked: false,
    confirmed: null,
  });
  return { body: part(), legs: part(), weapon: part(), core: part() };
}

export function emptyRequestLog(): RequestLog {
  return { body: [], legs: [], weapon: [], core: [] };
}

/** 暗号学的乱数で 3 種から等確率に 1 つ選ぶ */
export function drawPartId(partType: PartType): PartId {
  const ids: readonly PartId[] = PART_IDS_BY_TYPE[partType];
  return ids[randomIndex(ids.length)]!;
}

/** 抽選。上限到達で自動確定。元の part は変更しない */
export function applyDraw(
  part: PrivateDraftPart,
  partType: PartType,
  candidateVersion: number,
): DraftOutcome {
  if (part.locked) return { ok: false, code: 'part_locked' };
  if (candidateVersion !== part.candidateVersion) return { ok: false, code: 'stale_candidate' };
  if (part.drawCount >= MAX_DRAWS_PER_PART) return { ok: false, code: 'draw_limit' };
  const candidate = drawPartId(partType);
  const drawCount = part.drawCount + 1;
  const locked = drawCount >= MAX_DRAWS_PER_PART;
  return {
    ok: true,
    part: {
      candidate,
      candidateVersion: part.candidateVersion + 1,
      drawCount,
      locked,
      confirmed: locked ? candidate : null,
    },
  };
}

/** 確定。確定済みなら現状をそのまま返す（冪等） */
export function applyConfirm(part: PrivateDraftPart, candidateVersion: number): DraftOutcome {
  if (part.locked) return { ok: true, part };
  if (part.candidate === null) return { ok: false, code: 'bad_phase' };
  if (candidateVersion !== part.candidateVersion) return { ok: false, code: 'stale_candidate' };
  return { ok: true, part: { ...part, locked: true, confirmed: part.candidate } };
}

/**
 * 期限切れの自動処理。候補ありの未確定は確定、未抽選は 1 回だけ抽選して確定。
 * 変化した部位の一覧を返す
 */
export function autoComplete(parts: DraftParts): PartType[] {
  const changed: PartType[] = [];
  for (const type of PART_TYPES) {
    const part = parts[type];
    if (part.locked) continue;
    if (part.candidate === null) {
      const candidate = drawPartId(type);
      parts[type] = {
        candidate,
        candidateVersion: part.candidateVersion + 1,
        drawCount: part.drawCount + 1,
        locked: true,
        confirmed: candidate,
      };
    } else {
      parts[type] = { ...part, locked: true, confirmed: part.candidate };
    }
    changed.push(type);
  }
  return changed;
}

export function confirmedCount(parts: DraftParts): number {
  return PART_TYPES.filter((t) => parts[t].locked).length;
}

export function isComplete(parts: DraftParts): boolean {
  return confirmedCount(parts) === PART_TYPES.length;
}

/** 4 部位確定済みの構成。未完成なら null */
export function toLoadout(parts: DraftParts): Loadout | null {
  const { body, legs, weapon, core } = parts;
  if (!body.confirmed || !legs.confirmed || !weapon.confirmed || !core.confirmed) return null;
  return {
    body: body.confirmed,
    legs: legs.confirmed,
    weapon: weapon.confirmed,
    core: core.confirmed,
  } as Loadout;
}

export function findLoggedResult(
  log: RequestLog,
  partType: PartType,
  requestId: string,
): DraftResultBody | null {
  return log[partType].find((e) => e.requestId === requestId)?.result ?? null;
}

export function appendLog(log: RequestLog, partType: PartType, entry: RequestLogEntry): void {
  const list = log[partType];
  list.push(entry);
  if (list.length > REQUEST_LOG_PER_PART) list.splice(0, list.length - REQUEST_LOG_PER_PART);
}
