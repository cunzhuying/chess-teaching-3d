import type { PieceType } from '../domain/types';

/** 2D 面板与升变弹窗使用的字符；3D 棋盘使用程序化几何。 */
export const PIECE_GLYPH: Record<PieceType, string> = {
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
};
