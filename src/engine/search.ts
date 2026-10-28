import { Chess } from 'chess.js';
import type { Move, PieceSymbol } from 'chess.js';

export type Level = 'beginner' | 'easy' | 'medium' | 'hard';

export interface LevelConfig {
  label: string;
  depth: number;
  timeMs: number;
  /** 入门/初级在评估接近的着法里带一点随机，避免每局完全一样。 */
  pickTop: number;
  scoreWindow: number;
}

export const LEVELS: Record<Level, LevelConfig> = {
  beginner: { label: '入门', depth: 1, timeMs: 250, pickTop: 3, scoreWindow: 160 },
  easy: { label: '初级', depth: 2, timeMs: 450, pickTop: 2, scoreWindow: 90 },
  medium: { label: '中级', depth: 3, timeMs: 900, pickTop: 1, scoreWindow: 0 },
  hard: { label: '进阶', depth: 4, timeMs: 1600, pickTop: 1, scoreWindow: 0 },
};

export interface SearchResult {
  from: string;
  to: string;
  promotion?: string;
  san: string;
  /** 白方视角的厘兵分；正数白优。 */
  scoreCp: number;
  mateIn?: number;
  depth: number;
  nodes: number;
  pv: string[];
}

/**
 * 教学引擎总览（写给正在学棋/学编程的人）：
 *
 * 1. 评估函数 evaluate：先数子力，再给“位置”加分（中心、兵推进、马象活跃、王安全）。
 * 2. Negamax：零和棋里，己方分数 = -对方分数，所以每一层都取反，代码只需要写一份。
 * 3. Alpha-Beta：如果一条分支已经差到对方不可能选，就整段剪掉，不改变结果但快很多。
 * 4. 静态搜索 quiescence：普通搜索到深度 0 就停，可能停在“刚吃完一个子、还没被吃回来”的假优势上；
 *    这里继续只算吃子/应将，直到局面安静，减少“地平线效应”。
 * 5. 迭代加深：先算浅一层，再算深一层；时间到了就用上一层结果，保证永远有合法着法可走。
 * 6. MultiPV：教学推荐需要“最佳 + 备选”，所以根节点对每个候选都做完整窗口搜索，拿精确分数。
 */

const PIECE_VALUE: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

const MATE = 100_000;
const INF = 1_000_000;

class SearchTimeout extends Error {}

interface ScoredMove {
  move: Move;
  score: number;
}

/**
 * 位置分：以棋盘中心 (3.5, 3.5) 为原点，越靠近中心分越高。
 * 这不是精确的 Stockfish 评估，而是教学引擎能解释、能快速算的近似。
 */
function centerValue(file: number, rank: number): number {
  return 7 - Math.abs(file - 3.5) - Math.abs(rank - 3.5);
}

/**
 * 按棋子类型给位置分：
 * - 兵：越靠前越好，同时鼓励占中心；
 * - 马：中心价值最高，边线扣分；
 * - 象：中心 + 中局活跃；
 * - 车：白方到第 7 横线、黑方到第 2 横线加分；
 * - 后：轻微中心倾向；
 * - 王：开局留在底线，残局才鼓励出来。
 */
function positional(
  type: string,
  color: 'w' | 'b',
  file: number,
  rank: number,
  opening: boolean,
): number {
  const center = centerValue(file, rank);
  switch (type) {
    case 'p': {
      const advance = color === 'w' ? rank - 2 : 7 - rank;
      return advance * 7 + center * 3;
    }
    case 'n':
      return center * 9 + (rank >= 3 && rank <= 6 ? 6 : -8);
    case 'b':
      return center * 4 + (rank >= 3 && rank <= 6 ? 4 : 0);
    case 'r':
      return (color === 'w' ? rank === 7 : rank === 2) ? 18 : 0;
    case 'q':
      return center * 2;
    case 'k':
      return opening
        ? rank === (color === 'w' ? 1 : 8)
          ? 18
          : 0
        : center * 4;
    default:
      return 0;
  }
}

