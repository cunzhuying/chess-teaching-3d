import { Chess } from 'chess.js';
import type { Color, PieceSymbol, Square } from 'chess.js';
import { pieceNameZh, sideNameZh } from '../domain/notation';
import type { AttackRelation, PieceInfo, ThreatInfo, ThreatLevel } from '../domain/types';

/**
 * 攻击图与 SEE（静态交换评估）——Step 4 的教学核心。
 *
 * 新手最容易混淆两件事：
 * 1. “这个子攻击那个格”不等于“我现在真的能吃掉它”：
 *    - 被钉住的子不能随便离开，否则自己的王会被将军；
 *    - 不是当前行棋方时，攻击只是“潜在威胁”。
 * 2. “队友在保护我”也不等于“我一定能安全吃回来”：
 *    - 保护子可能被钉住，可能被更便宜的子先吃掉。
 *
 * 这里的折中：
 * - 威胁：用 chess.js 的“合法吃子”生成，尽量不产生假威胁；
 * - 保护：用伪合法攻击（包含己方棋子格），因为 chess.js 不会生成“吃自己人”的着法；
 * - SEE：用子力价值模拟“你吃、我吃回、你再吃”的交换，给威胁分级。
 */

const VALUES: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

const KNIGHT_OFFSETS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

const KING_OFFSETS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

const BISHOP_DIRECTIONS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ROOK_DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export interface AttackMap {
  threats: ThreatInfo[];
  protections: AttackRelation[];
  threatsAgainst: (square: Square) => ThreatInfo[];
  threatsBy: (square: Square) => ThreatInfo[];
  protectionsOf: (square: Square) => AttackRelation[];
  protectsBy: (square: Square) => AttackRelation[];
}

function fileIndex(square: Square): number {
  return square.charCodeAt(0) - 97;
}

function rankNumber(square: Square): number {
  return Number(square[1]);
}

function squareAt(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return `${String.fromCharCode(97 + file)}${rank}` as Square;
}

/**
 * 把 FEN 的行棋方翻到指定颜色，再生成着法。
 *
 * 为什么需要它？
 * chess.js 的 moves() 只给“当前行棋方”的合法着法；
 * 但我们站在白方视角时，也要知道黑方现在能吃什么。
 * 复制一份棋局、只改 FEN 的 turn 字段，就能问“如果现在轮到黑方，它能怎么走”，
 * 同时仍保留易位权、吃过路兵目标等局面信息。
 */
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

function boardMap(fen: string): Map<Square, PieceInfo> {
  const game = new Chess(fen);
  const map = new Map<Square, PieceInfo>();
  for (const row of game.board()) {
    for (const piece of row) {
      if (piece) {
        map.set(piece.square, {
          square: piece.square,
          type: piece.type,
          color: piece.color,
        });
      }
    }
  }
  return map;
}

/**
 * 伪合法攻击：只按棋子走法/阻挡生成，不检查“走完自己王是否被将”。
 * 唯一用途是回答“谁在保护谁”，所以允许把己方棋子所在格也放进结果。
 * 真正的威胁不要用它——威胁必须走 legalCaptureKeys 的合法吃子。
 */
function pseudoAttacks(
  board: Map<Square, PieceInfo>,
  from: Square,
  piece: PieceInfo,
): Square[] {
  const result: Square[] = [];
  const file = fileIndex(from);
  const rank = rankNumber(from);

  const add = (f: number, r: number) => {
    const square = squareAt(f, r);
    if (square) result.push(square);
  };
  const slide = (directions: number[][]) => {
    for (const [df, dr] of directions) {
      let f = file + df;
      let r = rank + dr;
      while (true) {
        const square = squareAt(f, r);
        if (!square) break;
        result.push(square);
        if (board.has(square)) break;
        f += df;
        r += dr;
      }
    }
  };

  switch (piece.type) {
    case 'p': {
      const forward = piece.color === 'w' ? 1 : -1;
      add(file - 1, rank + forward);
      add(file + 1, rank + forward);
      break;
    }
    case 'n':
      for (const [df, dr] of KNIGHT_OFFSETS) add(file + df, rank + dr);
      break;
    case 'b':
      slide(BISHOP_DIRECTIONS);
      break;
    case 'r':
      slide(ROOK_DIRECTIONS);
      break;
    case 'q':
      slide([...BISHOP_DIRECTIONS, ...ROOK_DIRECTIONS]);
      break;
    case 'k':
      for (const [df, dr] of KING_OFFSETS) add(file + df, rank + dr);
      break;
  }

  return [...new Set(result)];
}

/**
 * SEE 的递归核心：
 *
 * 假设目标格上现在有一个价值 targetValue 的子。
 * 攻击方先用最便宜的子吃，防守方再用最便宜的子吃回……
 * 每一步都问“我吃这一下，扣掉对方可能吃回的价值，还赚不赚”。
 *
 * 例子：白兵吃黑马（马 3），黑车吃回白兵（兵 1）：
 *   白赚 3 - 1 = 2，所以对白方 SEE ≈ +200。
 * 如果黑马有保护，白兵吃马后会被吃回，白方最多赚 1-?，威胁等级就会下降。
 *
 * 注意：这是教学近似，不处理“被钉住的保护子”和“王不能走进被将格”的全部细节。
 */
