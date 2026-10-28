import { Chess } from 'chess.js';
import type { Move, Square } from 'chess.js';
import { formatMoveZh, sideNameZh } from './notation';
import type {
  GameResult,
  LegalMove,
  MovePreview,
  MoveRecord,
  PieceInfo,
  PieceType,
  PositionSnapshot,
  Side,
} from './types';

export type MoveOutcome =
  | { ok: true; record: MoveRecord }
  | { ok: false; needsPromotion: true; from: Square; to: Square; choices: PieceType[] }
  | { ok: false; needsPromotion?: false; error: string };

const PROMOTION_CHOICES: PieceType[] = ['q', 'r', 'b', 'n'];

function castleRook(color: Side, side: 'k' | 'q'): { from: Square; to: Square } {
  if (color === 'w') {
    return side === 'k' ? { from: 'h1', to: 'f1' } : { from: 'a1', to: 'd1' };
  }
  return side === 'k' ? { from: 'h8', to: 'f8' } : { from: 'a8', to: 'd8' };
}

/**
 * 规则唯一真源：所有合法性都来自 chess.js。
 * UI、3D 场景、AI 只能消费这里的结果，不得自行判断走法。
 */
export class GameController {
  private game: Chess;
  private records: MoveRecord[] = [];

  constructor(fen?: string) {
    this.game = fen ? new Chess(fen) : new Chess();
  }

  get fen(): string {
    return this.game.fen();
  }

  get turn(): Side {
    return this.game.turn();
  }

  get inCheck(): boolean {
    return this.game.isCheck();
  }

  get history(): readonly MoveRecord[] {
    return this.records;
  }

  get lastRecord(): MoveRecord | undefined {
    return this.records[this.records.length - 1];
  }

  /** 用于分析缓存键：去掉半回合钟和回合数，保留易位/吃过路兵权。 */
  get positionKey(): string {
    const [placement, turn, castling, enPassant] = this.game.fen().split(' ');
    return `${placement} ${turn} ${castling} ${enPassant}`;
  }

  get result(): GameResult | null {
    if (this.game.isCheckmate()) {
      const winner: Side = this.game.turn() === 'w' ? 'b' : 'w';
      return {
        reason: 'checkmate',
        winner,
        label: `${sideNameZh(winner)}获胜 · 将死`,
      };
    }
    if (this.game.isStalemate()) {
      return { reason: 'stalemate', winner: null, label: '和棋 · 逼和' };
    }
    if (this.game.isInsufficientMaterial()) {
      return { reason: 'insufficient', winner: null, label: '和棋 · 子力不足' };
    }
    if (this.game.isThreefoldRepetition()) {
      return { reason: 'threefold', winner: null, label: '和棋 · 三次重复局面' };
    }
    if (this.game.isDrawByFiftyMoves()) {
      return { reason: 'fifty', winner: null, label: '和棋 · 五十回合规则' };
    }
    if (this.game.isDraw()) {
      return { reason: 'draw', winner: null, label: '和棋' };
    }
    return null;
  }

  pieceAt(square: Square): PieceInfo | undefined {
    const piece = this.game.get(square);
    if (!piece) return undefined;
    return { square, type: piece.type, color: piece.color };
  }

  legalMoves(): LegalMove[] {
    return this.verboseMoves().map((move) => this.toLegalMove(move));
  }

  legalMovesFrom(square: Square): LegalMove[] {
    try {
      return this.game
        .moves({ square, verbose: true })
        .map((move) => this.toLegalMove(move));
    } catch {
      return [];
    }
  }

  /**
   * 预览一步棋，不修改棋局。
   * 3D 虚影、威胁连线和“点第一次预览、点第二次确认”都依赖它。
   */
  preview(from: Square, to: Square): MovePreview | null {
    const candidates = this.verboseMoves().filter(
      (move) => move.from === from && move.to === to,
    );
    if (candidates.length === 0) return null;

    // 升变预览默认展示“后”，实际升变由玩家在弹窗里决定。
    const chosen = candidates.find((move) => move.promotion === 'q') ?? candidates[0];
    const base = this.toLegalMove(chosen);

    let capturedSquare: Square | undefined;
    if (base.isEnPassant) {
      // 吃过路兵：被吃兵在 to 的文件、from 的横线上。
      capturedSquare = `${base.to[0]}${base.from[1]}` as Square;
    } else if (base.captured) {
      capturedSquare = base.to;
    }

    return {
      ...base,
      capturedSquare,
      rook: base.isCastle ? castleRook(base.color, base.isCastle) : undefined,
      promotionChoices: base.isPromotion ? [...PROMOTION_CHOICES] : undefined,
    };
  }

