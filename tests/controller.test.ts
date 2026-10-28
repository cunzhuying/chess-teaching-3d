import { describe, expect, it } from 'vitest';
import { GameController, type MoveOutcome } from '../src/domain/gameController';

function errorOf(outcome: MoveOutcome): string {
  if (outcome.ok) throw new Error('expected failure');
  if (outcome.needsPromotion) throw new Error('expected error, got promotion');
  return outcome.error;
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const OPEN = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

describe('GameController：基本对局', () => {
  it('初始局面白先，棋盘 8×8', () => {
    const game = new GameController();
    const snap = game.snapshot();
    expect(snap.turn).toBe('w');
    expect(snap.board).toHaveLength(8);
    expect(snap.board[0]).toHaveLength(8);
    expect(snap.checkSquare).toBeNull();
    expect(snap.result).toBeNull();
    expect(game.fen).toBe(START);
  });

  it('走子后更新回合、历史与最后一步', () => {
    const game = new GameController();
    const out = game.move('e2', 'e4');
    if (!out.ok) throw new Error('expected legal move');
    expect(out.record.san).toBe('e4');
    expect(out.record.zh).toBe('兵 e2→e4');
    expect(out.record.moveNumber).toBe(1);
    expect(game.turn).toBe('b');
    expect(game.history).toHaveLength(1);
    expect(game.lastRecord?.from).toBe('e2');
    expect(game.snapshot().lastMove).toEqual({ from: 'e2', to: 'e4' });
  });

  it('合法走法按棋子过滤', () => {
    const game = new GameController();
    const fromE2 = game.legalMovesFrom('e2').map((move) => move.to);
    expect(fromE2.sort()).toEqual(['e3', 'e4']);
    expect(game.legalMoves().length).toBe(20);
  });

  it('非法走子给出可读原因', () => {
    const game = new GameController();
    const out = game.move('e2', 'e5');
    expect(out.ok).toBe(false);
    expect(errorOf(out)).toBeTruthy();
  });

  it('不能移动对方的棋子', () => {
    const game = new GameController();
    game.move('e2', 'e4');
    const out = game.move('d2', 'd4');
    expect(out.ok).toBe(false);
    expect(errorOf(out)).toContain('黑方');
  });

  it('不能走到己方棋子占据的格子', () => {
    const game = new GameController(OPEN);
    const out = game.move('e1', 'a1');
    expect(out.ok).toBe(false);
    expect(errorOf(out)).toBe('该格被己方棋子占据');
  });

  it('空起点给出明确提示', () => {
    const game = new GameController(OPEN);
    const out = game.move('d4', 'd5');
    expect(out.ok).toBe(false);
    expect(errorOf(out)).toBe('该格没有棋子');
  });
});

describe('GameController：特殊走法', () => {
  it('升变需要先选择棋子，再落子', () => {
    const game = new GameController('8/6P1/7k/8/8/8/8/K7 w - - 0 1');
    const pending = game.move('g7', 'g8');
    if (pending.ok || !pending.needsPromotion) throw new Error('expected promotion');
    expect(pending.choices).toEqual(['q', 'r', 'b', 'n']);
    expect(game.turn).toBe('w');
    expect(game.history).toHaveLength(0);

    const done = game.move('g7', 'g8', 'n');
    if (!done.ok) throw new Error('expected promotion move');
    expect(done.record.zh).toBe('兵 g7→g8=马＋');
    expect(done.record.promotion).toBe('n');
    expect(game.snapshot().inCheck).toBe(true);
  });

  it('预览吃过路兵时给出正确的被吃格', () => {
    const game = new GameController('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const preview = game.preview('e5', 'd6');
    expect(preview).not.toBeNull();
    expect(preview?.isEnPassant).toBe(true);
    expect(preview?.capturedSquare).toBe('d5');
  });

  it('预览易位时同时给出车的起止格', () => {
    const game = new GameController(OPEN);
    expect(game.preview('e1', 'g1')?.rook).toEqual({ from: 'h1', to: 'f1' });
    expect(game.preview('e1', 'c1')?.rook).toEqual({ from: 'a1', to: 'd1' });
  });

  it('易位记录带车路径', () => {
    const game = new GameController('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const out = game.move('e1', 'g1');
    if (!out.ok) throw new Error('expected castling');
    expect(out.record.rook).toEqual({ from: 'h1', to: 'f1' });
    expect(out.record.capturedSquare).toBeUndefined();
  });

  it('吃过路兵记录带真实被吃格', () => {
    const game = new GameController('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
    const out = game.move('e5', 'd6');
    if (!out.ok) throw new Error('expected en passant');
    expect(out.record.capturedSquare).toBe('d5');
    expect(out.record.to).toBe('d6');
  });

  it('预览升变默认显示后，并列出四个选择', () => {
    const game = new GameController('8/6P1/7k/8/8/8/8/K7 w - - 0 1');
    const preview = game.preview('g7', 'g8');
    expect(preview?.promotion).toBe('q');
    expect(preview?.promotionChoices).toEqual(['q', 'r', 'b', 'n']);
  });

  it('预览非法着法返回 null', () => {
    const game = new GameController();
    expect(game.preview('e2', 'e5')).toBeNull();
  });
});

describe('GameController：终局判定', () => {
  it('将军格指向被将军的王', () => {
    const game = new GameController('7k/8/8/8/8/8/8/K6R b - - 0 1');
    const snap = game.snapshot();
    expect(snap.inCheck).toBe(true);
    expect(snap.checkSquare).toBe('h8');
    expect(snap.result).toBeNull();
  });

  it('将死时给出胜方', () => {
    const game = new GameController('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1');
    const result = game.result;
    expect(result?.reason).toBe('checkmate');
    expect(result?.winner).toBe('w');
    expect(result?.label).toContain('白方获胜');
  });

  it('逼和', () => {
    const game = new GameController('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(game.result?.reason).toBe('stalemate');
  });

  it('三次重复局面', () => {
    const game = new GameController();
    const shuffle: Array<[string, string]> = [
      ['g1', 'f3'],
      ['g8', 'f6'],
      ['f3', 'g1'],
      ['f6', 'g8'],
      ['g1', 'f3'],
      ['g8', 'f6'],
      ['f3', 'g1'],
      ['f6', 'g8'],
    ];
    for (const [from, to] of shuffle) {
      const out = game.move(from as never, to as never);
      if (!out.ok) throw new Error(`unexpected illegal move ${from}${to}`);
    }
    expect(game.result?.reason).toBe('threefold');
  });

  it('五十回合规则', () => {
    const game = new GameController('7k/8/8/8/8/8/8/KR6 w - - 99 80');
    const out = game.move('b1', 'b2');
    expect(out.ok).toBe(true);
    expect(game.result?.reason).toBe('fifty');
  });
});

describe('GameController：悔棋、重开与缓存键', () => {
  it('悔棋回到上一步，历史同步', () => {
    const game = new GameController();
    game.move('e2', 'e4');
    const afterE4 = game.fen;
    game.move('e7', 'e5');
    const undone = game.undo();
    expect(undone?.san).toBe('e5');
    expect(game.fen).toBe(afterE4);
    expect(game.turn).toBe('b');
    expect(game.history).toHaveLength(1);
  });

  it('没有历史时悔棋返回 null', () => {
    const game = new GameController();
    expect(game.undo()).toBeNull();
  });

  it('重开后清空历史并回到白先', () => {
    const game = new GameController();
    game.move('e2', 'e4');
    game.reset();
    expect(game.history).toHaveLength(0);
    expect(game.turn).toBe('w');
    expect(game.fen).toBe(START);
  });

  it('缓存键忽略半回合钟和回合数', () => {
    const a = new GameController('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    const b = new GameController('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 12 40');
    expect(a.positionKey).toBe(b.positionKey);
  });

  it('载入 FEN 后历史为空', () => {
    const game = new GameController();
    game.move('e2', 'e4');
    game.load('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(game.history).toHaveLength(0);
    expect(game.legalMoves()).toHaveLength(5);
  });

  it('previewFen 生成假想局面但不修改真实棋局', () => {
    const game = new GameController();
    const before = game.fen;
    const after = game.previewFen('e2', 'e4');
    expect(after).toContain('4P3');
    expect(game.fen).toBe(before);
  });

  it('restore 接受主机同步的局面与历史', () => {
    const host = new GameController();
    host.move('e2', 'e4');
    host.move('e7', 'e5');
    const guest = new GameController();
    guest.restore(host.fen, [...host.history]);
    expect(guest.fen).toBe(host.fen);
    expect(guest.history).toHaveLength(2);
    expect(guest.lastRecord?.san).toBe('e5');
  });
});
