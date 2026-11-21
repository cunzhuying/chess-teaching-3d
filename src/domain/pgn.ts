import type { GameResult, MoveRecord } from './types';

/** PGN 规范里的对局结果标记；“*”表示对局尚未结束。 */
export type PgnResult = '1-0' | '0-1' | '1/2-1/2' | '*';

export interface PgnMeta {
  /** 白方名称，例如“玩家”或“教学 AI · 入门” */
  white: string;
  /** 黑方名称 */
  black: string;
  /** 对局日期，默认当前时间（PGN 用本地日期） */
  date?: Date;
  /** 结果标记，默认“*” */
  result?: PgnResult;
  event?: string;
  site?: string;
}

const DEFAULT_EVENT = '教学对局';
const DEFAULT_SITE = 'chess-teaching-3d';
const MAX_LINE = 80;

/** 对局状态 → PGN 结果标记：白胜 1-0、黑胜 0-1、和棋 1/2-1/2、未结束 *。 */
export function resultTag(result: GameResult | null | undefined): PgnResult {
  if (!result) return '*';
  if (result.winner === 'w') return '1-0';
  if (result.winner === 'b') return '0-1';
  return '1/2-1/2';
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** PGN 标准的日期格式：YYYY.MM.DD */
export function formatPgnDate(date: Date): string {
  return `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`;
}

/** 文件里出现的反斜杠与双引号需要转义，否则标签会被截断。 */
function escapeTag(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 只输出着法部分（movetext）。
 * 直接使用 chess.js 生成的 SAN，避免 UI 再写一套记谱规则；
 * 白方先走时为“1. e4 e5”，从黑方接续的局面则用“1... e5”。
 * 每回合单独一行，最后追加结果标记。
 */
export function formatMovetext(records: readonly MoveRecord[], result: PgnResult): string {
  const lines: string[] = [];
  let line: string | null = null;

  const flush = (): void => {
    if (line) lines.push(line);
    line = null;
  };
  const append = (token: string): void => {
    line = line ? `${line} ${token}` : token;
  };

  for (const record of records) {
    if (record.color === 'w') {
      flush();
      append(`${record.moveNumber}.`);
      append(record.san);
    } else {
      if (!line) append(`${record.moveNumber}...`);
      append(record.san);
      flush();
    }
  }
  flush();

  if (lines.length === 0) {
    lines.push(result);
  } else if (lines[lines.length - 1].length + 1 + result.length <= MAX_LINE) {
    lines[lines.length - 1] += ` ${result}`;
  } else {
    lines.push(result);
  }

  return lines.join('\n');
}

/** 生成一份完整的标准 PGN 棋谱文本（标签对 + 空行 + movetext）。 */
export function buildPgn(records: readonly MoveRecord[], meta: PgnMeta): string {
  const result = meta.result ?? '*';
  const headers: Array<[string, string]> = [
    ['Event', meta.event ?? DEFAULT_EVENT],
    ['Site', meta.site ?? DEFAULT_SITE],
    ['Date', formatPgnDate(meta.date ?? new Date())],
    ['Round', '-'],
    ['White', meta.white],
    ['Black', meta.black],
    ['Result', result],
  ];
  const tagPairs = headers.map(([tag, value]) => `[${tag} "${escapeTag(value)}"]`);

  return `${tagPairs.join('\n')}\n\n${formatMovetext(records, result)}\n`;
}

/** 导出文件名，例如 chess-20261121-0905.pgn，避免同一天多次导出互相覆盖。 */
export function pgnFileName(date: Date = new Date()): string {
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const time = `${pad2(date.getHours())}${pad2(date.getMinutes())}`;
  return `chess-${stamp}-${time}.pgn`;
}