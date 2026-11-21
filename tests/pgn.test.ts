import { describe, expect, it } from 'vitest';
import type { Square } from 'chess.js';
import { GameController } from '../src/domain/gameController';
import {
  buildPgn,
  formatMovetext,
  formatPgnDate,
  pgnFileName,
  resultTag,
} from '../src/domain/pgn';
import type { MoveRecord } from '../src/domain/types';

function play(...moves: Array<[Square, Square]>): MoveRecord[] {
  const game = new GameController();
  const records: MoveRecord[] = [];
  for (const [from, to] of moves) {
    const outcome = game.move(from, to);
    if (!outcome.ok) throw new Error(`测试着法不合法：${from}-${to}`);
    records.push(outcome.record);
  }
  return records;
}

function movetextOf(pgn: string): string {
  return pgn.split('\n\n')[1];
}

describe('PGN 棋谱导出', () => {
  it('生成标准标签对：白方、黑方、日期、结果', () => {
    const records = play(['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6']);
    const pgn = buildPgn(records, {
      white: '玩家',
      black: '教学 AI · 入门',
      date: new Date(2026, 10, 21),
      result: '1-0',
    });

    expect(pgn).toContain('[Event "教学对局"]');
    expect(pgn).toContain('[Site "chess-teaching-3d"]');
    expect(pgn).toContain('[Date "2026.11.21"]');
    expect(pgn).toContain('[Round "-"]');
    expect(pgn).toContain('[White "玩家"]');
    expect(pgn).toContain('[Black "教学 AI · 入门"]');
    expect(pgn).toContain('[Result "1-0"]');
    expect(movetextOf(pgn)).toBe('1. e4 e5\n2. Nf3 Nc6 1-0\n');
  });

  it('未指定结果时默认“*”', () => {
    const records = play(['d2', 'd4']);
    const pgn = buildPgn(records, {
      white: '玩家 1',
      black: '玩家 2',
      date: new Date(2026, 0, 2),
    });
    expect(pgn).toContain('[Result "*"]');
    expect(movetextOf(pgn)).toBe('1. d4 *\n');
  });

  it('空对局也能导出，只含标签与结果标记', () => {
    const pgn = buildPgn([], {
      white: '玩家 1',
      black: '玩家 2',
      date: new Date(2026, 0, 2),
    });
    expect(movetextOf(pgn)).toBe('*\n');
  });

  it('从黑方接续的局面使用“1...”编号', () => {
    const game = new GameController(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    );
    const outcome = game.move('e7', 'e5');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(formatMovetext([outcome.record], '*')).toBe('1... e5 *');

    const next = game.move('d2', 'd4');
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(formatMovetext([outcome.record, next.record], '*')).toBe(
      '1... e5\n2. d4 *',
    );
  });

  it('对局结果映射为 PGN 结果标记', () => {
    expect(resultTag(null)).toBe('*');
    expect(resultTag(undefined)).toBe('*');
    expect(resultTag({ reason: 'checkmate', winner: 'w', label: '' })).toBe('1-0');
    expect(resultTag({ reason: 'checkmate', winner: 'b', label: '' })).toBe('0-1');
    expect(resultTag({ reason: 'stalemate', winner: null, label: '' })).toBe(
      '1/2-1/2',
    );
    expect(resultTag({ reason: 'insufficient', winner: null, label: '' })).toBe(
      '1/2-1/2',
    );
  });

  it('将死对局保留 SAN 的“#”并以 1-0 收尾', () => {
    const game = new GameController();
    const moves: Array<[Square, Square]> = [
      ['e2', 'e4'],
      ['e7', 'e5'],
      ['d1', 'h5'],
      ['b8', 'c6'],
      ['f1', 'c4'],
      ['g8', 'f6'],
      ['h5', 'f7'],
    ];
    for (const [from, to] of moves) {
      const outcome = game.move(from, to);
      expect(outcome.ok).toBe(true);
    }
    expect(game.result?.reason).toBe('checkmate');

    const pgn = buildPgn(game.history, {
      white: '玩家',
      black: '教学 AI · 入门',
      date: new Date(2026, 10, 21),
      result: resultTag(game.result),
    });
    expect(pgn).toContain('[Result "1-0"]');
    expect(pgn).toContain('Qxf7#');
    expect(movetextOf(pgn).trimEnd().endsWith('1-0')).toBe(true);
  });

  it('标签里的双引号和反斜杠会被转义', () => {
    const pgn = buildPgn([], {
      white: 'A "B"',
      black: 'C\\D',
      date: new Date(2026, 0, 2),
    });
    expect(pgn).toContain('[White "A \\"B\\""]');
    expect(pgn).toContain('[Black "C\\\\D"]');
  });

  it('日期与文件名使用本地时间', () => {
    const date = new Date(2026, 0, 5, 9, 7);
    expect(formatPgnDate(date)).toBe('2026.01.05');
    expect(pgnFileName(date)).toBe('chess-20260105-0907.pgn');
  });
});