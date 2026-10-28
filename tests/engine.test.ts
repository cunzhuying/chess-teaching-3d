import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { findBestMove, findTopMoves, analyzeCandidate, LEVELS } from '../src/engine/search';

describe('教学引擎', () => {
  it('四个难度都有配置', () => {
    expect(LEVELS.beginner.depth).toBe(1);
    expect(LEVELS.hard.depth).toBeGreaterThan(LEVELS.medium.depth);
  });

  it('在一步杀局面找到将杀', () => {
    const fen = '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1';
    const result = findBestMove(fen, 'medium');
    expect(result).not.toBeNull();
    expect(result?.mateIn).toBe(1);
    const game = new Chess(fen);
    const legal = game.moves({ verbose: true });
    expect(
      legal.some(
        (move) =>
          move.from === result?.from &&
          move.to === result?.to &&
          move.promotion === result?.promotion,
      ),
    ).toBe(true);
    game.move({ from: result!.from, to: result!.to, promotion: result!.promotion });
    expect(game.isCheckmate()).toBe(true);
  });

  it('开局返回合法着法', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const result = findBestMove(fen, 'beginner');
    expect(result).not.toBeNull();
    const game = new Chess(fen);
    expect(
      game.moves({ verbose: true }).some(
        (move) =>
          move.from === result?.from &&
          move.to === result?.to &&
          move.promotion === result?.promotion,
      ),
    ).toBe(true);
    expect(result?.pv.length).toBeGreaterThan(0);
  });

  it('开局能生成 3 条推荐根着法', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const lines = findTopMoves(fen, 'easy', 3);
    expect(lines).toHaveLength(3);
    const game = new Chess(fen);
    for (const line of lines) {
      expect(
        game.moves({ verbose: true }).some(
          (move) => move.from === line.from && move.to === line.to,
        ),
      ).toBe(true);
    }
  }, 30_000);

  it('终局没有着法时返回 null', () => {
    expect(findBestMove('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', 'easy')).toBeNull();
  });

  it('多步推演给出对手应招与后续', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const result = analyzeCandidate(fen, 'e2', 'e4', undefined, 'easy');
    expect(result).not.toBeNull();
    expect(result?.forcedSan).toBe('e4');
    expect(result?.reply).not.toBeNull();
    expect(result?.best).not.toBeNull();
    expect(result?.candidateScoreCp).toBeTypeOf('number');
  });

  it('多步推演识别一步将杀', () => {
    const fen = '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1';
    const result = analyzeCandidate(fen, 'f7', 'g7', undefined, 'easy');
    expect(result?.reply).toBeNull();
    expect(result?.terminal).toBe('checkmate');
    expect(result?.candidateScoreCp).toBeGreaterThan(90_000);
  });

  it('多步推演能指出送后后被车吃掉', () => {
    const fen = '3r3k/8/8/8/8/8/Q7/K7 w - - 0 1';
    const result = analyzeCandidate(fen, 'a2', 'd2', undefined, 'easy');
    expect(result).not.toBeNull();
    expect(result?.reply?.captured).toBe('q');
    expect(result?.reply?.piece).toBe('r');
    expect(result?.candidateScoreCp).toBeLessThan(result!.bestScoreCp);
  });
});
