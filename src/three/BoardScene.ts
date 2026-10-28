import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Square } from 'chess.js';
import type {
  BoardConnection,
  LegalMove,
  MovePreview,
  MoveRecord,
  PieceInfo,
  PositionSnapshot,
  Recommendation,
  Side,
} from '../domain/types';
import { createBoard, type BoardView } from './board';
import { HighlightLayer } from './highlights';
import type { PieceAssets } from './pieces';
import { clamp, easeInOutCubic, easeOutCubic, squareToWorld, worldToSquare } from './square';
import { sound } from '../audio/sound';

export type InputKind = 'mouse' | 'touch';

export interface BoardSceneCallbacks {
  onSquareClick: (square: Square, input: InputKind) => void;
  onHoverSquare: (square: Square | null) => void;
}

interface Tween {
  elapsed: number;
  duration: number;
  delay: number;
  update: (progress: number) => void;
  done?: () => void;
}

interface CameraTween {
  elapsed: number;
  duration: number;
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
}

const CAMERA_TARGET = new THREE.Vector3(0, 0, 0);

/**
 * Three.js 场景。只消费领域层的快照/预览与点击回调，
 * 不判断任何走子合法性。
 */
export class BoardScene {
  private readonly container: HTMLElement;
  private readonly callbacks: BoardSceneCallbacks;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly assets: PieceAssets;
  private readonly board: BoardView;
  private readonly highlights = new HighlightLayer();
  private readonly piecesGroup = new THREE.Group();
  private readonly ghostGroup = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly pieceMeshes = new Map<Square, THREE.Mesh>();
  private readonly clock = new THREE.Clock();
  private readonly tweens: Tween[] = [];
  private readonly resizeObserver: ResizeObserver;

  private snapshot: PositionSnapshot | null = null;
  private selected: Square | null = null;
  private targets = new Map<Square, LegalMove>();
  private preview: MovePreview | null = null;
  private hiddenTarget: THREE.Mesh | null = null;
  private hovered: Square | null = null;
  private interactive = true;
  private animating = false;
  private side: Side = 'w';
  private initialSideApplied = false;
  private raf = 0;
  private disposed = false;
  private pointerStart: { x: number; y: number; time: number; id: number } | null = null;
  private cameraTween: CameraTween | null = null;

  constructor(
    container: HTMLElement,
    callbacks: BoardSceneCallbacks,
    assets: PieceAssets,
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.assets = assets;

    this.camera = new THREE.PerspectiveCamera(27, 1, 0.1, 100);
    this.camera.position.set(0, 17, 13.2);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = 'three-canvas';
    container.appendChild(this.renderer.domElement);

    this.assets = assets;
    this.board = createBoard();
    this.scene.add(
      this.board.group,
      this.piecesGroup,
      this.ghostGroup,
      this.highlights.group,
    );

    this.setupLights();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.setupControls();
    this.setupEvents();
    this.resize();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    window.addEventListener('resize', this.resize);

    this.clock.start();
    this.loop();

    if (import.meta.env.DEV) {
      (window as unknown as { __chessScene?: BoardScene }).__chessScene = this;
    }
  }

  setSnapshot(snapshot: PositionSnapshot): void {
    if (this.animating) {
      this.snapshot = snapshot;
      return;
    }
    this.clearPreviewVisuals();
    this.snapshot = snapshot;
    this.syncPieces(snapshot);
    this.highlights.update(snapshot, this.selected, this.targets, this.preview);
  }

  setSelection(selected: Square | null, targets: ReadonlyMap<Square, LegalMove>): void {
    this.selected = selected;
    this.targets = new Map(targets);
    if (this.preview) {
      const stillValid =
        selected !== null &&
        this.preview.from === selected &&
        this.targets.has(this.preview.to);
      if (!stillValid) this.setPreview(null);
    }
    if (this.snapshot) {
      this.highlights.update(this.snapshot, this.selected, this.targets, this.preview);
    }
  }

  setPreview(preview: MovePreview | null): void {
    this.clearPreviewVisuals();
    this.preview = preview;
    if (preview) {
      this.hidePreviewTarget(preview);
      this.buildGhost(preview);
    }
    if (this.snapshot) {
      this.highlights.update(this.snapshot, this.selected, this.targets, this.preview);
    }
  }