  /**
   * 只计算“如果走这步”之后的 FEN，不修改真实棋局。
   *
   * 虚影上的威胁/保护线需要一个完整的假想局面：
   * - 被吃的子要移除；
   * - 易位要同时移动车；
   * - 吃过路兵要移除旁边的兵；
   * - 兵升变默认按“后”分析。
   * 交给 chess.js 的 make/unmake 复制局来做，避免 UI 自己改棋盘导致规则分叉。
   */
  previewFen(
    from: Square,
    to: Square,
    promotion: PieceType = 'q',
  ): string | null {
    const candidates = this.verboseMoves().filter(
      (move) => move.from === from && move.to === to,
    );
    if (candidates.length === 0) return null;

    const chosen =
      candidates.find((move) => move.promotion === promotion) ??
      candidates.find((move) => move.promotion === 'q') ??
      candidates[0];

    const clone = new Chess(this.game.fen());
    const made = clone.move({
      from,
      to,
      promotion: chosen.promotion,
    });
    return made ? clone.fen() : null;
  }

  move(from: Square, to: Square, promotion?: PieceType): MoveOutcome {
    const candidates = this.verboseMoves().filter(
      (move) => move.from === from && move.to === to,
    );
    if (candidates.length === 0) {
      return { ok: false, error: this.explainIllegal(from, to) };
    }

    const promotionMoves = candidates.filter((move) => Boolean(move.promotion));
    if (promotionMoves.length > 0 && !promotion) {
      return {
        ok: false,
        needsPromotion: true,
        from,
        to,
        choices: [...PROMOTION_CHOICES],
      };
    }

    const chosen =
      promotionMoves.length > 0
        ? promotionMoves.find((move) => move.promotion === promotion)
        : candidates[0];

    if (!chosen) {
      return { ok: false, error: '不支持的升变棋子' };
    }

    const made = this.game.move({ from, to, promotion: chosen.promotion });
    const record = this.makeRecord(made);
    this.records.push(record);
    return { ok: true, record };
  }

  undo(): MoveRecord | null {
    if (this.records.length === 0) return null;
    const undone = this.game.undo();
    if (!undone) return null;
    return this.records.pop() ?? null;
  }

  reset(fen?: string): void {
    this.game = fen ? new Chess(fen) : new Chess();
    this.records = [];
  }

  load(fen: string): void {
    this.reset(fen);
  }

  /**
   * 联机恢复：客人不重新推演规则，直接接受主机发来的 FEN + 完整历史。
   * 这是“主机权威”的关键：客户端只负责显示，不能自己改棋局。
   */
  restore(fen: string, records: MoveRecord[]): void {
    this.game = new Chess(fen);
    this.records = records.map((record) => ({ ...record }));
  }

  snapshot(): PositionSnapshot {
    const fen = this.game.fen();
    const fields = fen.split(' ');
    const board = this.game.board().map((row) =>
      row.map((piece) =>
        piece
          ? { square: piece.square, type: piece.type, color: piece.color }
          : null,
      ),
    );
    const inCheck = this.game.isCheck();

    return {
      fen,
      turn: this.game.turn(),
      board,
      legalMoves: this.legalMoves(),
      lastMove: this.lastRecord
        ? { from: this.lastRecord.from, to: this.lastRecord.to }
        : null,
      inCheck,
      checkSquare: inCheck ? this.findKing(this.game.turn()) : null,
      result: this.result,
      moveNumber: Number(fields[5] ?? 1),
      halfmoveClock: Number(fields[4] ?? 0),
    };
  }

  private verboseMoves(): Move[] {
    return this.game.moves({ verbose: true });
  }

  private toLegalMove(move: Move): LegalMove {
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

  private makeRecord(move: Move): MoveRecord {
    const before = move.before.split(' ');
    const isCheck = this.game.isCheck();
    const isMate = this.game.isCheckmate();
    const legal = this.toLegalMove(move);
    const capturedSquare = legal.isEnPassant
      ? (`${legal.to[0]}${legal.from[1]}` as Square)
      : legal.captured
        ? legal.to
        : undefined;
    const rook = legal.isCastle ? castleRook(legal.color, legal.isCastle) : undefined;

    return {
      ply: this.records.length + 1,
      moveNumber: Number(before[5] ?? 1),
      color: move.color,
      san: move.san,
      zh: formatMoveZh({
        piece: move.piece,
        from: move.from,
        to: move.to,
        captured: move.captured,
        promotion: move.promotion,
        flags: move.flags,
        isCheck,
        isMate,
      }),
      from: move.from,
      to: move.to,
      piece: move.piece,
      captured: move.captured,
      promotion: move.promotion,
      flags: move.flags,
      isCheck,
      isMate,
      fenAfter: move.after,
      capturedSquare,
      rook,
    };
  }

  private explainIllegal(from: Square, to: Square): string {
    const piece = this.game.get(from);
    if (!piece) return '该格没有棋子';
    if (piece.color !== this.game.turn()) {
      return `现在轮到${sideNameZh(this.game.turn())}走棋`;
    }
    const target = this.game.get(to);
    if (target && target.color === piece.color) {
      return '该格被己方棋子占据';
    }
    return '这步不符合走子规则，或走完后王会被将军';
  }

  private findKing(color: Side): Square | null {
    for (const row of this.game.board()) {
      for (const piece of row) {
        if (piece && piece.type === 'k' && piece.color === color) {
          return piece.square;
        }
      }
    }
    return null;
  }
}
