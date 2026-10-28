import type { BoardConnection, ConnectionKind } from '../domain/types';
import type { PieceInsight } from './attackMap';

export interface ConnectionSet {
  connections: BoardConnection[];
  total: number;
}

/**
 * 选中棋子的连线规则（防糊屏的核心）：
 * - 红色（priority 0）：威胁，最优先；
 * - 金色（priority 1）：可吃；
 * - 绿色（priority 2/3）：保护。
 *
 * 全盘关系可能很多，但棋盘只画前 3 条；剩余数量返回给面板，
 * 由文字提示“还有 N 条关系未显示”。这样既不漏信息，也不会让棋盘变成蜘蛛网。
 */
export function connectionsFor(insight: PieceInsight): ConnectionSet {
  const all: Array<BoardConnection & { priority: number }> = [];

  const add = (
    from: string,
    to: string,
    kind: ConnectionKind,
    priority: number,
  ) => {
    all.push({ from, to, kind, priority } as BoardConnection & {
      priority: number;
    });
  };

  if (insight.isOwn) {
    for (const threat of insight.threats) {
      add(threat.from, threat.to, 'threat', 0);
    }
    for (const threat of insight.attacks) {
      add(threat.from, threat.to, 'capture', 1);
    }
    for (const relation of insight.protectedBy) {
      add(relation.from, relation.to, 'protect', 2);
    }
    for (const relation of insight.protects) {
      add(relation.from, relation.to, 'protect', 3);
    }
  } else {
    for (const threat of insight.attacks) {
      add(threat.from, threat.to, 'threat', 0);
    }
    for (const threat of insight.threats) {
      add(threat.from, threat.to, 'capture', 1);
    }
    for (const relation of insight.protectedBy) {
      add(relation.from, relation.to, 'protect', 2);
    }
  }

  const seen = new Set<string>();
  const unique = all.filter((connection) => {
    const key = `${connection.kind}:${connection.from}:${connection.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  unique.sort((a, b) => a.priority - b.priority);
  return {
    connections: unique.slice(0, 3).map(({ from, to, kind }) => ({
      from: from as BoardConnection['from'],
      to: to as BoardConnection['to'],
      kind,
    })),
    total: unique.length,
  };
}
