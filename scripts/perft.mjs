import { Chess } from 'chess.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';

function perft(fen, depth) {
  const game = new Chess(fen);
  const walk = (remaining) => {
    if (remaining === 0) return 1;
    let total = 0;
    for (const move of game.moves({ verbose: true })) {
      game.move({ from: move.from, to: move.to, promotion: move.promotion });
      total += walk(remaining - 1);
      game.undo();
    }
    return total;
  };
  return walk(depth);
}

function check(label, fen, depth, expected) {
  const start = Date.now();
  const nodes = perft(fen, depth);
  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  const ok = nodes === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} perft(${depth}) = ${nodes}（期望 ${expected}，${seconds}s）`);
  return ok;
}

const results = [
  check('初始局面', START, 4, 197_281),
  check('Kiwipete', KIWIPETE, 3, 97_862),
];

if (results.includes(false)) {
  process.exit(1);
}
console.log('深度 perft 全部通过。');
