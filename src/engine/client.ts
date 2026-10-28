import type {
  CandidateAnalysis,
  Level,
  SearchLine,
  SearchResult,
} from './search';

interface Pending {
  resolve: (value: never) => void;
  reject: (error: Error) => void;
  timer: number;
}

export class EngineClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, Pending>();

  analyze(fen: string, level: Level): Promise<SearchResult | null> {
    return this.request<SearchResult | null>({ fen, level });
  }

  analyzeTop(fen: string, level: Level, count = 3): Promise<SearchLine[]> {
    return this.request<SearchLine[]>({ fen, level, mode: 'top', count });
  }

  analyzeCandidate(
    fen: string,
    from: string,
    to: string,
    promotion: string | undefined,
    level: Level = 'easy',
  ): Promise<CandidateAnalysis | null> {
    return this.request<CandidateAnalysis | null>({
      fen,
      level,
      mode: 'candidate',
      from,
      to,
      promotion,
    });
  }

  cancel(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error('cancelled'));
    }
    this.pending.clear();
  }

  dispose(): void {
    this.cancel();
  }

  private request<T>(payload: {
    fen: string;
    level: Level;
    mode?: 'best' | 'top' | 'candidate';
    count?: number;
    from?: string;
    to?: string;
    promotion?: string;
  }): Promise<T> {
    const worker = this.ensureWorker();
    const id = (this.sequence += 1);

    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        this.cancel();
        reject(new Error('引擎思考超时'));
      }, 8000);

      this.pending.set(id, {
        resolve: resolve as (value: never) => void,
        reject,
        timer,
      });
      worker.postMessage({ id, ...payload });
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (
      event: MessageEvent<{
        id: number;
        result?: SearchResult | null;
        lines?: SearchLine[];
        candidate?: CandidateAnalysis | null;
        error?: string;
      }>,
    ) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) return;
      this.pending.delete(event.data.id);
      window.clearTimeout(pending.timer);
      if (event.data.error) {
        pending.reject(new Error(event.data.error));
        return;
      }
      pending.resolve(
        (event.data.candidate ??
          event.data.lines ??
          event.data.result ??
          null) as never,
      );
    };
    worker.onerror = () => {
      for (const pending of this.pending.values()) {
        window.clearTimeout(pending.timer);
        pending.reject(new Error('引擎线程异常'));
      }
      this.pending.clear();
      worker.terminate();
      if (this.worker === worker) this.worker = null;
    };
    this.worker = worker;
    return worker;
  }
}
