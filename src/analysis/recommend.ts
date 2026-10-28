import { Chess } from 'chess.js';
import type { Move } from 'chess.js';
import { formatMoveZh, PIECE_NAME_ZH } from '../domain/notation';
import type { LegalMove, Recommendation } from '../domain/types';
import type { SearchLine } from '../engine/search';
import { strategicNotes } from './strategy';

function toLegalMove(move: Move): LegalMove {
  const flags = move.flags;
  const isEnPassant = flags.includes('e');
  return {
    from: move.from,
    to: move.to,
    piece: move.piece,
    color: move.color,
    captured: move.captured,
    promotion: move.promotion,
    flags,
    san: move.san,
    isCapture: flags.includes('c') || isEnPassant,
    isEnPassant,
    isCastle: flags.includes('k') ? 'k' : flags.includes('q') ? 'q' : null,
    isPromotion: flags.includes('p'),
  };
}

/**
 * 推荐卡文案分两层：
 * - reasons：这步棋“立刻做了什么”（吃子、将军、易位、升变）；
 * - strategy：这步棋“长期改善了哪个大局维度”（中心/出子/王安全/空间）。
 *
 * 推荐顺序和分数完全来自引擎根着法，文案只做“翻译”，不重新发明最佳着法。
 */
function reasonsFor(move: Move): string[] {
  const reasons: string[] = [];
  if (move.captured) reasons.push(`吃掉${PIECE_NAME_ZH[move.captured]}`);
  if (move.flags.includes('k') || move.flags.includes('q')) reasons.push('完成易位');
  if (move.promotion) reasons.push(`升变为${PIECE_NAME_ZH[move.promotion]}`);
  if (move.san.includes('#')) reasons.push('将杀');
  else if (move.san.includes('+')) reasons.push('将军');

  if (reasons.length === 0) {
    if (move.piece === 'p') reasons.push('推进兵');
    else if (move.piece === 'n' || move.piece === 'b') reasons.push('发展棋子');
    else reasons.push('调整棋子');
  }
  return [...new Set(reasons)].slice(0, 2);
}

/**
 * 只消费引擎已经评估过的根着法；推荐顺序、评分均来自引擎，文案只补充走法特征。
 */
export function buildRecommendations(
  fen: string,
  lines: SearchLine[],
): Recommendation[] {
  const game = new Chess(fen);
  const legal = game.moves({ verbose: true });
  const bestScore = lines[0]?.scoreCp ?? 0;

  const results: Array<Recommendation | null> = lines.map((line, index) => {
      const move = legal.find(
        (candidate) =>
          candidate.from === line.from &&
          candidate.to === line.to &&
          candidate.promotion === line.promotion,
      );
      if (!move) return null;

      const gap = Math.abs(bestScore - line.scoreCp);
      const risk = gap <= 30 ? 'low' : gap <= 90 ? 'medium' : 'high';

      return {
        move: toLegalMove(move),
        rank: index + 1,
        scoreCp: line.scoreCp,
        mateIn: line.mateIn,
        label: formatMoveZh({
          piece: move.piece,
          from: move.from,
          to: move.to,
          captured: move.captured,
          promotion: move.promotion,
          flags: move.flags,
        }),
        reasons: reasonsFor(move),
        strategy: strategicNotes(fen, move),
        risk,
      } satisfies Recommendation;
    });

  return results.filter((item): item is Recommendation => item !== null);
}
