import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Square } from 'chess.js';
import { GameController } from './domain/gameController';
import {
  formatMoveZh,
  PIECE_NAME_ZH,
  PIECE_VALUE,
  pieceValueLabel,
  sideNameZh,
} from './domain/notation';
import type {
  LegalMove,
  MovePreview,
  MoveRecord,
  PieceInfo,
  PieceType,
  Side,
} from './domain/types';
import type { InputKind } from './three/BoardScene';
import { sound } from './audio/sound';
import { EngineClient } from './engine/client';
import {
  LEVELS,
  type CandidateAnalysis,
  type Level,
  type SearchLine,
} from './engine/search';
import {
  analyzePiece,
  buildAttackMap,
  levelZh,
} from './analysis/attackMap';
import { buildRecommendations } from './analysis/recommend';
import { connectionsFor } from './analysis/connections';
import { strategicNotes } from './analysis/strategy';
import type { Recommendation, ThreatInfo } from './domain/types';
import { Board2D } from './ui/Board2D';
import { BoardCanvas, type BoardCanvasHandle } from './ui/BoardCanvas';
import { PIECE_GLYPH } from './ui/pieceGlyphs';
import {
  PeerSession,
  type PeerRole,
  type PeerStatus,
} from './network/peerSession';
import type { NetMessage, OnlineState } from './network/protocol';

interface PromotionState {
  from: Square;
  to: Square;
  color: Side;
}

interface AiAnalysis {
  summary: string;
  points: string[];
  depth: number;
  scoreCp: number;
  mateIn?: number;
}

type ViewMode = '3d' | '2d';
type GameMode = 'pvp' | 'ai' | 'online';
type OnlineView = 'menu' | 'create' | 'join';