  setInteractive(interactive: boolean): void {
    this.interactive = interactive;
    this.renderer.domElement.style.cursor = interactive ? 'grab' : 'progress';
  }

  setConnections(connections: BoardConnection[]): void {
    this.highlights.setConnections(connections);
  }

  setPreviewConnections(connections: BoardConnection[]): void {
    this.highlights.setPreviewConnections(connections);
  }

  setOpponentArrow(arrow: { from: Square; to: Square } | null): void {
    this.highlights.setOpponentArrow(arrow);
  }

  setRecommendations(recommendations: Recommendation[]): void {
    this.highlights.setRecommendations(recommendations);
  }

  setSide(side: Side): void {
    if (!this.initialSideApplied) {
      this.side = side;
      this.camera.position.copy(this.defaultCameraPosition(side));
      this.controls.target.copy(CAMERA_TARGET);
      this.controls.update();
      this.initialSideApplied = true;
      return;
    }
    if (this.side === side) return;
    this.side = side;
    this.animateCamera(this.defaultCameraPosition(side), CAMERA_TARGET, 650);
  }

  resetView(): void {
    this.animateCamera(this.defaultCameraPosition(this.side), CAMERA_TARGET, 500);
  }

  flipView(): void {
    const target = this.controls.target.clone();
    const offset = this.camera.position.clone().sub(target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += Math.PI;
    const next = new THREE.Vector3().setFromSpherical(spherical).add(target);
    this.animateCamera(next, target, 550);
  }

  zoom(factor: number): void {
    const target = this.controls.target.clone();
    const offset = this.camera.position.clone().sub(target);
    const distance = clamp(
      offset.length() * factor,
      this.controls.minDistance,
      this.controls.maxDistance,
    );
    const next = target.clone().add(offset.setLength(distance));
    this.animateCamera(next, target, 220);
  }

  /** 给调试/未来的 DOM 标注用：格子中心在屏幕上的坐标。 */
  projectSquare(square: Square): { x: number; y: number } {
    const point = squareToWorld(square, 0.1).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (point.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-point.y * 0.5 + 0.5) * rect.height,
    };
  }

