import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { Square } from 'chess.js';
import type {
  BoardConnection,
  LegalMove,
  MovePreview,
  MoveRecord,
  PositionSnapshot,
  Recommendation,
  Side,
} from '../domain/types';
import { BoardScene, type InputKind } from '../three/BoardScene';
import { loadPieceAssets } from '../three/pieces';

export interface BoardCanvasHandle {
  playMove: (
    record: MoveRecord,
    snapshot: PositionSnapshot,
    onComplete: () => void,
  ) => void;
  resetView: () => void;
}

interface BoardCanvasProps {
  snapshot: PositionSnapshot;
  selected: Square | null;
  targets: ReadonlyMap<Square, LegalMove>;
  preview: MovePreview | null;
  side: Side;
  animating: boolean;
  interactive: boolean;
  connections: BoardConnection[];
  previewConnections: BoardConnection[];
  recommendations: Recommendation[];
  opponentArrow: { from: Square; to: Square } | null;
  onSquareClick: (square: Square, input: InputKind) => void;
  onHoverSquare: (square: Square | null) => void;
  onFlip: () => void;
  onUnsupported?: () => void;
}

export const BoardCanvas = forwardRef<BoardCanvasHandle, BoardCanvasProps>(
  function BoardCanvas(props, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const sceneRef = useRef<BoardScene | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const propsRef = useRef(props);
    propsRef.current = props;

    const handlersRef = useRef({
      onSquareClick: props.onSquareClick,
      onHoverSquare: props.onHoverSquare,
      onUnsupported: props.onUnsupported,
    });
    handlersRef.current = {
      onSquareClick: props.onSquareClick,
      onHoverSquare: props.onHoverSquare,
      onUnsupported: props.onUnsupported,
    };

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      let cancelled = false;
      let scene: BoardScene | null = null;

      void (async () => {
        const assets = await loadPieceAssets();
        if (cancelled) {
          assets.dispose();
          return;
        }

        try {
          scene = new BoardScene(
            container,
            {
              onSquareClick: (square, input) =>
                handlersRef.current.onSquareClick(square, input),
              onHoverSquare: (square) =>
                handlersRef.current.onHoverSquare(square),
            },
            assets,
          );
        } catch (error) {
          assets.dispose();
          container.replaceChildren();
          setLoading(false);
          setFailed(
            error instanceof Error ? error.message : '无法创建 WebGL 场景',
          );
          handlersRef.current.onUnsupported?.();
          return;
        }

        sceneRef.current = scene;
        const current = propsRef.current;
        scene.setSnapshot(current.snapshot);
        scene.setSelection(current.selected, current.targets);
        scene.setPreview(current.preview);
        scene.setSide(current.side);
        scene.setInteractive(current.interactive);
        scene.setConnections(current.connections);
        scene.setPreviewConnections(current.previewConnections);
        scene.setRecommendations(current.recommendations);
        scene.setOpponentArrow(current.opponentArrow);
        setLoading(false);
        setFailed(null);
      })();

      return () => {
        cancelled = true;
        sceneRef.current = null;
        scene?.dispose();
      };
    }, []);

    useEffect(() => {
      if (!props.animating) sceneRef.current?.setSnapshot(props.snapshot);
    }, [props.snapshot, props.animating]);

    useEffect(() => {
      sceneRef.current?.setSelection(props.selected, props.targets);
    }, [props.selected, props.targets]);

    useEffect(() => {
      sceneRef.current?.setPreview(props.preview);
    }, [props.preview]);

    useEffect(() => {
      sceneRef.current?.setSide(props.side);
    }, [props.side]);

    useEffect(() => {
      sceneRef.current?.setInteractive(props.interactive);
    }, [props.interactive]);

    useEffect(() => {
      sceneRef.current?.setConnections(props.connections);
    }, [props.connections]);

    useEffect(() => {
      sceneRef.current?.setPreviewConnections(props.previewConnections);
    }, [props.previewConnections]);

    useEffect(() => {
      sceneRef.current?.setRecommendations(props.recommendations);
    }, [props.recommendations]);

    useEffect(() => {
      sceneRef.current?.setOpponentArrow(props.opponentArrow);
    }, [props.opponentArrow]);

    useImperativeHandle(
      ref,
      () => ({
        playMove(record, snapshot, onComplete) {
          const active = sceneRef.current;
          if (!active) {
            onComplete();
            return;
          }
          active.playMove(record, snapshot, onComplete);
        },
        resetView() {
          sceneRef.current?.resetView();
        },
      }),
      [],
    );

    return (
      <div className="three-stage" ref={containerRef}>
        <div className="view-controls" aria-label="视角控制">
          <button
            type="button"
            className="view-btn wide"
            onClick={() => sceneRef.current?.resetView()}
            title="复位视角"
          >
            复位
          </button>
          <button
            type="button"
            className="view-btn wide"
            onClick={props.onFlip}
            title="翻转视角"
          >
            翻转
          </button>
          <button
            type="button"
            className="view-btn"
            onClick={() => sceneRef.current?.zoom(1.15)}
            aria-label="放大"
            title="放大"
          >
            ＋
          </button>
          <button
            type="button"
            className="view-btn"
            onClick={() => sceneRef.current?.zoom(0.87)}
            aria-label="缩小"
            title="缩小"
          >
            －
          </button>
        </div>

        {loading && !failed && (
          <div className="board-loading" role="status">
            <span className="loading-spinner" aria-hidden="true" />
            正在加载 3D 棋子…
          </div>
        )}

        {failed && (
          <div className="board-fallback" role="alert">
            <strong>3D 视图不可用</strong>
            <span>当前浏览器或设备未能创建 WebGL，已切换到 2D 棋盘。</span>
          </div>
        )}
      </div>
    );
  },
);
