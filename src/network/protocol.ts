import type { MoveRecord, PieceType, Side } from '../domain/types';

/** 局域网/P2P 同步时只传“局面 + 历史”，主机是唯一真源。 */
export interface OnlineState {
  fen: string;
  records: MoveRecord[];
}

export type NetMessage =
  | { type: 'welcome'; hostColor: Side; state: OnlineState }
  | { type: 'move'; from: string; to: string; promotion?: PieceType }
  | {
      type: 'state';
      state: OnlineState;
      kind: 'move' | 'undo' | 'restart';
    }
  | { type: 'undo-request' }
  | { type: 'restart-request' }
  | { type: 'promotion-required'; from: string; to: string }
  | { type: 'error'; message: string };

export function isNetMessage(value: unknown): value is NetMessage {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === 'welcome' ||
    type === 'move' ||
    type === 'state' ||
    type === 'undo-request' ||
    type === 'restart-request' ||
    type === 'promotion-required' ||
    type === 'error'
  );
}
