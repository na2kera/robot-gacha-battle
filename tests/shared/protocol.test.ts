import { describe, expect, it } from 'vitest';
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  parseClientMessage,
  serverMessage,
  utf8ByteLength,
  validatePlayerName,
  type ClientMessage,
} from '../../shared/protocol';

function parse(obj: unknown) {
  return parseClientMessage(JSON.stringify(obj));
}

function expectOk(obj: unknown): ClientMessage {
  const r = parse(obj);
  if (!r.ok) throw new Error(`rejected: ${r.code}`);
  return r.message;
}

function expectCode(obj: unknown, code: string) {
  expect(parse(obj)).toEqual({ ok: false, code });
}

const valid: Record<ClientMessage['type'], ClientMessage> = {
  authenticate: { type: 'authenticate', sessionToken: 'tok', protocolVersion: PROTOCOL_VERSION },
  ready: { type: 'ready', matchId: 1, value: true },
  draftDraw: {
    type: 'draftDraw',
    matchId: 1,
    partType: 'body',
    requestId: 'r1',
    candidateVersion: 0,
  },
  draftConfirm: {
    type: 'draftConfirm',
    matchId: 1,
    partType: 'core',
    requestId: 'r2',
    candidateVersion: 3,
  },
  input: {
    type: 'input',
    matchId: 2,
    seq: 0,
    moveX: 0.3,
    moveY: -0.4,
    aimAngle: 1,
    firing: false,
  },
  rematch: { type: 'rematch', matchId: 1, value: false },
  leave: { type: 'leave', matchId: 1 },
  ping: { type: 'ping', clientTime: 123.5 },
};

describe('parseClientMessage 正常系', () => {
  for (const [type, msg] of Object.entries(valid)) {
    it(`${type} を通す`, () => {
      expect(expectOk(msg)).toEqual(msg);
    });
  }

  it('余分なフィールドを捨てる', () => {
    for (const msg of Object.values(valid)) {
      const out = expectOk({ ...msg, extra: 1, x: 999, damage: 100 });
      expect(out).toEqual(msg);
      expect(out).not.toHaveProperty('extra');
    }
  });

  it('authenticate・ping は matchId がなくても通り、付いていても捨てる', () => {
    expect(expectOk({ ...valid.authenticate, matchId: 5 })).not.toHaveProperty('matchId');
    expect(expectOk({ ...valid.ping, matchId: 5 })).not.toHaveProperty('matchId');
  });

  it('input の移動ベクトルと照準角を正規化する', () => {
    const out = expectOk({ ...valid.input, moveX: 1, moveY: 1, aimAngle: 3 * Math.PI });
    if (out.type !== 'input') throw new Error('type');
    expect(Math.hypot(out.moveX, out.moveY)).toBeCloseTo(1);
    expect(Math.abs(out.aimAngle)).toBeCloseTo(Math.PI);
  });

  it('protocolVersion の一致は判定しない（呼び出し側が protocol_mismatch を返す）', () => {
    expect(expectOk({ ...valid.authenticate, protocolVersion: 999 })).toMatchObject({
      protocolVersion: 999,
    });
  });
});

