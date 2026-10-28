import { Chess } from 'chess.js';
import type { Color, Square } from 'chess.js';
import type { PieceType } from '../domain/types';

/**
 * 只依赖走法的最少字段，方便推荐、虚影预览共用同一套大局观评分。
 * chess.js 的 Move 结构天然兼容它。
 */
export interface StrategicMove {
  from: Square;
  to: Square;
  promotion?: PieceType;
  color: Color;
}

/**
 * 大局观评估：
 * 这里刻意不追求“引擎分数”，而是把新手能理解的四个战略维度拆开：
 * 1. 占据中心：有多少合法走法能控制 d4/e4/d5/e5；
 * 2. 子力出动：马/象是否离开原始底线；
 * 3. 王的安全：是否易位、王是否在底线、兵盾是否完整；
 * 4. 空间优势：己方合法走法总数（活动空间）是否增加。
 *
 * 推荐卡只展示“相对上一步有改善”的维度，避免堆砌形容词。
 */
export interface StrategyProfile {
  center: number;
  development: number;
  kingSafety: number;
  space: number;
}

const CENTER_SQUARES = new Set<Square>(['d4', 'e4', 'd5', 'e5']);

function cloneWithTurn(fen: string, color: Color): Chess {
  const parts = fen.split(' ');
  parts[1] = color;
  return new Chess(parts.join(' '));
}

function movesForColor(fen: string, color: Color) {
  const game = new Chess(fen);
  const source = game.turn() === color ? game : cloneWithTurn(fen, color);
  return source.moves({ verbose: true });
}

function kingSquare(game: Chess, color: Color): Square | null {
  for (const row of game.board()) {
    for (const piece of row) {
      if (piece && piece.type === 'k' && piece.color === color) {
        return piece.square;
      }
    }
  }
  return null;
}

function isCastled(game: Chess, color: Color): boolean {
  const king = kingSquare(game, color);
  if (!king) return false;
  return color === 'w'
    ? king === 'g1' || king === 'c1'
    : king === 'g8' || king === 'c8';
}

function pawnShield(game: Chess, color: Color, king: Square): number {
  const file = king.charCodeAt(0) - 97;
  const rank = Number(king[1]);
  const forward = color === 'w' ? 1 : -1;
  let shields = 0;

  for (let df = -1; df <= 1; df += 1) {
    const f = file + df;
    const r = rank + forward;
    if (f < 0 || f > 7 || r < 1 || r > 8) continue;
    const piece = game.get(`${String.fromCharCode(97 + f)}${r}` as Square);
    if (piece?.type === 'p' && piece.color === color) shields += 1;
  }
  return shields;
}

function developmentCount(game: Chess, color: Color): number {
  const home = color === 'w'
    ? new Set<Square>(['b1', 'g1', 'c1', 'f1'])
    : new Set<Square>(['b8', 'g8', 'c8', 'f8']);
  let developed = 0;
  for (const row of game.board()) {
    for (const piece of row) {
      if (!piece) continue;
      if (piece.color !== color) continue;
      if (piece.type !== 'n' && piece.type !== 'b') continue;
      if (!home.has(piece.square)) developed += 1;
    }
  }
  return developed;
}

export function strategyProfile(fen: string, color: Color): StrategyProfile {
  const game = new Chess(fen);
  const moves = movesForColor(fen, color);
  const king = kingSquare(game, color);

  return {
    center: moves.filter((move) => CENTER_SQUARES.has(move.to)).length,
    development: developmentCount(game, color),
    kingSafety: king
      ? (isCastled(game, color) ? 3 : 0) +
        (king[1] === (color === 'w' ? '1' : '8') ? 1 : 0) +
        pawnShield(game, color, king)
      : 0,
    space: moves.length,
  };
}

/**
 * 只返回“这步棋让哪个战略维度变好”，不返回静态标签。
 * 例如开局马 b1→c3：development +1，可能还有 center/space 增加。
 */
export function strategicNotes(beforeFen: string, move: StrategicMove): string[] {
  const after = new Chess(beforeFen);
  const made = after.move({
    from: move.from,
    to: move.to,
    promotion: move.promotion,
  });
  if (!made) return [];

  const before = strategyProfile(beforeFen, move.color);
  const current = strategyProfile(after.fen(), move.color);
  const notes: string[] = [];

  // 走到中心格本身就是最直观的“占据中心”，不需要等控制分数变化。
  if (CENTER_SQUARES.has(move.to)) notes.push('占据中心');
  if (current.center >= before.center + 2 && !notes.includes('占据中心')) {
    notes.push('占据中心');
  }
  if (current.development > before.development) notes.push('子力出动');
  if (current.kingSafety > before.kingSafety) notes.push('王的安全');
  if (current.space >= before.space + 2) notes.push('空间优势');

  // 先讲最直观的中心/出子，再讲王和空间；最多 3 条，推荐卡不会变成小作文。
  return notes.slice(0, 3);
}
