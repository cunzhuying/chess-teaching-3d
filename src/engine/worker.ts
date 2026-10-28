/// <reference lib="webworker" />

import {
  analyzeCandidate,
  findBestMove,
  findTopMoves,
  type Level,
} from './search';

interface SearchRequest {
  id: number;
  fen: string;
  level: Level;
  mode?: 'best' | 'top' | 'candidate';
  count?: number;
  from?: string;
  to?: string;
  promotion?: string;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<SearchRequest>) => {
  const { id, fen, level, mode = 'best', count = 3 } = event.data;
  try {
    if (mode === 'candidate' && event.data.from && event.data.to) {
      scope.postMessage({
        id,
        candidate: analyzeCandidate(
          fen,
          event.data.from,
          event.data.to,
          event.data.promotion,
          level,
        ),
      });
      return;
    }
    if (mode === 'top') {
      scope.postMessage({ id, lines: findTopMoves(fen, level, count) });
    } else {
      scope.postMessage({ id, result: findBestMove(fen, level) });
    }
  } catch (error) {
    scope.postMessage({
      id,
      error: error instanceof Error ? error.message : '引擎搜索失败',
    });
  }
};