describe('parseClientMessage 異常系', () => {
  it('JSON でないものを拒否', () => {
    for (const raw of ['', '{', 'not json', '{"type":"ping",}', 'undefined']) {
      expect(parseClientMessage(raw)).toEqual({ ok: false, code: 'invalid_message' });
    }
  });

  it('オブジェクト以外を拒否', () => {
    for (const v of [null, 1, 'ping', [], [valid.ping], true]) {
      expectCode(v, 'invalid_message');
    }
  });

  it('type 不明・欠落を拒否', () => {
    expectCode({}, 'invalid_message');
    expectCode({ type: 'hack', matchId: 1 }, 'invalid_message');
    expectCode({ type: 'welcome', matchId: 1 }, 'invalid_message');
    expectCode({ type: 1, matchId: 1 }, 'invalid_message');
    expectCode({ type: 'toString', matchId: 1 }, 'invalid_message');
  });

  it('64KB 超を message_too_large で拒否', () => {
    const pad = (n: number) => JSON.stringify({ type: 'ping', clientTime: 1, p: 'a'.repeat(n) });
    const base = pad(0).length;
    const exact = pad(MAX_MESSAGE_BYTES - base);
    expect(exact.length).toBe(MAX_MESSAGE_BYTES);
    expect(parseClientMessage(exact).ok).toBe(true);
    expect(parseClientMessage(pad(MAX_MESSAGE_BYTES - base + 1))).toEqual({
      ok: false,
      code: 'message_too_large',
    });
    // JSON でなくてもサイズを先に判定する
    expect(parseClientMessage('x'.repeat(MAX_MESSAGE_BYTES + 1))).toEqual({
      ok: false,
      code: 'message_too_large',
    });
  });

  it('マルチバイト文字は UTF-8 バイト長で判定する', () => {
    // 'あ' は 3 バイト。文字数は上限未満でもバイト長で超える
    const head = '{"type":"ping","clientTime":1,"p":"';
    const tail = '"}';
    const n = Math.floor((MAX_MESSAGE_BYTES - head.length - tail.length) / 3);
    const fits = head + 'あ'.repeat(n) + tail;
    expect(fits.length).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(parseClientMessage(fits).ok).toBe(true);
    const over = head + 'あ'.repeat(n + 1) + tail;
    expect(over.length).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(parseClientMessage(over)).toEqual({ ok: false, code: 'message_too_large' });
  });

  it('matchId が必要な type で欠落・不正を拒否', () => {
    for (const type of ['ready', 'draftDraw', 'draftConfirm', 'rematch', 'leave'] as const) {
      const { matchId: _m, ...rest } = valid[type] as { matchId: number };
      expectCode(rest, 'invalid_message');
      for (const bad of [-1, 1.5, '1', null, true, 2 ** 53]) {
        expectCode({ ...valid[type], matchId: bad }, 'invalid_message');
      }
    }
  });

  it('Infinity（1e999）を拒否', () => {
    const cases = [
      '{"type":"ping","clientTime":1e999}',
      '{"type":"ping","clientTime":-1e999}',
      '{"type":"leave","matchId":1e999}',
      '{"type":"authenticate","sessionToken":"t","protocolVersion":1e999}',
      '{"type":"draftDraw","matchId":1,"partType":"body","requestId":"r","candidateVersion":1e999}',
    ];
    for (const raw of cases) {
      expect(parseClientMessage(raw)).toEqual({ ok: false, code: 'invalid_message' });
    }
    expect(
      parseClientMessage(
        '{"type":"input","matchId":1,"seq":1,"moveX":0,"moveY":0,"aimAngle":1e999,"firing":true}',
      ),
    ).toEqual({ ok: false, code: 'invalid_input' });
  });

  it('NaN・Infinity を含む値は JSON で null になり拒否される', () => {
    // JSON.stringify は NaN/Infinity を null にする
    expectCode({ type: 'ping', clientTime: NaN }, 'invalid_message');
    expectCode({ type: 'ping', clientTime: Infinity }, 'invalid_message');
    expectCode({ ...valid.input, moveX: NaN }, 'invalid_input');
  });

  it('authenticate の型違い・長さを拒否', () => {
    expectCode({ ...valid.authenticate, sessionToken: '' }, 'invalid_message');
    expectCode({ ...valid.authenticate, sessionToken: 1 }, 'invalid_message');
    expectCode({ ...valid.authenticate, sessionToken: 't'.repeat(257) }, 'invalid_message');
    expect(expectOk({ ...valid.authenticate, sessionToken: 't'.repeat(256) })).toBeTruthy();
    expectCode({ ...valid.authenticate, protocolVersion: '1' }, 'invalid_message');
    expectCode({ ...valid.authenticate, protocolVersion: 1.5 }, 'invalid_message');
    expectCode({ type: 'authenticate', sessionToken: 't' }, 'invalid_message');
  });

  it('ready・rematch の value は boolean のみ', () => {
    for (const type of ['ready', 'rematch'] as const) {
      for (const bad of [1, 0, 'true', null]) {
        expectCode({ ...valid[type], value: bad }, 'invalid_message');
      }
      expectCode({ type, matchId: 1 }, 'invalid_message');
    }
  });

  it('draft 系の型違い・範囲外を拒否', () => {
    for (const type of ['draftDraw', 'draftConfirm'] as const) {
      const m = valid[type];
      for (const bad of ['arm', '', 1, null]) {
        expectCode({ ...m, partType: bad }, 'invalid_message');
      }
      for (const bad of ['', 1, null, 'r'.repeat(65)]) {
        expectCode({ ...m, requestId: bad }, 'invalid_message');
      }
      expect(expectOk({ ...m, requestId: 'r'.repeat(64) })).toBeTruthy();
      for (const bad of [-1, 0.5, '0', null]) {
        expectCode({ ...m, candidateVersion: bad }, 'invalid_message');
      }
    }
  });

  it('input の型違い・範囲外を invalid_input で拒否', () => {
    for (const [key, bad] of [
      ['seq', -1],
      ['seq', 1.5],
      ['seq', '1'],
      ['moveX', 1.01],
      ['moveY', -1.01],
      ['aimAngle', '1'],
      ['firing', 1],
      ['firing', null],
      ['matchId', -1],
    ] as const) {
      expectCode({ ...valid.input, [key]: bad }, 'invalid_input');
    }
    const { firing: _f, ...noFiring } = valid.input as { firing: boolean };
    expectCode(noFiring, 'invalid_input');
  });

  it('ping の clientTime 型違いを拒否', () => {
    expectCode({ type: 'ping', clientTime: '1' }, 'invalid_message');
    expectCode({ type: 'ping' }, 'invalid_message');
  });
});

