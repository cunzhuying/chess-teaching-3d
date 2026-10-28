import type { Side, PieceType } from './types';

export const PIECE_NAME_ZH: Record<PieceType, string> = {
  p: '兵',
  n: '马',
  b: '象',
  r: '车',
  q: '后',
  k: '王',
};

/** 教学用子力价值；王不参与交换，记 0 并在 UI 显示为“—”。 */
export const PIECE_VALUE: Record<PieceType, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

export function pieceNameZh(type: PieceType): string {
  return PIECE_NAME_ZH[type];
}

export function sideNameZh(side: Side): string {
  return side === 'w' ? '白方' : '黑方';
}

export function pieceValueLabel(type: PieceType): string {
  const value = PIECE_VALUE[type];
  return value === 0 ? '—' : String(value);
}

export interface NotationMove {
  piece: PieceType;
  from: string;
  to: string;
  captured?: PieceType;
  promotion?: PieceType;
  flags: string;
  isCheck?: boolean;
  isMate?: boolean;
}

/**
 * 中文教学记谱：始终带起点，避免“马 d2”这种需要消歧的写法。
 * 例：兵 e2→e4 / 马 g1→f3 / 兵 e4×d5 / 短易位 / 兵 e7→e8=后＋
 * 该函数只做展示，不参与规则判断。
 */
export function formatMoveZh(move: NotationMove): string {
  const isCastle = move.flags.includes('k') || move.flags.includes('q');
  let text: string;

  if (isCastle) {
    text = move.flags.includes('k') ? '短易位' : '长易位';
  } else {
    const isCapture = Boolean(move.captured) || move.flags.includes('e');
    text = `${PIECE_NAME_ZH[move.piece]} ${move.from}${isCapture ? '×' : '→'}${move.to}`;
    if (move.flags.includes('e')) text += '（吃过路兵）';
    if (move.promotion) text += `=${PIECE_NAME_ZH[move.promotion]}`;
  }

  if (move.isMate) text += '＃';
  else if (move.isCheck) text += '＋';

  return text;
}