function seeCapture(
  attackers: PieceInfo[],
  defenders: PieceInfo[],
  targetValue: number,
  depth = 0,
): number {
  if (attackers.length === 0 || depth > 8) return 0;

  const sortedAttackers = [...attackers]
    .filter((piece) => piece.type !== 'k')
    .sort((a, b) => VALUES[a.type] - VALUES[b.type]);
  const sortedDefenders = [...defenders]
    .filter((piece) => piece.type !== 'k')
    .sort((a, b) => VALUES[a.type] - VALUES[b.type]);

  if (sortedAttackers.length === 0) return 0;
  const attacker = sortedAttackers[0];
  const remaining = sortedAttackers.slice(1);
  const recapture = seeCapture(
    sortedDefenders,
    remaining,
    VALUES[attacker.type],
    depth + 1,
  );
  return Math.max(0, targetValue - recapture);
}

function levelForThreat(target: PieceInfo, see: number, defended: boolean): ThreatLevel {
  if (target.type === 'k') return 'high';
  if (see >= 300) return 'high';
  if (see >= 100) return 'medium';
  if (!defended && VALUES[target.type] >= 3) return 'high';
  return 'low';
}

export function buildAttackMap(fen: string): AttackMap {
  const board = boardMap(fen);
  // 一次性生成双方合法着法，避免每个棋子都复制一次棋局。
  const legalMoves = {
    w: movesForColor(fen, 'w'),
    b: movesForColor(fen, 'b'),
  };
  // 合法吃子的键：颜色 + 起点 + 终点。后面只有命中这里的攻击才算真威胁。
  const legalCaptureKeys = new Set<string>();
  for (const color of ['w', 'b'] as Color[]) {
    for (const move of legalMoves[color]) {
      if (!move.captured) continue;
      legalCaptureKeys.add(`${color}:${move.from}:${move.to}`);
    }
  }

  const threats: ThreatInfo[] = [];
  const protections: AttackRelation[] = [];

  for (const [from, attacker] of board) {
    const targets = pseudoAttacks(board, from, attacker);
    for (const to of targets) {
      const target = board.get(to);
      if (!target || target.square === from) continue;

      if (target.color !== attacker.color) {
        // 只有“合法吃子”才记成威胁；被钉住的子会在这里被过滤掉。
        const key = `${attacker.color}:${from}:${to}`;
        if (!legalCaptureKeys.has(key)) continue;

        // 攻击方：所有能合法吃到 to 的同色子。
        // 防守方：所有伪合法攻击到 to 的同色子（近似“谁能吃回来”）。
        const attackers = legalMoves[attacker.color]
          .filter((move) => move.to === to && move.captured)
          .map((move) => board.get(move.from))
          .filter((piece): piece is PieceInfo => Boolean(piece));
        const defenders = [...board.values()].filter(
          (piece) =>
            piece.color === target.color &&
            piece.square !== target.square &&
            pseudoAttacks(board, piece.square, piece).includes(to),
        );
        const see = seeCapture(attackers, defenders, VALUES[target.type]);
        const defended = defenders.length > 0;
        const relation: ThreatInfo = {
          from,
          to,
          attacker,
          target,
          see,
          defended,
          level: levelForThreat(target, see, defended),
        };
        threats.push(relation);
      } else {
        protections.push({ from, to, attacker, target });
      }
    }
  }

  return {
    threats,
    protections,
    threatsAgainst: (square) => threats.filter((threat) => threat.target.square === square),
    threatsBy: (square) => threats.filter((threat) => threat.attacker.square === square),
    protectionsOf: (square) =>
      protections.filter((relation) => relation.target.square === square),
    protectsBy: (square) =>
      protections.filter((relation) => relation.attacker.square === square),
  };
}

export interface PieceInsight {
  piece: PieceInfo;
  isOwn: boolean;
  value: number;
  summary: string;
  points: string[];
  threats: ThreatInfo[];
  protectedBy: AttackRelation[];
  protects: AttackRelation[];
  attacks: ThreatInfo[];
  level: ThreatLevel;
}

export function levelZh(level: ThreatLevel): string {
  return level === 'high' ? '高' : level === 'medium' ? '中' : '低';
}

function pieceLabel(piece: PieceInfo): string {
  return `${sideNameZh(piece.color)}${pieceNameZh(piece.type)} ${piece.square}`;
}

function threatSentence(threat: ThreatInfo): string {
  return `${pieceLabel(threat.attacker)} → 你的${pieceNameZh(threat.target.type)} ${threat.to}（${levelZh(threat.level)}）`;
}

