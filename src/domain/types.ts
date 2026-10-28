import type { Color, PieceSymbol, Square } from 'chess.js';

/** 执子方 */
export type Side = Color;
/** 棋子种类：p 兵 / n 马 / b 象 / r 车 / q 后 / k 王 */
export type PieceType = PieceSymbol;

export interface PieceInfo {
  square: Square;
  type: PieceType;
  color: Side;
}

/** 一步合法着法的完整语义。3D 层只消费这个结构，不自己判断规则。 */
export interface LegalMove {
  from: Square;
  to: Square;
  piece: PieceType;
  color: Side;
  captured?: PieceType;
  promotion?: PieceType;
  flags: string;
  san: string;
  isCapture: boolean;
  isEnPassant: boolean;
  isCastle: 'k' | 'q' | null;
  isPromotion: boolean;
}

/**
 * 悬停/点按预览用的着法。
 * 只描述“如果走这步会发生什么”，不修改棋局，可直接驱动虚影和连线。
 */
export interface MovePreview extends LegalMove {
  /** 被吃子所在格；吃过路兵时与 to 不同 */
  capturedSquare?: Square;
  /** 王车易位时同时移动的车 */
  rook?: { from: Square; to: Square };
  /** 需要升变时，供 UI 显示的四个选择 */
  promotionChoices?: PieceType[];
}

/** 一步已落子的记录，用于历史、悔棋和解析层 */
export interface MoveRecord {
  ply: number;
  moveNumber: number;
  color: Side;
  san: string;
  zh: string;
  from: Square;
  to: Square;
  piece: PieceType;
  captured?: PieceType;
  promotion?: PieceType;
  flags: string;
  isCheck: boolean;
  isMate: boolean;
  fenAfter: string;
  /** 3D 吃子动画用：被吃子实际所在格（吃过路兵时与 to 不同） */
  capturedSquare?: Square;
  /** 3D 易位动画用：同时移动的车 */
  rook?: { from: Square; to: Square };
  /** Step 4 由解析层写入 */
  comment?: string;
}

export type GameEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold'
  | 'fifty'
  | 'insufficient'
  | 'draw';

export interface GameResult {
  reason: GameEndReason;
  /** 将死时才有胜方 */
  winner: Side | null;
  label: string;
}

/** 一次渲染所需的完整局面快照 */
export interface PositionSnapshot {
  fen: string;
  turn: Side;
  board: (PieceInfo | null)[][];
  legalMoves: LegalMove[];
  lastMove: { from: Square; to: Square } | null;
  inCheck: boolean;
  checkSquare: Square | null;
  result: GameResult | null;
  moveNumber: number;
  halfmoveClock: number;
}

/* ------------------------------------------------------------------ */
/* Step 2–5 预留：3D 棋盘直接用这些结构渲染，规则层不参与渲染细节        */
/* ------------------------------------------------------------------ */

export type ThreatLevel = 'low' | 'medium' | 'high';

/** 一条“谁攻击谁”的关系，攻击方与目标方都是具体棋子 */
export interface AttackRelation {
  from: Square;
  to: Square;
  attacker: PieceInfo;
  target: PieceInfo;
}

/** 带教学等级的威胁；Step 4 由 attackMap + SEE 生成 */
export interface ThreatInfo extends AttackRelation {
  level: ThreatLevel;
  defended: boolean;
  see: number;
}

/** 推荐着法；Step 4 由引擎 MultiPV + 事实层生成 */
export interface Recommendation {
  move: LegalMove;
  rank: number;
  scoreCp: number;
  mateIn?: number;
  /** 中文着法，例如“马 b1→c3” */
  label: string;
  /** 1–2 条短理由，例如“吃掉兵 · 将军” */
  reasons: string[];
  /** 大局观维度，例如“占据中心 · 子力出动” */
  strategy: string[];
  risk: 'low' | 'medium' | 'high';
}

export type ConnectionKind = 'threat' | 'protect' | 'capture';

/** 3D 连线：只画选中棋子相关的少量关系，避免糊屏 */
export interface BoardConnection {
  from: Square;
  to: Square;
  kind: ConnectionKind;
}

/** 场景层每帧需要的“意图”，与棋局状态解耦 */
export interface BoardIntent {
  selected: Square | null;
  legalTargets: Square[];
  preview: MovePreview | null;
  threats: ThreatInfo[];
  protections: AttackRelation[];
  recommendations: Recommendation[];
}