describe('utf8ByteLength', () => {
  it('各範囲のバイト長', () => {
    expect(utf8ByteLength('')).toBe(0);
    expect(utf8ByteLength('a')).toBe(1);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('あ')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
    expect(utf8ByteLength('a😀あ')).toBe(8);
  });

  it('孤立サロゲートは 3 バイト', () => {
    expect(utf8ByteLength('\ud800')).toBe(3);
    expect(utf8ByteLength('\udc00')).toBe(3);
    expect(utf8ByteLength('\ud800a')).toBe(4);
  });
});

describe('validatePlayerName', () => {
  it('文字列以外を拒否', () => {
    for (const v of [undefined, null, 1, {}, [], true]) {
      expect(validatePlayerName(v)).toBeNull();
    }
  });

  it('長さの境界', () => {
    expect(validatePlayerName('')).toBeNull();
    expect(validatePlayerName('   ')).toBeNull();
    expect(validatePlayerName('a')).toBe('a');
    expect(validatePlayerName('あ'.repeat(12))).toBe('あ'.repeat(12));
    expect(validatePlayerName('あ'.repeat(13))).toBeNull();
  });

  it('絵文字 1 文字は 1 と数える', () => {
    expect(validatePlayerName('😀')).toBe('😀');
    expect(validatePlayerName('😀'.repeat(12))).toBe('😀'.repeat(12));
    expect(validatePlayerName('😀'.repeat(13))).toBeNull();
  });

  it('前後の空白を除き、除いた後で数える', () => {
    expect(validatePlayerName('  ロボ  ')).toBe('ロボ');
    expect(validatePlayerName(` ${'a'.repeat(12)} `)).toBe('a'.repeat(12));
    expect(validatePlayerName('ロボ 太郎')).toBe('ロボ 太郎');
  });

  it('制御文字を拒否', () => {
    for (const s of ['a\u0000b', 'a\nb', 'a\tb', 'a\u001bb', 'a\u007fb', 'a\u0085b']) {
      expect(validatePlayerName(s)).toBeNull();
    }
  });

  it('HTML をエスケープしない', () => {
    expect(validatePlayerName('<b>x</b>')).toBe('<b>x</b>');
  });
});

describe('serverMessage', () => {
  it('共通フィールドを付ける', () => {
    expect(serverMessage({ type: 'pong', clientTime: 5 }, 100)).toEqual({
      type: 'pong',
      clientTime: 5,
      protocolVersion: PROTOCOL_VERSION,
      serverTime: 100,
    });
  });
});
