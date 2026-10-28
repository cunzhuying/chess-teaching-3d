import * as THREE from 'three';
import type { Square } from 'chess.js';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const BOARD_SIZE = 8;
export const SQUARE_SIZE = 1;

/** 棋盘中心为原点：a1 = (-3.5, 0, 3.5)，h8 = (3.5, 0, -3.5)。 */
export function squareToWorld(square: Square, y = 0): THREE.Vector3 {
  const file = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rank = Number(square[1]);
  return new THREE.Vector3(file - 3.5, y, 4.5 - rank);
}

/** 棋盘平面坐标 → 格子；落在棋盘外返回 null。 */
export function worldToSquare(point: THREE.Vector3): Square | null {
  const x = point.x + 4;
  const z = point.z + 4;
  if (x < 0 || x >= BOARD_SIZE || z < 0 || z >= BOARD_SIZE) return null;
  const file = Math.floor(x);
  const rank = BOARD_SIZE - Math.floor(z);
  return `${FILES[file]}${rank}` as Square;
}

export function isLightSquare(square: Square): boolean {
  const file = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rank = Number(square[1]);
  return (file + rank) % 2 === 0;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
