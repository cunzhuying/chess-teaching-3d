import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  analyzePiece,
  buildAttackMap,
  levelZh,
} from '../src/analysis/attackMap';
import { connectionsFor } from '../src/analysis/connections';
import { buildRecommendations } from '../src/analysis/recommend';
import { strategicNotes } from '../src/analysis/strategy';

const CAPTURE_FEN = '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1';
const PROTECT_FEN = '4k3/8/8/8/4P3/3K4/8/8 w - - 0 1';

describe('攻击图与教学解析', () => {
  it('识别黑兵对 e4 白兵的威胁', () => {
    const map = buildAttackMap(CAPTURE_FEN);
    const threats = map.threatsAgainst('e4');
    expect(threats.length).toBeGreaterThan(0);
    expect(threats[0].attacker.type).toBe('p');
    expect(threats[0].attacker.color).toBe('b');
    expect(threats[0].level).toBe('low');
    expect(threats[0].see).toBeGreaterThan(0);
  });

  it('识别保护关系', () => {
    const map = buildAttackMap(PROTECT_FEN);
    const protectors = map.protectionsOf('e4');
    expect(protectors.some((relation) => relation.attacker.type === 'k')).toBe(true);
  });

  it('己方棋子解析包含威胁、保护和进攻', () => {
    const insight = analyzePiece(CAPTURE_FEN, 'e4', 'w');
    expect(insight).not.toBeNull();
    expect(insight?.isOwn).toBe(true);
    expect(insight?.summary).toContain('被');
    expect(insight?.points).toHaveLength(3);
    expect(insight?.threats.length).toBeGreaterThan(0);
    expect(levelZh(insight!.level)).toMatch(/高|中|低/);
  });

  it('敌方棋子解析强调它威胁了谁', () => {
    const insight = analyzePiece(CAPTURE_FEN, 'd5', 'w');
    expect(insight).not.toBeNull();
    expect(insight?.isOwn).toBe(false);
    expect(insight?.summary).toContain('威胁');
    expect(insight?.attacks.length).toBeGreaterThan(0);
  });

  it('连线最多 3 条，并优先威胁', () => {
    const insight = analyzePiece(CAPTURE_FEN, 'e4', 'w');
    const connections = connectionsFor(insight!);
    expect(connections.connections.length).toBeLessThanOrEqual(3);
    expect(connections.total).toBeGreaterThanOrEqual(connections.connections.length);
    expect(connections.connections[0]?.kind).toBe('threat');
  });

  it('被队友保护时生成绿色保护连线', () => {
    const insight = analyzePiece(PROTECT_FEN, 'e4', 'w');
    const connections = connectionsFor(insight!);
    expect(connections.connections.some((connection) => connection.kind === 'protect')).toBe(true);
    expect(insight?.points.join('')).toContain('保护');
  });

  it('推荐文案来自引擎根着法和走法特征', () => {
    const recommendations = buildRecommendations(CAPTURE_FEN, [
      {
        from: 'e4',
        to: 'd5',
        san: 'exd5',
        scoreCp: 120,
        depth: 3,
      },
    ]);
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].move.san).toBe('exd5');
    expect(recommendations[0].reasons).toContain('吃掉兵');
    expect(recommendations[0].strategy.length).toBeGreaterThan(0);
    expect(recommendations[0].risk).toBe('low');
  });

  it('大局观能识别占据中心与王的安全', () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const game = new Chess(start);
    const e4 = game.moves({ verbose: true }).find((move) => move.san === 'e4');
    expect(e4).toBeDefined();
    expect(strategicNotes(start, e4!)).toContain('占据中心');

    const castleFen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const castleGame = new Chess(castleFen);
    const castle = castleGame
      .moves({ verbose: true })
      .find((move) => move.flags.includes('k'));
    expect(castle).toBeDefined();
    expect(strategicNotes(castleFen, castle!)).toContain('王的安全');
  });
});