function formatEval(scoreCp: number, mateIn?: number): string {
  if (mateIn) {
    return `${scoreCp >= 0 ? '白方' : '黑方'} ${mateIn} 步将杀`;
  }
  const pawns = scoreCp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

function evalPercent(scoreCp: number): number {
  if (Math.abs(scoreCp) > 50_000) return scoreCp > 0 ? 100 : 0;
  return 50 + 50 * Math.tanh(scoreCp / 300);
}

const RISK_LABEL: Record<Recommendation['risk'], string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

function formatEvalForSide(
  scoreCp: number,
  color: Side,
  mateIn?: number,
): string {
  if (mateIn) {
    return `${scoreCp >= 0 ? '白方' : '黑方'} ${mateIn} 步将杀`;
  }
  const value = color === 'w' ? scoreCp : -scoreCp;
  const pawns = value / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(1)}`;
}

function searchLineLabel(line: SearchLine): string {
  return formatMoveZh({
    piece: (line.piece ?? 'p') as PieceType,
    from: line.from as Square,
    to: line.to as Square,
    captured: line.captured as PieceType | undefined,
    promotion: line.promotion as PieceType | undefined,
    flags: '',
  });
}

function readToggle(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

function onlineStatusZh(status: PeerStatus | 'idle'): string {
  switch (status) {
    case 'creating':
      return '创建房间中…';
    case 'waiting':
      return '等待对手加入…';
    case 'connecting':
      return '连接房主中…';
    case 'connected':
      return '已连接';
    case 'disconnected':
      return '对手已断开';
    case 'error':
      return '连接失败';
    default:
      return '未连接';
  }
}

export default function App() {
  const gameRef = useRef<GameController | null>(null);
  if (!gameRef.current) gameRef.current = new GameController();
  const game = gameRef.current;
  const boardRef = useRef<BoardCanvasHandle>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  const [version, refresh] = useReducer((value: number) => value + 1, 0);
  const [selected, setSelected] = useState<Square | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [viewSide, setViewSide] = useState<Side>('w');
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [inputMode, setInputMode] = useState<InputKind>('mouse');
  const [animating, setAnimating] = useState(false);
  const [promotion, setPromotion] = useState<PromotionState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(() => sound.enabled);
  const [showRecommendations, setShowRecommendations] = useState(() =>
    readToggle('chess.showRecommendations', true),
  );
  const [showConnections, setShowConnections] = useState(() =>
    readToggle('chess.showConnections', true),
  );

  const [mode, setMode] = useState<GameMode>('pvp');
  const [playerColor, setPlayerColor] = useState<Side>('w');
  const [level, setLevel] = useState<Level>('beginner');
  const [aiThinking, setAiThinking] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis | null>(null);
  const [evalCp, setEvalCp] = useState(0);
  const [aiSetupOpen, setAiSetupOpen] = useState(false);
  const [setupColor, setSetupColor] = useState<Side>('w');
  const [setupLevel, setSetupLevel] = useState<Level>('beginner');
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [candidate, setCandidate] = useState<CandidateAnalysis | null>(null);
  const [candidateLoading, setCandidateLoading] = useState(false);

  const [onlineOpen, setOnlineOpen] = useState(false);
  const [onlineView, setOnlineView] = useState<OnlineView>('menu');
  const [onlineHostColor, setOnlineHostColor] = useState<Side>('w');
  const [onlineJoinCode, setOnlineJoinCode] = useState('');
  const [onlineCode, setOnlineCode] = useState('');
  const [onlineRole, setOnlineRole] = useState<PeerRole | null>(null);
  const [onlineStatus, setOnlineStatus] = useState<PeerStatus | 'idle'>('idle');
  const [onlineConnected, setOnlineConnected] = useState(false);
  const [onlinePending, setOnlinePending] = useState(false);
  const [onlineError, setOnlineError] = useState<string | null>(null);

  const engineRef = useRef<EngineClient | null>(null);
  const recommendationEngineRef = useRef<EngineClient | null>(null);
  const candidateEngineRef = useRef<EngineClient | null>(null);
  const recommendationCache = useRef(new Map<string, Recommendation[]>());
  const candidateCache = useRef(new Map<string, CandidateAnalysis>());
  const recommendationToken = useRef(0);
  const candidateToken = useRef(0);
  const aiToken = useRef(0);
  const aiInFlight = useRef(false);
  const aiFailedFen = useRef<string | null>(null);
  const onlineSessionRef = useRef<PeerSession | null>(null);
  const onlineRoleRef = useRef<PeerRole | null>(null);
  const onlineHostColorRef = useRef<Side>('w');
  const onlineConnectedRef = useRef(false);
  const onlineMessageRef = useRef<(message: NetMessage) => void>(() => {});

  const snap = useMemo(() => game.snapshot(), [game, version]);
  const records = game.history;

  const pieces = useMemo(() => {
    const map = new Map<Square, PieceInfo>();
    for (const row of snap.board) {
      for (const piece of row) {
        if (piece) map.set(piece.square, piece);
      }
    }
    return map;
  }, [snap]);

  const targets = useMemo(() => {
    const map = new Map<Square, LegalMove>();
    if (!selected) return map;
    for (const move of snap.legalMoves) {
      if (move.from === selected) map.set(move.to, move);
    }
    return map;
  }, [snap, selected]);

  const selectedPiece = selected ? pieces.get(selected) : undefined;
  const previewLabel = preview ? formatMoveZh(preview) : null;
  const aiColor: Side = playerColor === 'w' ? 'b' : 'w';
  const onlineReady =
    mode === 'online' && onlineConnected && !onlinePending && !onlineError;
  const humanTurn =
    mode === 'pvp' ||
    (mode === 'ai' && snap.turn === playerColor) ||
    (mode === 'online' && onlineReady && snap.turn === playerColor);
  const busy =
    animating ||
    aiThinking ||
    (mode === 'ai' && !humanTurn) ||
    (mode === 'online' && (!onlineReady || !humanTurn));
  const perspectiveColor: Side = mode === 'pvp' ? snap.turn : playerColor;

  const attackMap = useMemo(() => buildAttackMap(snap.fen), [snap.fen]);
  const selectedInsight = useMemo(
    () => (selected ? analyzePiece(snap.fen, selected, perspectiveColor) : null),
    [snap.fen, selected, perspectiveColor],
  );
  const connectionSet = useMemo(
    () => (selectedInsight ? connectionsFor(selectedInsight) : { connections: [], total: 0 }),
    [selectedInsight],
  );
  const threatsAgainstPlayer = useMemo(() => {
    const rank = { high: 0, medium: 1, low: 2 };
    return attackMap.threats
      .filter((threat) => threat.target.color === perspectiveColor)
      .sort((a, b) => rank[a.level] - rank[b.level]);
  }, [attackMap, perspectiveColor]);
  const recommendedForPiece = selected
    ? recommendations.find((recommendation) => recommendation.move.from === selected)
    : undefined;

  const candidateLoss = candidate
    ? candidate.bestScoreCp - candidate.candidateScoreCp
    : null;

  const simulationWarning = (() => {
    if (!candidate || candidateLoss === null || candidateLoss < 80) {
      return null;
    }
    const reply = candidate.reply;
    const capturedValue = reply?.captured ? PIECE_VALUE[reply.captured] : 0;
    const serious =
      candidateLoss >= 150 ||
      (capturedValue >= 3 && candidateLoss >= 80);

    if (serious) {
      if (reply?.captured) {
        return {
          level: 'danger' as const,
          text: `危险！如果你走这步，对方会用${PIECE_NAME_ZH[reply.piece ?? 'p']}吃掉你的${PIECE_NAME_ZH[reply.captured]}，你将损失 ${capturedValue} 分。`,
        };
      }
      return {
        level: 'danger' as const,
        text: reply
          ? `危险！如果你走这步，对方可能走 ${searchLineLabel(reply)}，评估会下降约 ${(candidateLoss / 100).toFixed(1)} 分。`
          : `危险！这步会让评估下降约 ${(candidateLoss / 100).toFixed(1)} 分。`,
      };
    }

    return {
      level: 'caution' as const,
      text: reply
        ? `注意：对方可能走 ${searchLineLabel(reply)}，这步比最佳推荐低约 ${(candidateLoss / 100).toFixed(1)} 分。`
        : `注意：这步比最佳推荐低约 ${(candidateLoss / 100).toFixed(1)} 分。`,
    };
  })();

  const opponentArrow =
    preview && candidate?.reply
      ? {
          from: candidate.reply.from as Square,
          to: candidate.reply.to as Square,
        }
      : null;

  const visibleRecommendations =
    showRecommendations &&
    humanTurn &&
    !animating &&
    !aiThinking &&
    !preview &&
    !snap.result
      ? selected
        ? recommendations.slice(0, 1)
        : recommendations
      : [];
  const visibleConnections =
    showConnections && selected && !animating && !aiThinking && !preview
      ? connectionSet.connections
      : [];

  const previewFen = useMemo(
    () =>
      preview
        ? game.previewFen(
            preview.from,
            preview.to,
            preview.promotion ?? 'q',
          )
        : null,
    [preview, snap.fen, game],
  );

  // 虚影联动：不是分析“现在”，而是分析“走完这一步之后”的假想局面。
  // previewFen 让 chess.js 负责吃掉、易位、吃过路兵、升变等规则细节；
  // analyzePiece 再以虚影落点为目标棋，回答“走后谁威胁我、我保护了谁”。
  const ghostInsight = useMemo(
    () =>
      preview && previewFen
        ? analyzePiece(previewFen, preview.to, perspectiveColor)
        : null,
    [preview, previewFen, perspectiveColor],
  );
  const ghostConnectionSet = useMemo(
    () =>
      ghostInsight
        ? connectionsFor(ghostInsight)
        : { connections: [], total: 0 },
    [ghostInsight],
  );
  const ghostStrategy = useMemo(
    () =>
      preview
        ? strategicNotes(snap.fen, {
            from: preview.from,
            to: preview.to,
            promotion: preview.promotion,
            color: preview.color,
          })
        : [],
    [preview, snap.fen],
  );

  useEffect(() => {
    const token = (candidateToken.current += 1);
    if (
      !preview ||
      !selected ||
      !humanTurn ||
      animating ||
      promotion ||
      busy ||
      snap.result
    ) {
      setCandidate(null);
      setCandidateLoading(false);
      return;
    }

    const key = `${snap.fen}:${preview.from}:${preview.to}:${preview.promotion ?? ''}`;
    const cached = candidateCache.current.get(key);
    if (cached) {
      setCandidate(cached);
      setCandidateLoading(false);
      return;
    }

    setCandidate(null);
    setCandidateLoading(true);
    const timer = window.setTimeout(() => {
      const engine =
        (candidateEngineRef.current ??= new EngineClient());
      engine
        .analyzeCandidate(
          snap.fen,
          preview.from,
          preview.to,
          preview.promotion,
          'easy',
        )
        .then((result) => {
          if (token !== candidateToken.current) return;
          if (result) {
            candidateCache.current.set(key, result);
            if (candidateCache.current.size > 40) {
              const first = candidateCache.current.keys().next().value;
              if (first) candidateCache.current.delete(first);
            }
          }
          setCandidate(result);
          setCandidateLoading(false);
        })
        .catch(() => {
          if (token !== candidateToken.current) return;
          setCandidate(null);
          setCandidateLoading(false);
        });
    }, 260);

    return () => window.clearTimeout(timer);
  }, [
    preview,
    selected,
    humanTurn,
    animating,
    promotion,
    busy,
    snap.result,
    snap.fen,
  ]);
  const visiblePreviewConnections =
    showConnections && preview && !animating && !aiThinking
      ? ghostConnectionSet.connections
      : [];

  const rows = useMemo(() => {
    const result: Array<{
      no: number;
      white: (typeof records)[number] | undefined;
      black: (typeof records)[number] | undefined;
    }> = [];
    for (let index = 0; index < records.length; index += 2) {
      result.push({
        no: index / 2 + 1,
        white: records[index],
        black: records[index + 1],
      });
    }
    return result;
  }, [records, version]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    const element = historyRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [version]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const debugWindow = window as unknown as {
      __chessGame?: GameController;
      __chessRefresh?: () => void;
      __chessSound?: typeof sound;
    };
    debugWindow.__chessGame = game;
    debugWindow.__chessRefresh = refresh;
    debugWindow.__chessSound = sound;
    return () => {
      if (debugWindow.__chessGame === game) delete debugWindow.__chessGame;
      delete debugWindow.__chessRefresh;
      delete debugWindow.__chessSound;
    };
  }, [game, refresh]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        'chess.showRecommendations',
        showRecommendations ? '1' : '0',
      );
      window.localStorage.setItem(
        'chess.showConnections',
        showConnections ? '1' : '0',
      );
    } catch {
      // 隐私模式下 localStorage 可能不可用；开关仍然只在本次会话生效。
    }
  }, [showRecommendations, showConnections]);

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
      recommendationEngineRef.current?.dispose();
      recommendationEngineRef.current = null;
      candidateEngineRef.current?.dispose();
      candidateEngineRef.current = null;
    };
  }, []);

  useEffect(() => {
    recommendationToken.current += 1;
    const token = recommendationToken.current;
    const fen = snap.fen;
    if (!showRecommendations || !humanTurn || animating || aiThinking || promotion || snap.result) {
      setRecommendations([]);
      setRecommendationsLoading(false);
      return;
    }

    const cached = recommendationCache.current.get(fen);
    if (cached) {
      setRecommendations(cached);
      setRecommendationsLoading(false);
      return;
    }

    setRecommendationsLoading(true);
    const engine =
      (recommendationEngineRef.current ??= new EngineClient());
    engine
      .analyzeTop(fen, 'easy', 3)
      .then((lines) => {
        if (token !== recommendationToken.current) return;
        const next = buildRecommendations(fen, lines);
        recommendationCache.current.set(fen, next);
        if (recommendationCache.current.size > 60) {
          const first = recommendationCache.current.keys().next().value;
          if (first) recommendationCache.current.delete(first);
        }
        setRecommendations(next);
        setRecommendationsLoading(false);
      })
      .catch((error: unknown) => {
        if (token !== recommendationToken.current) return;
        setRecommendations([]);
        setRecommendationsLoading(false);
        if (error instanceof Error && error.message === 'cancelled') return;
        setMessage(`推荐分析失败：${error instanceof Error ? error.message : '未知错误'}`);
      });
  }, [showRecommendations, humanTurn, snap.fen, snap.result, animating, aiThinking, promotion]);

  useEffect(() => {
    if (mode !== 'ai' || snap.result || animating || promotion) return;
    if (snap.turn !== aiColor || aiThinking || aiInFlight.current) return;
    if (aiFailedFen.current === snap.fen) return;

    const fen = game.fen;
    const token = (aiToken.current += 1);
    aiInFlight.current = true;
    setAiThinking(true);
    setMessage(null);

    const engine = (engineRef.current ??= new EngineClient());
    engine
      .analyze(fen, level)
      .then((result) => {
        if (token !== aiToken.current) return;
        if (!result || game.fen !== fen) {
          aiInFlight.current = false;
          setAiThinking(false);
          aiFailedFen.current = fen;
          return;
        }

        let outcome = game.move(
          result.from as Square,
          result.to as Square,
          result.promotion as PieceType | undefined,
        );
        if (!outcome.ok) {
          const legal = game.legalMoves();
          const fallback = legal[Math.floor(Math.random() * legal.length)];
          if (fallback) {
            outcome = game.move(
              fallback.from,
              fallback.to,
              fallback.promotion,
            );
          }
        }
        if (!outcome.ok) {
          aiInFlight.current = false;
          setAiThinking(false);
          aiFailedFen.current = fen;
          setMessage('引擎返回了非法着法，已跳过本次走子');
          return;
        }

        const record = outcome.record;
        const mateText = result.mateIn
          ? `发现 ${result.mateIn} 步内将杀。`
          : `当前引擎评估：${formatEval(result.scoreCp)}（白方视角）。`;
        setAiThinking(false);
        aiInFlight.current = false;
        setEvalCp(result.scoreCp);
        setAiAnalysis({
          summary: `AI（${sideNameZh(record.color)}）走了 ${record.zh}。`,
          points: [
            `搜索深度 ${result.depth} · 根着法 ${result.nodes}`,
            mateText,
            `${LEVELS[level].label}难度：这是该难度下的引擎选择，不承诺全局最优。`,
          ],
          depth: result.depth,
          scoreCp: result.scoreCp,
          mateIn: result.mateIn,
        });
        finishMove(record);
      })
      .catch((error: unknown) => {
        if (token !== aiToken.current) return;
        aiInFlight.current = false;
        setAiThinking(false);
        if (error instanceof Error && error.message === 'cancelled') return;
        aiFailedFen.current = fen;
        setMessage(
          `引擎异常：${error instanceof Error ? error.message : '未知错误'}`,
        );
      });
  }, [mode, snap.fen, snap.result, animating, promotion, aiThinking, aiColor, level, game]);

  function cancelAi(): void {
    aiToken.current += 1;
    aiInFlight.current = false;
    aiFailedFen.current = null;
    engineRef.current?.cancel();
    setAiThinking(false);
  }

  function clearTransientState(): void {
    setSelected(null);
    setPreview(null);
    setPromotion(null);
    setMessage(null);
    setAiAnalysis(null);
    setEvalCp(0);
    setAnimating(false);
  }

  function startAiGame(color: Side, nextLevel: Level): void {
    leaveOnline();
    cancelAi();
    game.reset();
    clearTransientState();
    setMode('ai');
    setPlayerColor(color);
    setLevel(nextLevel);
    setViewSide(color);
    setAiSetupOpen(false);
    refresh();
  }

  function startPvpGame(): void {
    leaveOnline();
    cancelAi();
    game.reset();
    clearTransientState();
    setMode('pvp');
    setViewSide('w');
    refresh();
  }

  function currentOnlineState(): OnlineState {
    return {
      fen: game.fen,
      records: [...game.history],
    };
  }

  function broadcastOnlineState(kind: 'move' | 'undo' | 'restart'): void {
    if (onlineRoleRef.current !== 'host') return;
    onlineSessionRef.current?.send({
      type: 'state',
      state: currentOnlineState(),
      kind,
    });
  }

  function leaveOnline(): void {
    onlineSessionRef.current?.close();
    onlineSessionRef.current = null;
    onlineRoleRef.current = null;
    onlineConnectedRef.current = false;
    setOnlineRole(null);
    setOnlineConnected(false);
    setOnlinePending(false);
    setOnlineStatus('idle');
    setOnlineCode('');
    setOnlineError(null);
    setOnlineOpen(false);
  }

  function exitOnline(): void {
    if (!onlineConnectedRef.current) {
      closeOnlineDialog();
      return;
    }
    leaveOnline();
    setMode('pvp');
    game.reset();
    clearTransientState();
    setViewSide('w');
    refresh();
    setMessage('已退出联机，回到双人同屏。');
  }

  function closeOnlineDialog(): void {
    if (onlineConnectedRef.current) {
      setOnlineOpen(false);
      return;
    }
    leaveOnline();
    if (mode === 'online') {
      setMode('pvp');
      game.reset();
      clearTransientState();
      setViewSide('w');
      refresh();
    }
  }

  function openOnlineDialog(): void {
    if (onlineConnectedRef.current) {
      setOnlineView('menu');
    } else if (onlineRoleRef.current === 'host') {
      setOnlineView('create');
    } else if (onlineRoleRef.current === 'guest') {
      setOnlineView('join');
    } else {
      setOnlineView('menu');
    }
    setOnlineError(null);
    setOnlineOpen(true);
  }

  function startHostOnline(color: Side): void {
    leaveOnline();
    cancelAi();
    game.reset();
    clearTransientState();
    setMode('online');
    setOnlineRole('host');
    onlineRoleRef.current = 'host';
    setOnlineHostColor(color);
    onlineHostColorRef.current = color;
    setPlayerColor(color);
    setViewSide(color);
    setOnlineView('create');
    setOnlineOpen(true);
    setOnlineConnected(false);
    onlineConnectedRef.current = false;
    setOnlinePending(false);
    setOnlineStatus('creating');
    setOnlineCode('');
    setOnlineError(null);

    const session = new PeerSession('host', {
      onStatus: (status, detail) => {
        setOnlineStatus(status);
        if (detail) setMessage(detail);
      },
      onCode: (code) => setOnlineCode(code),
      onConnected: () => {
        setOnlineConnected(true);
        onlineConnectedRef.current = true;
        setOnlineStatus('connected');
        setOnlineOpen(false);
        setOnlinePending(false);
        session.send({
          type: 'welcome',
          hostColor: onlineHostColorRef.current,
          state: currentOnlineState(),
        });
        setMessage('对手已连接，开始对局。');
      },
      onMessage: (message) => onlineMessageRef.current(message),
      onError: (message) => {
        setOnlineError(message);
        setOnlineConnected(false);
        onlineConnectedRef.current = false;
        setOnlineStatus('error');
        setMessage(message);
      },
      onDisconnected: () => {
        setOnlineConnected(false);
        onlineConnectedRef.current = false;
        setOnlineStatus('disconnected');
        setOnlinePending(false);
        setMessage('对手已断开，本局暂停。');
      },
    });
    onlineSessionRef.current = session;
    refresh();
  }

  function joinOnline(code: string): void {
    if (!/^\d{6}$/.test(code)) {
      setOnlineError('请输入 6 位数字房间号');
      return;
    }
    leaveOnline();
    cancelAi();
    game.reset();
    clearTransientState();
    setMode('online');
    setOnlineRole('guest');
    onlineRoleRef.current = 'guest';
    setOnlineView('join');
    setOnlineOpen(true);
    setOnlineConnected(false);
    onlineConnectedRef.current = false;
    setOnlinePending(false);
    setOnlineStatus('connecting');
    setOnlineCode(code);
    setOnlineError(null);
    setPlayerColor('w');
    setViewSide('w');

    const session = new PeerSession(
      'guest',
      {
        onStatus: (status, detail) => {
          setOnlineStatus(status);
          if (detail) setMessage(detail);
        },
        onCode: (roomCode) => setOnlineCode(roomCode),
        onConnected: () => {
          setOnlineStatus('connected');
          setMessage('已连接房主，等待棋局同步…');
        },
        onMessage: (message) => onlineMessageRef.current(message),
        onError: (message) => {
          setOnlineError(message);
          setOnlineConnected(false);
          onlineConnectedRef.current = false;
          setOnlineStatus('error');
          setOnlinePending(false);
          setMessage(message);
        },
        onDisconnected: () => {
          setOnlineConnected(false);
          onlineConnectedRef.current = false;
          setOnlineStatus('disconnected');
          setOnlinePending(false);
          setMessage('房主已断开，联机结束。');
        },
      },
      code,
    );
    onlineSessionRef.current = session;
    refresh();
  }

  function sendGuestMove(
    from: Square,
    to: Square,
    promotion?: PieceType,
  ): void {
    if (!onlineSessionRef.current?.send({ type: 'move', from, to, promotion })) {
      setMessage('联机连接不可用，请重新加入房间。');
      return;
    }
    setSelected(null);
    setPreview(null);
    setPromotion(null);
    setOnlinePending(true);
    setMessage('等待房主确认落子…');
  }

  function applyOnlineState(
    state: OnlineState,
    kind: 'welcome' | 'move' | 'undo' | 'restart',
  ): void {
    const previousFen = game.fen;
    game.restore(state.fen, state.records);
    setOnlineConnected(true);
    onlineConnectedRef.current = true;
    setOnlinePending(false);
    setOnlineError(null);
    setOnlineStatus('connected');
    setOnlineOpen(false);

    if (kind === 'move' && state.fen !== previousFen) {
      const last = game.lastRecord;
      if (last) {
        finishMove(last);
        return;
      }
    }

    setSelected(null);
    setPreview(null);
    setPromotion(null);
    setAnimating(false);
    refresh();
    if (kind === 'undo') setMessage('房主已悔棋。');
    else if (kind === 'restart') setMessage('房主重开了对局。');
    else if (kind === 'welcome') setMessage('已连接房主，开始对局。');
  }

  function handleOnlineMessage(message: NetMessage): void {
    const role = onlineRoleRef.current;
    if (!role) return;

    if (role === 'host') {
      if (message.type === 'move') {
        const outcome = game.move(
          message.from as Square,
          message.to as Square,
          message.promotion,
        );
        if (outcome.ok) {
          finishMove(outcome.record);
          broadcastOnlineState('move');
          return;
        }
        if (outcome.needsPromotion) {
          onlineSessionRef.current?.send({
            type: 'promotion-required',
            from: message.from,
            to: message.to,
          });
          return;
        }
        onlineSessionRef.current?.send({
          type: 'error',
          message: outcome.error,
        });
        return;
      }

      if (message.type === 'undo-request') {
        if (animating) {
          onlineSessionRef.current?.send({
            type: 'error',
            message: '房主正在落子，请稍后再悔棋。',
          });
          return;
        }
        hostUndo();
        return;
      }
      if (message.type === 'restart-request') {
        if (animating) {
          onlineSessionRef.current?.send({
            type: 'error',
            message: '房主正在落子，请稍后再重开。',
          });
          return;
        }
        hostRestart();
        return;
      }
      return;
    }

    if (message.type === 'welcome') {
      const guestColor: Side = message.hostColor === 'w' ? 'b' : 'w';
      onlineHostColorRef.current = message.hostColor;
      setOnlineHostColor(message.hostColor);
      setPlayerColor(guestColor);
      setViewSide(guestColor);
      setMode('online');
      clearTransientState();
      applyOnlineState(message.state, 'welcome');
      return;
    }

    if (message.type === 'state') {
      applyOnlineState(message.state, message.kind);
      return;
    }

    if (message.type === 'promotion-required') {
      setOnlinePending(false);
      setPromotion({
        from: message.from as Square,
        to: message.to as Square,
        color: playerColor,
      });
      setMessage('请选择升变棋子。');
      return;
    }

    if (message.type === 'error') {
      setOnlinePending(false);
      setMessage(message.message);
    }
  }

  function hostUndo(): void {
    if (animating) return;
    if (game.history.length === 0) {
      setMessage('还没有可悔的棋');
      return;
    }
    const count = Math.min(2, game.history.length);
    for (let index = 0; index < count; index += 1) game.undo();
    setSelected(null);
    setPreview(null);
    setPromotion(null);
    setAnimating(false);
    refresh();
    broadcastOnlineState('undo');
    setMessage(`已悔棋 ${count} 步。`);
  }

  function requestOnlineUndo(): void {
    if (!onlineConnectedRef.current || onlinePending) return;
    if (onlineSessionRef.current?.send({ type: 'undo-request' })) {
      setOnlinePending(true);
      setMessage('已请求悔棋，等待房主确认…');
    }
  }

  function hostRestart(): void {
    if (animating) return;
    game.reset();
    clearTransientState();
    setViewSide(onlineHostColorRef.current);
    refresh();
    broadcastOnlineState('restart');
    setMessage('已重开对局。');
  }

  function requestOnlineRestart(): void {
    if (!onlineConnectedRef.current || onlinePending) return;
    if (onlineSessionRef.current?.send({ type: 'restart-request' })) {
      setOnlinePending(true);
      setMessage('已请求重开，等待房主确认…');
    }
  }

  async function copyRoomCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(onlineCode);
      setMessage('房间号已复制。');
    } catch {
      setMessage(`房间号：${onlineCode}`);
    }
  }

  function finishMove(record: MoveRecord): void {
    const next = game.snapshot();
    setSelected(null);
    setPreview(null);
    setPromotion(null);
    setMessage(null);
    refresh();

    if (viewMode === '2d' || !boardRef.current) {
      if (record.captured) sound.playCapture();
      else sound.playPlace();
      setAnimating(false);
      return;
    }

    setAnimating(true);
    boardRef.current.playMove(record, next, () => setAnimating(false));
  }

  function commit(from: Square, to: Square): void {
    sound.unlock();

    if (mode === 'online' && onlineRoleRef.current === 'guest') {
      const preview = game.preview(from, to);
      if (!preview) {
        setMessage('这步不符合走子规则');
        return;
      }
      if (preview.isPromotion) {
        setPreview(null);
        setPromotion({ from, to, color: snap.turn });
        return;
      }
      sendGuestMove(from, to);
      return;
    }

    const outcome = game.move(from, to);
    if (outcome.ok) {
      finishMove(outcome.record);
      if (mode === 'online' && onlineRoleRef.current === 'host') {
        broadcastOnlineState('move');
      }
      return;
    }
    if (outcome.needsPromotion) {
      setPreview(null);
      setPromotion({ from, to, color: snap.turn });
      return;
    }
    setMessage(outcome.error);
  }

  function handleSquareClick(square: Square, input: InputKind): void {
    setInputMode(input);
    if (snap.result || promotion || busy) return;
    const piece = pieces.get(square);

    if (!selected) {
      if (piece?.color === snap.turn) {
        sound.playPick();
        setSelected(square);
        setPreview(null);
        setMessage(null);
      } else if (piece) {
        sound.playPick();
        setSelected(square);
        setPreview(null);
        setMessage(
          `正在查看${sideNameZh(piece.color)}的${PIECE_NAME_ZH[piece.type]}，只做分析，不会替对方走棋。`,
        );
      }
      return;
    }

    if (square === selected) {
      setSelected(null);
      setPreview(null);
      setMessage(null);
      return;
    }

    if (targets.has(square)) {
      if (input === 'touch' && preview?.to !== square) {
        const nextPreview = game.preview(selected, square);
        if (nextPreview) {
          setPreview(nextPreview);
          return;
        }
      }
      commit(selected, square);
      return;
    }

    if (piece?.color === snap.turn) {
      sound.playPick();
      setSelected(square);
      setPreview(null);
      setMessage(null);
      return;
    }

    if (piece) {
      sound.playPick();
      setSelected(square);
      setPreview(null);
      setMessage(
        `正在查看${sideNameZh(piece.color)}的${PIECE_NAME_ZH[piece.type]}，只做分析，不会替对方走棋。`,
      );
      return;
    }

    setMessage('这枚棋子不能走到该格');
  }

  function handleHoverSquare(square: Square | null): void {
    if (snap.result || promotion || busy) return;
    setInputMode('mouse');
    if (!selected || !square || !targets.has(square)) {
      setPreview(null);
      return;
    }
    setPreview(game.preview(selected, square));
  }

  function handleTargetChip(square: Square): void {
    if (!selected || snap.result || promotion || busy) return;
    commit(selected, square);
  }

  function previewRecommendation(recommendation: Recommendation): void {
    if (busy) return;
    const nextPreview = game.preview(
      recommendation.move.from,
      recommendation.move.to,
    );
    if (!nextPreview) return;
    sound.playPick();
    setSelected(recommendation.move.from);
    setPreview(nextPreview);
    setMessage(`已预览推荐：${recommendation.label}。点击目标格确认。`);
  }

  function threatText(threat: ThreatInfo): string {
    return `${sideNameZh(threat.attacker.color)}${PIECE_NAME_ZH[threat.attacker.type]} ${threat.from} → 你的${PIECE_NAME_ZH[threat.target.type]} ${threat.to}（${levelZh(threat.level)}）`;
  }

  function choosePromotion(type: PieceType): void {
    if (!promotion) return;
    if (mode === 'online' && onlineRoleRef.current === 'guest') {
      sendGuestMove(promotion.from, promotion.to, type);
      return;
    }
    const outcome = game.move(promotion.from, promotion.to, type);
    if (outcome.ok) {
      finishMove(outcome.record);
      if (mode === 'online' && onlineRoleRef.current === 'host') {
        broadcastOnlineState('move');
      }
    } else if (!outcome.needsPromotion) {
      setMessage(outcome.error);
    }
  }

  function handleUndo(): void {
    if (promotion || animating) return;

    if (mode === 'online') {
      if (!onlineConnectedRef.current) return;
      if (onlineRoleRef.current === 'host') hostUndo();
      else requestOnlineUndo();
      return;
    }

    if (mode === 'ai') {
      cancelAi();
      const last = game.lastRecord;
      if (!last) {
        setMessage('还没有可悔的棋');
        return;
      }
      if (
        playerColor === 'b' &&
        game.history.length === 1 &&
        last.color === aiColor
      ) {
        setMessage('AI 的第一手不能单独撤销，请重开一局');
        return;
      }

      let count = last.color === playerColor ? 1 : 2;
      if (game.history.length < count) count = 1;
      let undone = null;
      for (let index = 0; index < count; index += 1) {
        undone = game.undo() ?? undone;
      }
      setSelected(null);
      setPreview(null);
      setAiAnalysis(null);
      setEvalCp(0);
      setMessage(undone ? `已悔棋：${undone.zh}` : '还没有可悔的棋');
      refresh();
      return;
    }

    const undone = game.undo();
    setSelected(null);
    setPreview(null);
    setMessage(undone ? `已悔棋：${undone.zh}` : '还没有可悔的棋');
    refresh();
  }

  function handleRestart(): void {
    if (animating) return;
    if (mode === 'online') {
      if (!onlineConnectedRef.current) return;
      if (onlineRoleRef.current === 'host') hostRestart();
      else requestOnlineRestart();
      return;
    }
    cancelAi();
    game.reset();
    clearTransientState();
    if (mode === 'ai') setViewSide(playerColor);
    refresh();
  }

  function handleFlipSide(): void {
    setViewSide((value) => (value === 'w' ? 'b' : 'w'));
    setPreview(null);
  }

  function handleToggleView(): void {
    setViewMode((value) => (value === '3d' ? '2d' : '3d'));
    setPreview(null);
    setAnimating(false);
  }

  function handleUnsupported(): void {
    setViewMode('2d');
    setMessage('当前设备不支持 WebGL，已切换到 2D 棋盘。');
  }

  function handleToggleSound(): void {
    const next = !soundOn;
    setSoundOn(next);
    sound.setEnabled(next);
    if (next) sound.playPick();
  }

  onlineMessageRef.current = handleOnlineMessage;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <p className="eyebrow">STEP 5 · 多步推演</p>
          <h1>教学式 3D 国际象棋</h1>
          <p className="subtitle">
            {viewMode === '3d'
              ? '悬停可落子格：虚线看走后威胁，红箭头看对方最可能应招。'
              : '2D 备用视图；规则、历史与教学分析完全一致。'}
          </p>
        </div>
        <div className="top-actions">
          <span className="step-chip">
            {mode === 'ai'
              ? `教学 AI · ${LEVELS[level].label}`
              : mode === 'online'
                ? `联机 · ${onlineStatusZh(onlineStatus)}`
                : '双人同屏'}
          </span>
          <button
            type="button"
            className="btn ghost"
            aria-pressed={showRecommendations}
            onClick={() => setShowRecommendations((value) => !value)}
            title="显示或隐藏 3D 推荐箭头与右侧推荐卡"
          >
            {showRecommendations ? '推荐 开' : '推荐 关'}
          </button>
          <button
            type="button"
            className="btn ghost"
            aria-pressed={showConnections}
            onClick={() => setShowConnections((value) => !value)}
            title="显示或隐藏选中棋子的威胁/保护连线"
          >
            {showConnections ? '连线 开' : '连线 关'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={handleToggleSound}
            aria-pressed={soundOn}
          >
            {soundOn ? '音效 开' : '音效 关'}
          </button>
          <button type="button" className="btn ghost" onClick={handleToggleView}>
            {viewMode === '3d' ? '切换到 2D' : '切换到 3D'}
          </button>
        </div>
      </header>

      <main className="layout">
        <section className="board-column" aria-label="棋盘区域">
          <div className={viewMode === '3d' ? 'board-stage' : 'board-frame'}>
            {viewMode === '3d' ? (
              <BoardCanvas
                ref={boardRef}
                snapshot={snap}
                selected={selected}
                targets={targets}
                preview={preview}
                side={viewSide}
                animating={animating}
                interactive={!busy}
                connections={visibleConnections}
                previewConnections={visiblePreviewConnections}
                recommendations={visibleRecommendations}
                opponentArrow={opponentArrow}
                onSquareClick={handleSquareClick}
                onHoverSquare={handleHoverSquare}
                onFlip={handleFlipSide}
                onUnsupported={handleUnsupported}
              />
            ) : (
              <Board2D
                pieces={pieces}
                selected={selected}
                targets={targets}
                lastMove={snap.lastMove}
                checkSquare={snap.checkSquare}
                flipped={viewSide === 'b'}
                onSquareClick={(square) => handleSquareClick(square, 'mouse')}
              />
            )}

            {message && (
              <div className="toast" role="status" aria-live="polite">
                {message}
              </div>
            )}

            {viewMode === '3d' && preview && inputMode === 'touch' && !busy && (
              <div className="preview-hint">
                已预览 {previewLabel} · 再点一次 {preview.to} 确认
              </div>
            )}
          </div>

          {simulationWarning && (
            <div
              className={`danger-banner ${simulationWarning.level}`}
              role="alert"
            >
              ⚠ {simulationWarning.text}
            </div>
          )}

          <div className="board-meta">
            <span className="meta-item">
              <i className="legend-dot legend-selected" /> 选中
            </span>
            <span className="meta-item">
              <i className="legend-dot legend-move" /> 可走
            </span>
            <span className="meta-item">
              <i className="legend-dot legend-capture" /> 可吃
            </span>
            <span className="meta-item">
              <i className="legend-line legend-threat" /> 威胁线
            </span>
            <span className="meta-item">
              <i className="legend-line legend-protect" /> 保护线
            </span>
            <span className="meta-item">
              <i className="legend-line legend-capture" /> 可吃线
            </span>
            <span className="meta-item">
              <i className="legend-line legend-recommend" /> 推荐
            </span>
            <span className="meta-item">
              {viewMode === '3d' ? '拖动旋转 · 滚轮缩放' : '2D 备用视图'}
            </span>
            <span className="meta-item">视角：{viewSide === 'w' ? '白方在下' : '黑方在下'}</span>
          </div>
        </section>

        <aside className="panel" aria-label="对局信息">
          <section className="card mode-card">
            <div className="card-head">
              <span>对局模式</span>
              <span className="muted">
                {mode === 'ai'
                  ? `你执${sideNameZh(playerColor)}`
                  : mode === 'online'
                    ? `${onlineRole === 'host' ? '房主' : '客人'} · ${onlineStatusZh(onlineStatus)}`
                    : '同一设备轮流'}
              </span>
            </div>
            <div className="mode-actions">
              <button
                type="button"
                className={`btn ${mode === 'pvp' ? 'primary' : ''}`}
                onClick={startPvpGame}
              >
                双人同屏
              </button>
              <button
                type="button"
                className={`btn ${mode === 'ai' ? 'primary' : ''}`}
                onClick={() => {
                  setSetupColor(playerColor);
                  setSetupLevel(level);
                  setAiSetupOpen(true);
                }}
              >
                教学 AI
              </button>
              <button
                type="button"
                className={`btn ${mode === 'online' ? 'primary' : ''}`}
                onClick={openOnlineDialog}
              >
                联机
              </button>
            </div>
            {mode === 'ai' && (
              <p className="muted small">
                难度：{LEVELS[level].label} ·{' '}
                {aiThinking ? 'AI 思考中…' : '轮到你时引擎会自动应招'}
              </p>
            )}
            {mode === 'online' && (
              <p className="muted small">
                {onlineConnected
                  ? `房间 ${onlineCode} · 你执${sideNameZh(playerColor)}`
                  : onlineStatusZh(onlineStatus)}
                {onlineConnected && (
                  <button
                    type="button"
                    className="inline-link"
                    onClick={exitOnline}
                  >
                    退出联机
                  </button>
                )}
              </p>
            )}
          </section>

          <section className="card status-card" aria-live="polite">
            <div className="card-head">
              <span>对局状态</span>
              <span className="muted">第 {snap.moveNumber} 回合</span>
            </div>
            {snap.result ? (
              <>
                <p className="result-label">{snap.result.label}</p>
                <p className="muted small">本局已结束。可以悔棋回看，或重开一局。</p>
                <button type="button" className="btn primary" onClick={handleRestart}>
                  再来一局
                </button>
              </>
            ) : (
              <>
                <div className="turn-row">
                  <span className={`turn-dot ${snap.turn}`} aria-hidden="true" />
                  <strong>轮到{sideNameZh(snap.turn)}走棋</strong>
                  {snap.inCheck && <span className="badge danger">将军</span>}
                  {animating && <span className="badge">落子中…</span>}
                  {aiThinking && <span className="badge">AI 思考中…</span>}
                  {mode === 'online' && !onlineConnected && (
                    <span className="badge">等待连接…</span>
                  )}
                  {mode === 'online' && onlinePending && (
                    <span className="badge">等待房主确认…</span>
                  )}
                  {mode === 'online' && onlineStatus === 'disconnected' && (
                    <span className="badge danger">对手已断开</span>
                  )}
                </div>
                {mode === 'ai' && (
                  <div className="eval-meter" aria-label="引擎评估条">
                    <div className="eval-meter-labels">
                      <span>白</span>
                      <strong>{formatEval(evalCp, aiAnalysis?.mateIn)}</strong>
                      <span>黑</span>
                    </div>
                    <div className="eval-meter-track">
                      <span style={{ width: `${evalPercent(evalCp)}%` }} />
                    </div>
                  </div>
                )}
                <p className="muted small">
                  {mode === 'ai'
                    ? 'AI 思考时棋盘暂时锁定；悔棋会撤回你上一手，并中止正在进行的计算。'
                    : mode === 'online'
                      ? onlineConnected
                        ? '联机由房主权威判定走法；你落子后等待房主同步。'
                        : '正在建立 P2P 连接，连上后棋盘才可操作。'
                      : '点棋子看可走格；悬停目标格会出现虚影，点击落子。触屏第一次点按预览，第二次确认。'}
                </p>
              </>
            )}
          </section>

          {mode === 'ai' && (
            <section className="card ai-card">
              <div className="card-head">
                <span>AI 上一步</span>
                <span>{aiThinking ? '思考中…' : aiAnalysis ? `深度 ${aiAnalysis.depth}` : '等待开局'}</span>
              </div>
              {aiThinking ? (
                <p className="ai-thinking">
                  <span className="loading-spinner" aria-hidden="true" />
                  AI 正在计算…
                </p>
              ) : aiAnalysis ? (
                <>
                  <p className="ai-summary">{aiAnalysis.summary}</p>
                  <ul className="ai-points">
                    {aiAnalysis.points.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="muted small">
                  开始 AI 对局后，这里会显示 AI 的走法与引擎评估。
                </p>
              )}
            </section>
          )}

          {showRecommendations && humanTurn && !snap.result && (
            <section className="card recommendation-card">
              <div className="card-head">
                <span>本回合建议</span>
                <span>{recommendationsLoading ? '分析中…' : '引擎推荐'}</span>
              </div>
              {recommendationsLoading ? (
                <p className="ai-thinking">
                  <span className="loading-spinner" aria-hidden="true" />
                  正在计算最佳走法…
                </p>
              ) : recommendations.length > 0 ? (
                <div className="recommendation-list">
                  {recommendations[0] && (
                    <button
                      type="button"
                      className="recommendation best"
                      onClick={() => previewRecommendation(recommendations[0])}
                    >
                      <span className="rec-top">
                        <span className="rec-rank">最佳</span>
                        <strong>{recommendations[0].label}</strong>
                        <span className="rec-score">
                          {formatEvalForSide(
                            recommendations[0].scoreCp,
                            perspectiveColor,
                            recommendations[0].mateIn,
                          )}
                        </span>
                      </span>
                      <span className="rec-reasons">
                        {recommendations[0].reasons.join(' · ')}
                      </span>
                      {recommendations[0].strategy.length > 0 && (
                        <span className="rec-strategy">
                          大局：{recommendations[0].strategy.join(' · ')}
                        </span>
                      )}
                      <span className={`rec-risk ${recommendations[0].risk}`}>
                        {RISK_LABEL[recommendations[0].risk]}
                      </span>
                    </button>
                  )}
                  {recommendations.slice(1).map((recommendation) => (
                    <button
                      type="button"
                      key={`${recommendation.rank}-${recommendation.move.san}`}
                      className="recommendation alternative"
                      onClick={() => previewRecommendation(recommendation)}
                    >
                      <span className="rec-top">
                        <span className="rec-rank">备选</span>
                        <strong>{recommendation.label}</strong>
                        <span className="rec-score">
                          {formatEvalForSide(
                            recommendation.scoreCp,
                            perspectiveColor,
                            recommendation.mateIn,
                          )}
                        </span>
                      </span>
                      <span className="rec-reasons">
                        {recommendation.reasons.join(' · ')}
                      </span>
                      {recommendation.strategy.length > 0 && (
                        <span className="rec-strategy">
                          大局：{recommendation.strategy.join(' · ')}
                        </span>
                      )}
                      <span className={`rec-risk ${recommendation.risk}`}>
                        {RISK_LABEL[recommendation.risk]}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted small">这回合暂时没有可用的推荐。</p>
              )}
              <details className="strategy-help">
                <summary>大局观怎么看？</summary>
                <ul>
                  <li>占据中心：控制 d4/e4/d5/e5，棋子更活跃。</li>
                  <li>子力出动：马、象离开底线，尽早参战。</li>
                  <li>王的安全：易位、兵盾完整，别让王暴露。</li>
                  <li>空间优势：己方可走的格更多，调度更从容。</li>
                </ul>
              </details>
            </section>
          )}

          {!selected && (
            <section className="card threat-card">
              <div className="card-head">
                <span>当前威胁</span>
                <span>{threatsAgainstPlayer.length} 条</span>
              </div>
              {threatsAgainstPlayer.length > 0 ? (
                <>
                  <ul className="threat-list">
                    {threatsAgainstPlayer.slice(0, 3).map((threat) => (
                      <li key={`${threat.from}-${threat.to}`}>
                        <span className={`threat-dot ${threat.level}`} />
                        {threatText(threat)}
                      </li>
                    ))}
                  </ul>
                  {threatsAgainstPlayer.length > 3 && (
                    <p className="muted small">
                      还有 {threatsAgainstPlayer.length - 3} 条，选中棋子查看详情。
                    </p>
                  )}
                </>
              ) : (
                <p className="muted small">暂时没有对方棋子直接威胁你的棋子。</p>
              )}
            </section>
          )}

          <section className="card">
            <div className="card-head">
              <span>选中棋子</span>
              {selected && <span className="muted">{selected}</span>}
            </div>
            {selectedInsight && selectedPiece ? (
              <div className="selected-body">
                <div className="piece-line">
                  <span className={`piece big ${selectedPiece.color}`} aria-hidden="true">
                    {PIECE_GLYPH[selectedPiece.type]}
                  </span>
                  <div>
                    <strong>
                      {sideNameZh(selectedPiece.color)}
                      {PIECE_NAME_ZH[selectedPiece.type]}
                    </strong>
                    <p className="muted small">
                      价值 {pieceValueLabel(selectedPiece.type)} · 位于 {selectedPiece.square}
                    </p>
                  </div>
                </div>

                <p className="insight-summary">{selectedInsight.summary}</p>
                <ul className="insight-points">
                  {selectedInsight.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>

                {preview && ghostInsight && (
                  <div className="ghost-preview">
                    <strong>如果走 {previewLabel}</strong>
                    <p>{ghostInsight.summary}</p>
                    {ghostStrategy.length > 0 && (
                      <p className="ghost-strategy">
                        大局：{ghostStrategy.join(' · ')}
                      </p>
                    )}
                    {candidateLoading && (
                      <p className="muted small">
                        正在推演对方最可能的应招…
                      </p>
                    )}
                    {candidate && (
                      <div className="simulation-line">
                        <p>
                          <strong>推演：</strong>你 {previewLabel}
                          {candidate.reply
                            ? ` → 对方 ${searchLineLabel(candidate.reply)}`
                            : candidate.terminal === 'checkmate'
                              ? ' → 对方无棋可走，你将死对方'
                              : candidate.terminal === 'draw'
                                ? ' → 对方无棋可走，和棋'
                                : ' → 对方无棋可走'}
                          {candidate.next
                            ? ` → 你 ${searchLineLabel(candidate.next)}`
                            : ''}
                        </p>
                        {candidate.reply && (
                          <p>
                            对方最可能：{searchLineLabel(candidate.reply)}
                          </p>
                        )}
                      </div>
                    )}
                    {simulationWarning && (
                      <p
                        className={`simulation-warning ${simulationWarning.level}`}
                      >
                        {simulationWarning.text}
                      </p>
                    )}
                    <p className="muted small">
                      {showConnections
                        ? ghostConnectionSet.total > 0
                          ? `棋盘上的虚线就是走完后的预测关系：最多显示 ${ghostConnectionSet.connections.length} 条，共 ${ghostConnectionSet.total} 条。`
                          : '走后没有新的威胁或保护关系。'
                        : '当前“连线”开关已关闭。'}
                    </p>
                  </div>
                )}

                {selectedInsight.isOwn && recommendedForPiece && (
                  <button
                    type="button"
                    className="piece-recommendation"
                    onClick={() => previewRecommendation(recommendedForPiece)}
                  >
                    <span>推荐这枚棋子走</span>
                    <strong>{recommendedForPiece.label}</strong>
                    <span>
                      {recommendedForPiece.reasons.join(' · ')}
                      {recommendedForPiece.strategy.length > 0
                        ? ` · 大局：${recommendedForPiece.strategy.join(' · ')}`
                        : ''}
                    </span>
                  </button>
                )}

                {showRecommendations && selectedInsight.isOwn && !recommendedForPiece && (
                  <p className="muted small">
                    这枚棋子目前没有进入引擎前三的推荐走法。
                  </p>
                )}

                {showConnections &&
                  connectionSet.total > connectionSet.connections.length && (
                    <p className="muted small">
                      棋盘只画了最关键的 {connectionSet.connections.length} 条线，还有{' '}
                      {connectionSet.total - connectionSet.connections.length} 条关系未显示。
                    </p>
                  )}

                {!showConnections && (
                  <p className="muted small">
                    连线已关闭；可在顶栏“连线”重新打开。
                  </p>
                )}

                {selectedInsight.isOwn && targets.size > 0 && (
                  <>
                    <p className="section-label">
                      合法走法 {targets.size} 个（棋盘上已高亮）
                    </p>
                    <div className="chips">
                      {[...targets.entries()].map(([square, move]) => (
                        <button
                          type="button"
                          key={square}
                          className={`chip ${move.isCapture ? 'chip-capture' : ''}`}
                          onClick={() => handleTargetChip(square)}
                          disabled={busy || Boolean(promotion)}
                        >
                          {square}
                          {move.isCapture ? ' 吃' : ''}
                          {move.isPromotion ? ' 升变' : ''}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <p className="muted small">
                点击任意棋子查看价值、威胁与保护；点敌方棋子，看它正在威胁你什么。
              </p>
            )}
          </section>

          <section className="card history-card">
            <div className="card-head">
              <span>走子历史</span>
              <span className="muted">{records.length} 步</span>
            </div>
            <div className="history" ref={historyRef} role="log" aria-label="走子历史">
              {rows.length === 0 && <p className="muted small">还没有走子。</p>}
              {rows.map((row) => (
                <div className="history-row" key={row.no}>
                  <span className="move-no">{row.no}.</span>
                  <span className="move-cell">{row.white?.zh ?? ''}</span>
                  <span className="move-cell">{row.black?.zh ?? ''}</span>
                </div>
              ))}
            </div>
            <div className="history-actions">
              <button
                type="button"
                className="btn"
                onClick={handleUndo}
                disabled={
                  records.length === 0 ||
                  Boolean(promotion) ||
                  animating ||
                  (mode === 'online' && (!onlineConnected || onlinePending))
                }
              >
                悔棋
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={handleRestart}
                disabled={
                  animating || (mode === 'online' && (!onlineConnected || onlinePending))
                }
              >
                重开
              </button>
            </div>
          </section>

          <p className="footnote">
            Step 5：虚影走法推演 · 对手最佳应招 · 送子红字警告 · 推荐/连线开关 · 大局观解析。
          </p>
        </aside>
      </main>

      {onlineOpen && (
        <div className="overlay" role="presentation">
          <div
            className="dialog online-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="online-title"
          >
            <p className="eyebrow">PeerJS · P2P</p>
            <h2 id="online-title">联机对战</h2>

            {onlineView === 'menu' && (
              <>
                {onlineConnected ? (
                  <>
                    <p className="online-status-line">
                      房间 <strong>{onlineCode}</strong> ·{' '}
                      {onlineStatusZh(onlineStatus)}
                    </p>
                    <p className="muted small">
                      你执{sideNameZh(playerColor)}。关闭窗口不会断线。
                    </p>
                    <button type="button" className="btn" onClick={exitOnline}>
                      退出联机
                    </button>
                  </>
                ) : (
                  <>
                    <div className="online-menu">
                      <button
                        type="button"
                        className="choice online-choice"
                        onClick={() => {
                          setOnlineView('create');
                          setOnlineError(null);
                        }}
                      >
                        <strong>创建房间</strong>
                        <span className="muted small">
                          生成 6 位房间号，等朋友加入
                        </span>
                      </button>
                      <button
                        type="button"
                        className="choice online-choice"
                        onClick={() => {
                          setOnlineView('join');
                          setOnlineError(null);
                        }}
                      >
                        <strong>加入房间</strong>
                        <span className="muted small">
                          输入朋友发来的 6 位房间号
                        </span>
                      </button>
                    </div>
                    <p className="muted small">
                      PeerJS 只负责点对点握手；棋局由房主校验后同步。无需后端服务器。
                    </p>
                  </>
                )}
              </>
            )}

            {onlineView === 'create' && (
              <>
                {onlineStatus === 'idle' ? (
                  <>
                    <p className="section-label">你执</p>
                    <div className="choice-row">
                      {(['w', 'b'] as Side[]).map((color) => (
                        <button
                          type="button"
                          key={color}
                          className={`choice ${onlineHostColor === color ? 'active' : ''}`}
                          onClick={() => setOnlineHostColor(color)}
                        >
                          {sideNameZh(color)}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => startHostOnline(onlineHostColor)}
                    >
                      创建房间
                    </button>
                  </>
                ) : (
                  <>
                    {onlineCode ? (
                      <p className="online-code">{onlineCode}</p>
                    ) : (
                      <p className="muted">正在生成房间号…</p>
                    )}
                    <p className="online-status-line">
                      {onlineStatusZh(onlineStatus)}
                    </p>
                    {onlineCode && (
                      <button type="button" className="btn" onClick={copyRoomCode}>
                        复制房间号
                      </button>
                    )}
                    {onlineError && <p className="online-error">{onlineError}</p>}
                    {(onlineStatus === 'waiting' || onlineStatus === 'error') && (
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => startHostOnline(onlineHostColor)}
                      >
                        重新创建
                      </button>
                    )}
                  </>
                )}
              </>
            )}

            {onlineView === 'join' && (
              <>
                {onlineConnected ? (
                  <>
                    <p className="online-status-line">
                      房间 <strong>{onlineCode}</strong> ·{' '}
                      {onlineStatusZh(onlineStatus)}
                    </p>
                    <p className="muted small">
                      你执{sideNameZh(playerColor)}。
                    </p>
                  </>
                ) : (
                  <>
                    <p className="section-label">房主发来的 6 位房间号</p>
                    <input
                      className="online-input"
                      inputMode="numeric"
                      maxLength={6}
                      value={onlineJoinCode}
                      onChange={(event) =>
                        setOnlineJoinCode(
                          event.target.value.replace(/\D/g, '').slice(0, 6),
                        )
                      }
                      placeholder="例如 482713"
                      aria-label="6 位房间号"
                    />
                    <button
                      type="button"
                      className="btn primary"
                      disabled={
                        onlineJoinCode.length !== 6 ||
                        onlineStatus === 'connecting'
                      }
                      onClick={() => joinOnline(onlineJoinCode)}
                    >
                      加入房间
                    </button>
                    <p className="muted small">
                      {onlineStatusZh(onlineStatus)}
                      {onlineStatus === 'connecting' ? '，请稍候…' : ''}
                    </p>
                    {onlineError && <p className="online-error">{onlineError}</p>}
                  </>
                )}
              </>
            )}

            <button
              type="button"
              className="btn ghost"
              onClick={onlineConnected ? () => setOnlineOpen(false) : closeOnlineDialog}
            >
              {onlineConnected ? '关闭窗口' : '取消'}
            </button>
          </div>
        </div>
      )}

      {aiSetupOpen && (
        <div className="overlay" role="presentation">
          <div
            className="dialog ai-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-setup-title"
          >
            <p className="eyebrow">教学 AI</p>
            <h2 id="ai-setup-title">选择执子与难度</h2>

            <p className="section-label">你执</p>
            <div className="choice-row">
              {(['w', 'b'] as Side[]).map((color) => (
                <button
                  type="button"
                  key={color}
                  className={`choice ${setupColor === color ? 'active' : ''}`}
                  onClick={() => setSetupColor(color)}
                >
                  {sideNameZh(color)}
                </button>
              ))}
            </div>

            <p className="section-label">难度</p>
            <div className="level-grid">
              {(Object.keys(LEVELS) as Level[]).map((key) => (
                <button
                  type="button"
                  key={key}
                  className={`choice level-choice ${setupLevel === key ? 'active' : ''}`}
                  onClick={() => setSetupLevel(key)}
                >
                  <strong>{LEVELS[key].label}</strong>
                  <span className="muted small">
                    深度 {LEVELS[key].depth} · {Math.round(LEVELS[key].timeMs / 100) / 10}s
                  </span>
                </button>
              ))}
            </div>

            <button
              type="button"
              className="btn primary"
              onClick={() => startAiGame(setupColor, setupLevel)}
            >
              开始对局
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setAiSetupOpen(false)}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {promotion && (
        <div className="overlay" role="presentation">
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="promotion-title">
            <p className="eyebrow">兵到达底线</p>
            <h2 id="promotion-title">选择升变棋子</h2>
            <div className="promo-grid">
              {(['q', 'r', 'b', 'n'] as PieceType[]).map((type) => (
                <button
                  type="button"
                  key={type}
                  className="promo-choice"
                  onClick={() => choosePromotion(type)}
                >
                  <span className={`piece ${promotion.color}`} aria-hidden="true">
                    {PIECE_GLYPH[type]}
                  </span>
                  <span className="promo-name">{PIECE_NAME_ZH[type]}</span>
                  <span className="promo-value">价值 {pieceValueLabel(type)}</span>
                </button>
              ))}
            </div>
            <button type="button" className="btn ghost" onClick={() => setPromotion(null)}>
              取消，先不走
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

