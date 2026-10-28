import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';

function targets(fen: string, square: string): string[] {
  const game = new Chess(fen);
  return game
    .moves({ square: square as never, verbose: true })
    .map((move) => move.to);
}

describe('王车易位', () => {
  const OPEN = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

  it('两侧易位都可用', () => {
    expect(targets(OPEN, 'e1')).toContain('g1');
    expect(targets(OPEN, 'e1')).toContain('c1');
  });

  it('王经过被攻击格时不能易位', () => {
    const throughCheck = 'r3k2r/8/8/8/8/8/6q1/R3K2R w KQkq - 0 1';
    const list = targets(throughCheck, 'e1');
    expect(list).not.toContain('g1');
    expect(list).toContain('c1');
  });

  it('被将军时不能易位', () => {
    const inCheck = 'r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0 1';
    const list = targets(inCheck, 'e1');
    expect(list).not.toContain('g1');
    expect(list).not.toContain('c1');
  });

  it('车移动后失去该侧易位权，悔棋后恢复', () => {
    const game = new Chess(OPEN);
    game.move({ from: 'h1', to: 'h2' });
    expect(targetsFrom(game, 'e1')).not.toContain('g1');
    game.undo();
    expect(targetsFrom(game, 'e1')).toContain('g1');
  });

  it('王移动后失去两侧易位权', () => {
    const game = new Chess(OPEN);
    game.move({ from: 'e1', to: 'e2' });
    expect(targetsFrom(game, 'e1')).not.toContain('g1');
    expect(targetsFrom(game, 'e1')).not.toContain('c1');
  });
});

describe('吃过路兵', () => {
  const EP = '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1';

  it('可以立即吃过路兵，并移除正确的兵', () => {
    const game = new Chess(EP);
    game.move({ from: 'e5', to: 'd6' });
    expect(game.get('d5')).toBeUndefined();
    expect(game.get('e5')).toBeUndefined();
    expect(game.get('d6')?.type).toBe('p');
    expect(game.get('d6')?.color).toBe('w');
  });

  it('吃过路兵会暴露己方王时禁止', () => {
    const pinned = '7k/8/8/K2pP2r/8/8/8/8 w - d6 0 1';
    expect(targets(pinned, 'e5')).not.toContain('d6');
  });

  it('吃过路兵只能在紧接着的一步进行', () => {
    const game = new Chess(EP);
    game.move({ from: 'e1', to: 'f1' });
    game.move({ from: 'e8', to: 'f8' });
    expect(targetsFrom(game, 'e5')).not.toContain('d6');
  });
});

describe('兵升变', () => {
  const PROMO = '8/6P1/7k/8/8/8/8/K7 w - - 0 1';

  it('升变为马可以形成将军', () => {
    const game = new Chess(PROMO);
    game.move({ from: 'g7', to: 'g8', promotion: 'n' });
    expect(game.get('g8')?.type).toBe('n');
    expect(game.isCheck()).toBe(true);
  });

  it('四种升变都出现在合法着法中', () => {
    const game = new Chess(PROMO);
    const promotions = game
      .moves({ square: 'g7', verbose: true })
      .map((move) => move.promotion)
      .filter(Boolean);
    expect(new Set(promotions)).toEqual(new Set(['q', 'r', 'b', 'n']));
  });
});

describe('和棋与终局规则', () => {
  it('三次重复局面', () => {
    const game = new Chess();
    const shuffle = [
      ['g1', 'f3'],
      ['g8', 'f6'],
      ['f3', 'g1'],
      ['f6', 'g8'],
      ['g1', 'f3'],
      ['g8', 'f6'],
      ['f3', 'g1'],
      ['f6', 'g8'],
    ];
    for (const [from, to] of shuffle) game.move({ from, to });
    expect(game.isThreefoldRepetition()).toBe(true);
    expect(game.isDraw()).toBe(true);
    game.undo();
    expect(game.isThreefoldRepetition()).toBe(false);
  });

  it('五十回合规则', () => {
    const game = new Chess('7k/8/8/8/8/8/8/KR6 w - - 99 80');
    game.move({ from: 'b1', to: 'b2' });
    expect(game.isDrawByFiftyMoves()).toBe(true);
    expect(game.isDraw()).toBe(true);
  });

  it('逼和不是将死', () => {
    const game = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(game.isCheck()).toBe(false);
    expect(game.isStalemate()).toBe(true);
    expect(game.isCheckmate()).toBe(false);
    expect(game.isDraw()).toBe(true);
  });

  it('将死', () => {
    const game = new Chess('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1');
    expect(game.isCheckmate()).toBe(true);
    expect(game.isStalemate()).toBe(false);
  });

  it('子力不足', () => {
    expect(new Chess('8/8/8/8/8/8/8/K6k w - - 0 1').isInsufficientMaterial()).toBe(true);
    expect(new Chess('8/8/8/8/8/8/8/KB5k w - - 0 1').isInsufficientMaterial()).toBe(true);
    expect(new Chess('8/8/8/8/8/8/8/KN5k w - - 0 1').isInsufficientMaterial()).toBe(true);
  });
});

describe('悔棋与局面一致性', () => {
  it('undo 后重新走同一着，FEN 与悔棋前一致', () => {
    const game = new Chess();
    game.move('e4');
    game.move('e5');
    game.move('Nf3');
    const before = game.fen();
    game.undo();
    game.undo();
    game.move('e5');
    game.move('Nf3');
    expect(game.fen()).toBe(before);
  });

  it('undo 还原易位权与吃过路兵权', () => {
    const game = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const before = game.fen();
    game.move({ from: 'e1', to: 'e2' });
    game.undo();
    expect(game.fen()).toBe(before);
  });
});

function targetsFrom(game: Chess, square: string): string[] {
  return game.moves({ square: square as never, verbose: true }).map((move) => move.to);
}