/** 白方视角评估；搜索里再按行棋方取反。 */
function evaluate(game: Chess): number {
  // 子力是评估的地基：兵 100、马 320、象 330、车 500、后 900。
  // 位置分只在这一层上做加减，保证“多一个车”永远比“马在中心”重要。
  let score = 0;
  let nonPawnMaterial = 0;
  const bishops = { w: 0, b: 0 };

  for (const row of game.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const file = piece.square.charCodeAt(0) - 97;
      const rank = Number(piece.square[1]);
      const sign = piece.color === 'w' ? 1 : -1;
      score += sign * PIECE_VALUE[piece.type];
      if (piece.type !== 'p' && piece.type !== 'k') {
        nonPawnMaterial += PIECE_VALUE[piece.type];
      }
      if (piece.type === 'b') bishops[piece.color] += 1;
      if (piece.type !== 'k') {
        score += sign * positional(piece.type, piece.color, file, rank, true);
      }
    }
  }

  const opening = nonPawnMaterial > 2600;
  // 王的位置单独算，避免开局把王算成中心子。
  for (const row of game.board()) {
    for (const piece of row) {
      if (piece?.type !== 'k') continue;
      const file = piece.square.charCodeAt(0) - 97;
      const rank = Number(piece.square[1]);
      const sign = piece.color === 'w' ? 1 : -1;
      score += sign * positional('k', piece.color, file, rank, opening);
    }
  }

  if (bishops.w >= 2) score += 18;
  if (bishops.b >= 2) score -= 18;
  return score;
}

function evaluateForSide(game: Chess): number {
  const value = evaluate(game);
  return game.turn() === 'w' ? value : -value;
}

/**
 * 走法排序：Alpha-Beta 的剪枝效率高度依赖“先搜好棋”。
 * 这里用 MVV-LVA（被吃子价值高、攻击子价值低优先）和升变/易位给一个粗略排序，
 * 不追求完美，只保证吃大子、升变、易位先被看到。
 */
function orderedMoves(game: Chess, capturesOnly = false): Move[] {
  const moves = game.moves({ verbose: true });
  const filtered = capturesOnly
    ? moves.filter((move) => Boolean(move.captured) || Boolean(move.promotion))
    : moves;

  return filtered.sort((a, b) => {
    const score = (move: Move): number => {
      let value = 0;
      if (move.captured) value += 10 * PIECE_VALUE[move.captured] - PIECE_VALUE[move.piece];
      if (move.promotion) value += PIECE_VALUE[move.promotion];
      if (move.flags.includes('k') || move.flags.includes('q')) value += 60;
      return value;
    };
    return score(b) - score(a);
  });
}

function checkDeadline(deadline: number): void {
  if (Date.now() > deadline) throw new SearchTimeout();
}

/**
 * 静态搜索（quiescence）：
 * 到叶子节点时，如果还有吃子，就直接评估会漏掉“对方下一步吃回来”。
 * 这里用“站着不动”的分数作为下限，再继续搜索吃子（被将军时必须搜所有应将）；
 * 这样引擎不会因为深度刚好停在吃子前，而误以为白赚一个子。
 */
