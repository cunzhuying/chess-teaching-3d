import type { Square } from 'chess.js';
import { PIECE_NAME_ZH } from '../domain/notation';
import type { LegalMove, PieceInfo } from '../domain/types';
import { PIECE_GLYPH } from './pieceGlyphs';

interface Board2DProps {
  pieces: ReadonlyMap<Square, PieceInfo>;
  selected: Square | null;
  targets: ReadonlyMap<Square, LegalMove>;
  lastMove: { from: Square; to: Square } | null;
  checkSquare: Square | null;
  flipped: boolean;
  onSquareClick: (square: Square) => void;
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export function Board2D({
  pieces,
  selected,
  targets,
  lastMove,
  checkSquare,
  flipped,
  onSquareClick,
}: Board2DProps) {
  const ranks = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const files = flipped ? [...FILES].reverse() : FILES;
  const bottomRank = ranks[7];
  const leftFile = files[0];

  return (
    <div className="board" role="grid" aria-label="国际象棋棋盘">
      {ranks.flatMap((rank) =>
        files.map((file) => {
          const square = `${file}${rank}` as Square;
          const piece = pieces.get(square);
          const target = targets.get(square);
          const fileIndex = FILES.indexOf(file);
          const isLight = (fileIndex + rank) % 2 === 0;
          const classes = ['square', isLight ? 'light' : 'dark'];

          if (selected === square) classes.push('selected');
          if (target) classes.push('is-target');
          if (target?.isCapture) classes.push('is-capture');
          if (lastMove?.from === square || lastMove?.to === square) classes.push('last-move');
          if (checkSquare === square) classes.push('in-check');

          const label = [
            square,
            piece ? `${piece.color === 'w' ? '白' : '黑'}${PIECE_NAME_ZH[piece.type]}` : '空格',
            target ? '可走' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <button
              key={square}
              type="button"
              className={classes.join(' ')}
              onClick={() => onSquareClick(square)}
              aria-label={label}
              aria-pressed={selected === square}
            >
              {piece && (
                <span className={`piece ${piece.color}`} aria-hidden="true">
                  {PIECE_GLYPH[piece.type]}
                </span>
              )}
              {target && !piece && <span className="move-dot" aria-hidden="true" />}
              {target && piece && <span className="capture-ring" aria-hidden="true" />}
              {file === leftFile && <span className="coord coord-rank">{rank}</span>}
              {rank === bottomRank && <span className="coord coord-file">{file}</span>}
            </button>
          );
        }),
      )}
    </div>
  );
}