/**
 * 单个棋子的教学解析。
 * isOwn 决定文案重点：
 * - 己方：我被谁威胁、谁保护我、我能吃谁、我有什么推荐；
 * - 敌方：它在威胁我的谁、它有没有保护、我该怎么应对。
 * 最后统一成“一句总结 + 2~3 条要点”，避免新手被长文案淹没。
 */
export function analyzePiece(
  fen: string,
  square: Square,
  viewColor: Color,
): PieceInsight | null {
  const game = new Chess(fen);
  const piece = game.get(square);
  if (!piece) return null;

  const info: PieceInfo = {
    square,
    type: piece.type,
    color: piece.color,
  };
  const map = buildAttackMap(fen);
  const isOwn = piece.color === viewColor;
  const attacksAgainst = map.threatsAgainst(square);
  const attacksByPiece = map.threatsBy(square);
  const protectedBy = map.protectionsOf(square);
  const protects = map.protectsBy(square);

  const values = attacksAgainst.filter((threat) => threat.target.square === square);
  const level = values.reduce<ThreatLevel>(
    (current, threat) =>
      threat.level === 'high'
        ? 'high'
        : threat.level === 'medium' && current !== 'high'
          ? 'medium'
          : current,
    'low',
  );

  const points: string[] = [];
  let summary = '';

  if (isOwn) {
    summary = `你的${pieceNameZh(info.type)}在 ${square}，价值 ${VALUES[info.type]}。`;
    if (attacksAgainst.length > 0) {
      summary += `它正被${attacksAgainst
        .slice(0, 2)
        .map((threat) => `${pieceLabel(threat.attacker)}盯住`)
        .join('、')}。`;
    } else {
      summary += '目前没有对方棋子能直接吃掉它。';
    }

    points.push(
      attacksAgainst.length > 0
        ? `威胁：${attacksAgainst.slice(0, 2).map(threatSentence).join('；')}`
        : '威胁：暂时没有被直接攻击。',
    );

    const defenderText = protectedBy.length
      ? protectedBy
          .slice(0, 2)
          .map((relation) => `${pieceNameZh(relation.attacker.type)} ${relation.attacker.square}`)
          .join('、')
      : '';
    points.push(
      defenderText
        ? `保护：${defenderText}在保护它${protects.length ? `；它也保护了${protects.slice(0, 2).map((relation) => `${pieceNameZh(relation.target.type)} ${relation.target.square}`).join('、')}` : ''}。`
        : `保护：没有队友保护它${protects.length ? `；它保护了${protects.slice(0, 2).map((relation) => `${pieceNameZh(relation.target.type)} ${relation.target.square}`).join('、')}` : ''}。`,
    );

    if (attacksByPiece.length > 0) {
      points.push(
        `进攻：可以吃掉${attacksByPiece
          .slice(0, 2)
          .map((threat) => `${pieceNameZh(threat.target.type)} ${threat.target.square}（${levelZh(threat.level)}）`)
          .join('、')}。`,
      );
    } else {
      points.push('进攻：暂时没有可以吃的对方棋子。');
    }
  } else {
    summary = `这是${sideNameZh(info.color)}的${pieceNameZh(info.type)}，位于 ${square}，价值 ${VALUES[info.type]}。`;
    if (attacksByPiece.length > 0) {
      summary += `它正在威胁你的${attacksByPiece
        .slice(0, 2)
        .map((threat) => `${pieceNameZh(threat.target.type)} ${threat.target.square}`)
        .join('、')}。`;
    } else {
      summary += '它暂时没有直接威胁你的棋子。';
    }

    points.push(
      attacksByPiece.length > 0
        ? `威胁：${attacksByPiece.slice(0, 2).map(threatSentence).join('；')}`
        : '威胁：它暂时没有盯住你的棋子。',
    );

    const defenders = protectedBy.length
      ? protectedBy
          .slice(0, 2)
          .map((relation) => `${pieceNameZh(relation.attacker.type)} ${relation.attacker.square}`)
          .join('、')
      : '';
    points.push(
      defenders
        ? `保护：${defenders}在保护它，直接交换未必划算。`
        : '保护：它没有队友保护，如果有合适机会可以考虑吃掉它。',
    );

    if (attacksByPiece.length > 0) {
      const target = attacksByPiece[0].target;
      const targetDefended = map.protectionsOf(target.square).length > 0;
      points.push(
        targetDefended
          ? `应对：先移开${pieceNameZh(target.type)} ${target.square}，或加强保护，不要白送。`
          : `应对：${pieceNameZh(target.type)} ${target.square} 没有保护，建议移开或派子保护。`,
      );
    } else {
      points.push('应对：暂时不用专门处理它，继续发展自己的棋子。');
    }
  }

  return {
    piece: info,
    isOwn,
    value: VALUES[info.type],
    summary,
    points,
    threats: attacksAgainst,
    protectedBy,
    protects,
    attacks: attacksByPiece,
    level,
  };
}