function quiescence(
  game: Chess,
  alpha: number,
  beta: number,
  ply: number,
  deadline: number,
  depth: number,
): number {
  checkDeadline(deadline);
  if (game.isCheckmate()) return -MATE + ply;
  if (game.isDraw()) return 0;

  const standPat = evaluateForSide(game);
  if (depth >= 6) return standPat;
  if (standPat >= beta) return beta;
  const inCheck = game.isCheck();
  if (!inCheck && standPat > alpha) alpha = standPat;

  let best = inCheck ? -INF : standPat;
  for (const move of orderedMoves(game, !inCheck)) {
    game.move({ from: move.from, to: move.to, promotion: move.promotion });
    const score = -quiescence(game, -beta, -alpha, ply + 1, deadline, depth + 1);
    game.undo();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * Negamax + Alpha-Beta：
 * - 分数始终从“当前行棋方”视角看，所以递归时用 -score；
 * - alpha 是“我已经能保证的下限”，beta 是“对方不会让我超过的上限”；
 * - 一旦 alpha >= beta，当前分支不可能影响最终决策，直接剪掉。
 * 将杀分数减去 ply，让“更快将杀”比“更慢将杀”更高。
 */
function negamax(
  game: Chess,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  deadline: number,
): number {
  checkDeadline(deadline);
  if (game.isCheckmate()) return -MATE + ply;
  if (game.isDraw()) return 0;
  if (depth <= 0) return quiescence(game, alpha, beta, ply, deadline, 0);

  let best = -INF;
  for (const move of orderedMoves(game)) {
    game.move({ from: move.from, to: move.to, promotion: move.promotion });
    const score = -negamax(game, depth - 1, -beta, -alpha, ply + 1, deadline);
    game.undo();

    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * 根节点搜索。
 *
 * exact=false：普通 AI 用，后续根着法用 -alpha 作为上界，能剪枝，分数只保证“够用”；
 * exact=true：教学推荐用，每个根着法都用完整窗口，拿到可比较的精确分数，
 * 这样“最佳 +0.4、备选 +0.1、备选 -1.3”才是真的分数差，而不是剪枝出来的上界。
 */
function searchRoot(
  game: Chess,
  depth: number,
  deadline: number,
  exact = false,
): { scored: ScoredMove[]; nodes: number } {
  const scored: ScoredMove[] = [];
  let alpha = -INF;
  const nodes = { count: 0 };

  for (const move of orderedMoves(game)) {
    game.move({ from: move.from, to: move.to, promotion: move.promotion });
    const score = -negamax(
      game,
      depth - 1,
      -INF,
      exact ? INF : -alpha,
      1,
      deadline,
    );
    game.undo();
    scored.push({ move, score });
    if (score > alpha) alpha = score;
    nodes.count += 1;
  }

  scored.sort((a, b) => b.score - a.score);
  return { scored, nodes: nodes.count };
}

/**
 * AI 实际走子入口：
 * 迭代加深 1..目标深度；时间到就停止，保留上一层完整结果。
 * 入门/初级会在“分数接近的候选”里随机挑一个，避免每盘第一着都一模一样；
 * 中高级直接用最高分，减少送子。
 */
export function findBestMove(fen: string, level: Level): SearchResult | null {
  const game = new Chess(fen);
  const config = LEVELS[level];
  const legal = game.moves({ verbose: true });
  if (legal.length === 0) return null;

  const deadline = Date.now() + config.timeMs;
  let completedDepth = 0;
  let scored: ScoredMove[] | null = null;

  for (let depth = 1; depth <= config.depth; depth += 1) {
    try {
      const result = searchRoot(game, depth, deadline);
      scored = result.scored;
      completedDepth = depth;
      if (Math.abs(result.scored[0].score) > MATE - 1000) break;
    } catch (error) {
      if (!(error instanceof SearchTimeout)) throw error;
      break;
    }
  }

  if (!scored || scored.length === 0) {
    const fallback = legal[0];
    return {
      from: fallback.from,
      to: fallback.to,
      promotion: fallback.promotion,
      san: fallback.san,
      scoreCp: 0,
      depth: 1,
      nodes: 1,
      pv: [fallback.san],
    };
  }

  const bestScore = scored[0].score;
  const candidates = scored
    .slice(0, Math.max(1, config.pickTop))
    .filter((entry) => bestScore - entry.score <= config.scoreWindow);
  const chosen = candidates[Math.floor(Math.random() * candidates.length)] ?? scored[0];

  const fromWhite = game.turn() === 'w' ? chosen.score : -chosen.score;
  const isMate = Math.abs(chosen.score) > MATE - 1000;
  const mateIn = isMate ? Math.ceil((MATE - Math.abs(chosen.score)) / 2) : undefined;

  return {
    from: chosen.move.from,
    to: chosen.move.to,
    promotion: chosen.move.promotion,
    san: chosen.move.san,
    scoreCp: fromWhite,
    mateIn,
    depth: completedDepth || 1,
    nodes: scored.length,
    pv: [chosen.move.san],
  };
}

export interface SearchLine {
  from: string;
  to: string;
  promotion?: string;
  san: string;
  scoreCp: number;
  mateIn?: number;
  depth: number;
  /** 用于教学文案：哪枚子、吃掉了什么。 */
  piece?: PieceSymbol;
  captured?: PieceSymbol;
}

export type CandidateTerminal = 'none' | 'checkmate' | 'draw';

/**
 * “如果走这步”的推演结果：先强制走候选着法，再让引擎给对手最佳应招，
 * 最后再给玩家一步后续。它只用于教学预览，不修改真实棋局。
 */
export interface CandidateAnalysis {
  from: string;
  to: string;
  promotion?: string;
  forcedSan: string;
  afterFen: string;
  /** 当前局面的引擎最佳着法；用于判断候选着法掉了多少分。 */
  best: SearchLine | null;
  bestScoreCp: number;
  reply: SearchLine | null;
  replyFen: string | null;
  next: SearchLine | null;
  /** 白方视角的候选着法评分（由对手最佳应招反推）。 */
  candidateScoreCp: number;
  terminal: CandidateTerminal;
  depth: number;
}


/**
 * 教学推荐入口：
 * 不做随机，返回精确评分的前 N 条根着法。
 * 用 1.2 秒的硬上限 + 深度 2，保证玩家走完一步后右侧推荐能迅速出现；
 * 这不是“最强引擎”，而是“能稳定解释的教练”。
 */
export function findTopMoves(
  fen: string,
  level: Level,
  count = 3,
): SearchLine[] {
  const game = new Chess(fen);
  const config = LEVELS[level];
  if (game.moves({ verbose: true }).length === 0) return [];

  const deadline = Date.now() + Math.max(config.timeMs, 1200);
  let completedDepth = 0;
  let scored: ScoredMove[] | null = null;

  for (let depth = 1; depth <= config.depth; depth += 1) {
    try {
      const result = searchRoot(game, depth, deadline, true);
      scored = result.scored;
      completedDepth = depth;
      if (Math.abs(result.scored[0].score) > MATE - 1000) break;
    } catch (error) {
      if (!(error instanceof SearchTimeout)) throw error;
      break;
    }
  }

  if (!scored) return [];
  const fromWhite = (score: number) => (game.turn() === 'w' ? score : -score);

  return scored.slice(0, count).map(({ move, score }) => {
    const isMate = Math.abs(score) > MATE - 1000;
    return {
      from: move.from,
      to: move.to,
      promotion: move.promotion,
      san: move.san,
      scoreCp: fromWhite(score),
      mateIn: isMate ? Math.ceil((MATE - Math.abs(score)) / 2) : undefined,
      depth: completedDepth || 1,
      piece: move.piece,
      captured: move.captured,
    };
  });
}

/**
 * Step 5 多步推演：
 * 1. 在副本里强制走玩家候选着法；
 * 2. 让引擎在“走完后”的局面给对手最佳应招；
 * 3. 再给玩家一步后续，形成“你走 → 对方应 → 你下一步”的教学线。
 *
 * 返回的 candidateScoreCp 是白方视角；UI 用“当前最佳评分 - 候选评分”
 * 判断这步是否明显掉分，不靠关键词硬猜。
 */
export function analyzeCandidate(
  fen: string,
  from: string,
  to: string,
  promotion: string | undefined,
  level: Level = 'easy',
): CandidateAnalysis | null {
  const game = new Chess(fen);
  const baseline = findTopMoves(fen, level, 1)[0] ?? null;
  const made = game.move({ from, to, promotion });
  if (!made) return null;

  const afterFen = game.fen();
  const replies = findTopMoves(afterFen, level, 1);
  const reply = replies[0] ?? null;
  let replyFen: string | null = null;
  let next: SearchLine | null = null;

  if (reply) {
    const nextGame = new Chess(afterFen);
    const madeReply = nextGame.move({
      from: reply.from,
      to: reply.to,
      promotion: reply.promotion,
    });
    if (madeReply) {
      replyFen = nextGame.fen();
      next = findTopMoves(replyFen, level, 1)[0] ?? null;
    }
  }

  const after = new Chess(afterFen);
  let terminal: CandidateTerminal = 'none';
  let candidateScoreCp = reply?.scoreCp ?? 0;
  if (!reply) {
    if (after.isCheckmate()) {
      terminal = 'checkmate';
      candidateScoreCp = made.color === 'w' ? MATE : -MATE;
    } else if (after.isDraw() || after.isStalemate()) {
      terminal = 'draw';
      candidateScoreCp = 0;
    }
  }

  return {
    from,
    to,
    promotion: made.promotion,
    forcedSan: made.san,
    afterFen,
    best: baseline,
    bestScoreCp: baseline?.scoreCp ?? 0,
    reply,
    replyFen,
    next,
    candidateScoreCp,
    terminal,
    depth: reply?.depth ?? 0,
  };
}