  playMove(
    record: MoveRecord,
    nextSnapshot: PositionSnapshot,
    onComplete: () => void,
  ): void {
    if (this.disposed) {
      onComplete();
      return;
    }
    if (this.animating) {
      this.animating = false;
      this.applySnapshot(nextSnapshot);
      onComplete();
      return;
    }

    const mover = this.pieceMeshes.get(record.from);
    if (!mover) {
      this.applySnapshot(nextSnapshot);
      if (record.captured) sound.playCapture();
      else sound.playPlace();
      onComplete();
      return;
    }

    this.clearPreviewVisuals();
    this.highlights.setRecommendations([]);
    this.highlights.setConnections([]);
    this.highlights.setPreviewConnections([]);
    this.highlights.setOpponentArrow(null);
    this.animating = true;
    this.setInteractive(false);

    const fromPosition = squareToWorld(record.from);
    const toPosition = squareToWorld(record.to);
    const capturedSquare = record.capturedSquare;
    const captured = capturedSquare ? this.pieceMeshes.get(capturedSquare) : undefined;
    const rook = record.rook;
    const rookMesh = rook ? this.pieceMeshes.get(rook.from) : undefined;
    const isCapture = Boolean(captured);
    const duration = isCapture ? 520 : 280;
    const lift = isCapture ? 0.4 : record.piece === 'n' ? 0.4 : 0.16;

    const direction = new THREE.Vector3(
      toPosition.x - fromPosition.x,
      0,
      toPosition.z - fromPosition.z,
    );
    if (direction.lengthSq() < 0.0001) direction.set(1, 0, 0);
    direction.normalize();
    const fallAxis = new THREE.Vector3(direction.z, 0, -direction.x).normalize();

    const capturedStartPosition = captured?.position.clone();
    const capturedStartQuaternion = captured?.quaternion.clone();
    const capturedMaterials: THREE.Material[] = [];
    if (captured) {
      captured.castShadow = false;
      captured.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (object.userData.isOutline) {
          object.visible = false;
          return;
        }
        const material = object.material as THREE.Material;
        const clone = material.clone();
        clone.transparent = true;
        clone.depthWrite = false;
        object.material = clone;
        capturedMaterials.push(clone);
      });
    }

    let captureSoundPlayed = false;
    const fallQuaternion = new THREE.Quaternion();

    mover.position.copy(fromPosition);
    this.tweens.push({
      elapsed: 0,
      duration,
      delay: 0,
      update: (progress) => {
        const travel = isCapture
          ? easeOutCubic(Math.min(1, progress / 0.62))
          : progress;
        mover.position.lerpVectors(fromPosition, toPosition, travel);
        mover.position.y = Math.sin(Math.PI * travel) * lift;
        // 扑食时多冲出一小段，落位时再被拉回目标格。
        if (isCapture) {
          const overshoot = Math.sin(Math.PI * travel) * 0.1;
          mover.position.x += direction.x * overshoot;
          mover.position.z += direction.z * overshoot;
        }

        if (rookMesh && rook) {
          const rookFrom = squareToWorld(rook.from);
          const rookTo = squareToWorld(rook.to);
          rookMesh.position.lerpVectors(rookFrom, rookTo, progress);
          rookMesh.position.y = Math.sin(Math.PI * progress) * 0.06;
        }

        if (captured && capturedSquare && capturedStartPosition && capturedStartQuaternion) {
          const fall = clamp((progress - 0.1) / 0.9, 0, 1);
          const angle = easeOutCubic(fall) * 1.45;
          fallQuaternion.setFromAxisAngle(fallAxis, angle);
          captured.quaternion.copy(fallQuaternion).multiply(capturedStartQuaternion);
          // 被吃子沿“攻击方 → 被吃子”的连线方向倒下、被推走。
          captured.position
            .copy(capturedStartPosition)
            .addScaledVector(direction, fall * 0.65);
          captured.position.y = capturedStartPosition.y + Math.sin(fall * Math.PI) * 0.1;

          // 先倒下去，最后一段再消融；保证玩家能看清“被撞倒”的动作。
          const fadeProgress = clamp((fall - 0.68) / 0.32, 0, 1);
          const fade = 1 - Math.pow(fadeProgress, 1.15);
          for (const material of capturedMaterials) {
            material.opacity = fade;
          }

          if (!captureSoundPlayed && fall > 0.06) {
            sound.playCapture();
            captureSoundPlayed = true;
          }
        }
      },
      done: () => {
        if (this.disposed) return;
        if (captured && capturedSquare) {
          this.removePieceAt(capturedSquare);
          capturedMaterials.forEach((material) => material.dispose());
        }
        if (!isCapture) sound.playPlace();

        this.pieceMeshes.delete(record.from);
        this.pieceMeshes.set(record.to, mover);
        mover.userData.square = record.to;
        mover.position.copy(toPosition);
        mover.scale.setScalar(1);
        mover.quaternion.identity();

        if (rookMesh && rook) {
          this.pieceMeshes.delete(rook.from);
          this.pieceMeshes.set(rook.to, rookMesh);
          rookMesh.userData.square = rook.to;
          rookMesh.position.copy(squareToWorld(rook.to));
        }

        this.animating = false;
        this.setInteractive(true);
        this.applySnapshot(nextSnapshot);
        onComplete();
      },
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.resize);

    const element = this.renderer.domElement;
    element.removeEventListener('pointerdown', this.onPointerDown);
    element.removeEventListener('pointerup', this.onPointerUp);
    element.removeEventListener('pointermove', this.onPointerMove);
    element.removeEventListener('pointerleave', this.onPointerLeave);
    element.removeEventListener('contextmenu', this.onContextMenu);

    this.controls.dispose();
    this.highlights.dispose();
    this.board.dispose();
    this.assets.dispose();
    this.ghostGroup.clear();
    this.pieceMeshes.clear();
    this.scene.clear();
    this.renderer.dispose();
    element.remove();

    if (import.meta.env.DEV) {
      const debugWindow = window as unknown as { __chessScene?: BoardScene };
      if (debugWindow.__chessScene === this) delete debugWindow.__chessScene;
    }
  }

  private setupLights(): void {
    const hemisphere = new THREE.HemisphereLight(0xfff2dd, 0x3a2418, 1.05);
    this.scene.add(hemisphere);
    this.scene.add(new THREE.AmbientLight(0xfff4e6, 0.16));

    const key = new THREE.DirectionalLight(0xffe2b8, 2);
    key.position.set(6.5, 12, 7.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 35;
    key.shadow.camera.left = -7;
    key.shadow.camera.right = 7;
    key.shadow.camera.top = 7;
    key.shadow.camera.bottom = -7;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.025;
    this.scene.add(key);
    this.scene.add(key.target);

    const fill = new THREE.DirectionalLight(0x9db4ff, 0.65);
    fill.position.set(-7, 7, -8);
    this.scene.add(fill);

    const rim = new THREE.PointLight(0xffc98a, 18, 28, 2);
    rim.position.set(-5, 4.5, -7);
    this.scene.add(rim);
  }

  private setupControls(): void {
    this.controls.target.copy(CAMERA_TARGET);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 40;
    this.controls.minPolarAngle = 0.28;
    this.controls.maxPolarAngle = 1.3;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 0.75;
    this.controls.update();
  }

  private setupEvents(): void {
    const element = this.renderer.domElement;
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerleave', this.onPointerLeave);
    element.addEventListener('contextmenu', this.onContextMenu);
  }

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!this.interactive || this.animating || this.cameraTween) return;
    this.pointerStart = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
      id: event.pointerId,
    };
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start || start.id !== event.pointerId) return;
    if (!this.interactive || this.animating || this.disposed) return;

    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    const elapsed = performance.now() - start.time;
    if (moved > 7 || elapsed > 900) return;

    const square = this.pickSquare(event);
    if (!square) return;
    this.callbacks.onSquareClick(square, event.pointerType === 'touch' ? 'touch' : 'mouse');
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    if (this.animating || !this.interactive) return;
    if (this.pointerStart) return;
    const square = this.pickSquare(event);
    if (square === this.hovered) return;
    this.hovered = square;
    this.highlights.setHover(square);
    this.callbacks.onHoverSquare(square);
    this.renderer.domElement.style.cursor = square ? 'pointer' : 'grab';
  };

  private readonly onPointerLeave = (): void => {
    if (!this.hovered) return;
    this.hovered = null;
    this.highlights.setHover(null);
    this.callbacks.onHoverSquare(null);
    this.renderer.domElement.style.cursor = 'grab';
  };

  private pickSquare(event: PointerEvent): Square | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);

    // 以棋盘平面为准：高棋子会在屏幕空间盖住后面的格子，
    // 若先命中棋子，点 e2 可能选中前面 e1 的王。棋盘平面映射始终对应玩家看到的格子。
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.boardPlane, point)) return null;
    return worldToSquare(point);
  }

  private syncPieces(snapshot: PositionSnapshot): void {
    const next = new Map<Square, PieceInfo>();
    for (const row of snapshot.board) {
      for (const piece of row) {
        if (piece) next.set(piece.square, piece);
      }
    }

    for (const square of [...this.pieceMeshes.keys()]) {
      if (!next.has(square)) this.removePieceAt(square);
    }

    for (const [square, info] of next) {
      let mesh = this.pieceMeshes.get(square);
      if (
        !mesh ||
        mesh.userData.type !== info.type ||
        mesh.userData.color !== info.color
      ) {
        if (mesh) this.removePieceAt(square);
        mesh = this.createPieceMesh(info);
        this.pieceMeshes.set(square, mesh);
      }
      mesh.position.copy(squareToWorld(square));
      mesh.rotation.y = 0;
      mesh.visible = true;
      mesh.scale.setScalar(1);
    }
  }

  private createPieceMesh(info: PieceInfo): THREE.Mesh {
    const mesh = new THREE.Mesh(
      this.assets.geometries[info.type],
      this.assets.materials[info.color],
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.copy(squareToWorld(info.square));
    mesh.userData = {
      square: info.square,
      type: info.type,
      color: info.color,
    };

    const outline = new THREE.Mesh(
      this.assets.geometries[info.type],
      this.assets.outlineMaterials[info.color],
    );
    outline.scale.setScalar(1.025);
    outline.renderOrder = 1;
    outline.castShadow = false;
    outline.receiveShadow = false;
    outline.raycast = () => {};
    outline.userData.isOutline = true;
    mesh.add(outline);

    this.piecesGroup.add(mesh);
    return mesh;
  }

  private removePieceAt(square: Square): void {
    const mesh = this.pieceMeshes.get(square);
    if (!mesh) return;
    this.piecesGroup.remove(mesh);
    this.pieceMeshes.delete(square);
  }

  private applySnapshot(snapshot: PositionSnapshot): void {
    this.snapshot = snapshot;
    this.syncPieces(snapshot);
    this.highlights.update(snapshot, this.selected, this.targets, this.preview);
  }

  private hidePreviewTarget(preview: MovePreview): void {
    if (!preview.capturedSquare) return;
    const mesh = this.pieceMeshes.get(preview.capturedSquare);
    if (!mesh) return;
    mesh.visible = false;
    this.hiddenTarget = mesh;
  }

  private clearPreviewVisuals(): void {
    if (this.hiddenTarget) {
      this.hiddenTarget.visible = true;
      this.hiddenTarget = null;
    }
    this.ghostGroup.clear();
    this.preview = null;
  }

  private buildGhost(preview: MovePreview): void {
    const type = preview.promotion ?? preview.piece;
    const ghost = new THREE.Mesh(
      this.assets.geometries[type],
      this.assets.ghostMaterials[preview.color],
    );
    ghost.position.copy(
      squareToWorld(preview.to, preview.capturedSquare ? 0.16 : 0.03),
    );
    ghost.scale.setScalar(0.94);
    ghost.rotation.y = 0;
    ghost.renderOrder = 10;
    ghost.raycast = () => {};
    this.ghostGroup.add(ghost);

    if (preview.rook) {
      const rookGhost = new THREE.Mesh(
        this.assets.geometries.r,
        this.assets.ghostMaterials[preview.color],
      );
      rookGhost.position.copy(squareToWorld(preview.rook.to, 0.03));
      rookGhost.scale.setScalar(0.9);
      rookGhost.renderOrder = 10;
      rookGhost.raycast = () => {};
      this.ghostGroup.add(rookGhost);
    }
  }

  private defaultCameraPosition(side: Side): THREE.Vector3 {
    return new THREE.Vector3(0, 17, side === 'w' ? 13.2 : -13.2);
  }

  private animateCamera(
    position: THREE.Vector3,
    target: THREE.Vector3,
    duration: number,
  ): void {
    this.cameraTween = {
      elapsed: 0,
      duration,
      fromPosition: this.camera.position.clone(),
      toPosition: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
    };
    this.controls.enabled = false;
  }

  private updateCameraTween(delta: number): void {
    const tween = this.cameraTween;
    if (!tween) return;
    tween.elapsed += delta;
    const progress = clamp(tween.elapsed / tween.duration, 0, 1);
    const eased = easeInOutCubic(progress);
    this.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
    this.controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
    this.camera.lookAt(this.controls.target);

    if (progress >= 1) {
      this.cameraTween = null;
      this.controls.enabled = true;
      this.controls.update();
    }
  }

  private updateTweens(delta: number): void {
    for (let index = this.tweens.length - 1; index >= 0; index -= 1) {
      const tween = this.tweens[index];
      if (tween.delay > 0) {
        tween.delay -= delta;
        continue;
      }
      tween.elapsed += delta;
      const progress = clamp(tween.elapsed / tween.duration, 0, 1);
      tween.update(easeInOutCubic(progress));
      if (progress >= 1) {
        this.tweens.splice(index, 1);
        tween.done?.();
      }
    }
  }

  private readonly loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    // Clock 返回秒；动画时长全部按毫秒写，这里统一换算。
    const deltaMs = Math.min(this.clock.getDelta() * 1000, 50);
    this.updateTweens(deltaMs);
    if (this.cameraTween) {
      this.updateCameraTween(deltaMs);
    } else {
      this.controls.update();
    }
    this.highlights.tick(performance.now());
    this.renderer.render(this.scene, this.camera);
  };

  private readonly resize = (): void => {
    if (this.disposed) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  };
}
