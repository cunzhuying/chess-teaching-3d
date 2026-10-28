import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

function perft(fen: string, depth: number): number {
  const game = new Chess(fen);
  const walk = (remaining: number): number => {
    if (remaining === 0) return 1;
    const moves = game.moves({ verbose: true });
    let total = 0;
    for (const move of moves) {
      game.move({ from: move.from, to: move.to, promotion: move.promotion });
      total += walk(remaining - 1);
      game.undo();
    }
    return total;
  };
  return walk(depth);
}

describe('perft：走法生成与 make/unmake 正确性', () => {
  it('初始局面 perft(1..2) 为标准值', () => {
    expect(perft(START, 1)).toBe(20);
    expect(perft(START, 2)).toBe(400);
  }, 30_000);

  it('Kiwipete perft(1..2) 为标准值', () => {
    expect(perft(KIWIPETE, 1)).toBe(48);
    expect(perft(KIWIPETE, 2)).toBe(2039);
  }, 30_000);
});
