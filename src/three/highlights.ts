import * as THREE from 'three';
import type { Square } from 'chess.js';
import type {
  BoardConnection,
  LegalMove,
  MovePreview,
  PositionSnapshot,
  Recommendation,
} from '../domain/types';
import { COLORS } from './palette';
import { squareToWorld } from './square';

/**
 * 棋盘信息层。这里只做“显示”，所有几何体和材质要么共享、要么在重建时 dispose。
 *
 * 视觉原则：
 * - 合法落子 = 底部发光方框，不再用圆点；
 * - 关系线 = 一条直线箭头，红=威胁，绿=保护，金=可吃；
 * - 推荐 = 只画最佳一条金箭头，备选留在右侧面板；
 * - 虚影 = 虚线箭头 + 锥形箭头头部。
 */
export class HighlightLayer {
  readonly group = new THREE.Group();

  private readonly marks = new THREE.Group();
  private readonly connectionsGroup = new THREE.Group();
  private readonly previewConnectionsGroup = new THREE.Group();
  private readonly recommendationsGroup = new THREE.Group();
  private readonly opponentArrowGroup = new THREE.Group();

  private readonly planeGeometry: THREE.PlaneGeometry;
  private readonly targetRingGeometry: THREE.BufferGeometry;
  private readonly targetGlowGeometry: THREE.BufferGeometry;
  private readonly selectedGeometry: THREE.RingGeometry;
  private readonly checkGeometry: THREE.RingGeometry;
  private readonly previewGeometry: THREE.RingGeometry;

  private readonly lastMoveMaterial: THREE.MeshBasicMaterial;
  private readonly selectedMaterial: THREE.MeshBasicMaterial;
  private readonly targetMaterial: THREE.MeshBasicMaterial;
  private readonly targetCaptureMaterial: THREE.MeshBasicMaterial;
  private readonly targetGlowMaterial: THREE.MeshBasicMaterial;
  private readonly checkMaterial: THREE.MeshBasicMaterial;
  private readonly previewMaterial: THREE.MeshBasicMaterial;
  private readonly hoverMaterial: THREE.MeshBasicMaterial;
  private readonly hoverLineMaterial: THREE.LineBasicMaterial;

  private readonly threatArrowMaterial: THREE.MeshBasicMaterial;
  private readonly protectArrowMaterial: THREE.MeshBasicMaterial;
  private readonly captureArrowMaterial: THREE.MeshBasicMaterial;
  private readonly recommendationArrowMaterial: THREE.MeshBasicMaterial;
  private readonly opponentArrowMaterial: THREE.MeshBasicMaterial;

  private readonly ghostThreatLineMaterial: THREE.LineDashedMaterial;
  private readonly ghostProtectLineMaterial: THREE.LineDashedMaterial;
  private readonly ghostCaptureLineMaterial: THREE.LineDashedMaterial;
  private readonly ghostThreatConeMaterial: THREE.MeshBasicMaterial;
  private readonly ghostProtectConeMaterial: THREE.MeshBasicMaterial;
  private readonly ghostCaptureConeMaterial: THREE.MeshBasicMaterial;

  private checkMesh: THREE.Mesh | null = null;
  private previewMesh: THREE.Mesh | null = null;
  private hovered: Square | null = null;

  constructor() {
    this.group.add(
      this.marks,
      this.connectionsGroup,
      this.previewConnectionsGroup,
      this.recommendationsGroup,
      this.opponentArrowGroup,
    );
    this.marks.renderOrder = 1;
    this.connectionsGroup.renderOrder = 8;
    this.previewConnectionsGroup.renderOrder = 10;
    this.recommendationsGroup.renderOrder = 9;
    this.opponentArrowGroup.renderOrder = 7;

    this.planeGeometry = this.flatPlane();
    this.targetRingGeometry = this.flatSquareRing(0.34, 0.45);
    this.targetGlowGeometry = this.flatSquareRing(0.4, 0.49);
    this.selectedGeometry = this.flatRing(0.41, 0.48);
    this.checkGeometry = this.flatRing(0.36, 0.47);
    this.previewGeometry = this.flatRing(0.43, 0.5);

    this.lastMoveMaterial = this.flatMaterial(COLORS.lastMove, 0.2);
    this.selectedMaterial = this.flatMaterial(COLORS.selection, 0.95);
    this.targetMaterial = this.flatMaterial(COLORS.goldBright, 0.95);
    this.targetCaptureMaterial = this.flatMaterial(COLORS.danger, 0.9);
    this.targetGlowMaterial = this.flatMaterial(COLORS.gold, 0.18);
    this.checkMaterial = this.flatMaterial(COLORS.danger, 0.8);
    this.previewMaterial = this.flatMaterial(COLORS.goldBright, 0.55);
    this.hoverMaterial = this.flatMaterial(COLORS.selection, 0.07);
    this.hoverLineMaterial = new THREE.LineBasicMaterial({
      color: COLORS.goldBright,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      toneMapped: false,
    });

    this.threatArrowMaterial = this.arrowMaterial(0xe0604f, 0.9);
    this.protectArrowMaterial = this.arrowMaterial(0x6fbf8b, 0.82);
    this.captureArrowMaterial = this.arrowMaterial(0xe0b45e, 0.84);
    this.recommendationArrowMaterial = this.arrowMaterial(0xf3cd7d, 0.9);
    this.opponentArrowMaterial = this.arrowMaterial(0xd05a4f, 0.34);

    this.ghostThreatLineMaterial = this.dashedLineMaterial(0xff7b68, 0.9);
    this.ghostProtectLineMaterial = this.dashedLineMaterial(0x7fd8a0, 0.85);
    this.ghostCaptureLineMaterial = this.dashedLineMaterial(0xf0c56b, 0.85);
    this.ghostThreatConeMaterial = this.arrowMaterial(0xff7b68, 0.65);
    this.ghostProtectConeMaterial = this.arrowMaterial(0x7fd8a0, 0.6);
    this.ghostCaptureConeMaterial = this.arrowMaterial(0xf0c56b, 0.6);
  }

  /** 最多 3 条关系箭头：红=威胁，绿=保护，金=可吃。 */
  setConnections(connections: BoardConnection[]): void {
    this.clearGroup(this.connectionsGroup);
    connections.slice(0, 3).forEach((connection, index) => {
      const material =
        connection.kind === 'threat'
          ? this.threatArrowMaterial
          : connection.kind === 'protect'
            ? this.protectArrowMaterial
            : this.captureArrowMaterial;
      this.addArrow(
        this.connectionsGroup,
        connection.from,
        connection.to,
        material,
        0.012,
        0.05,
        0.18,
        0.12,
        8 + index,
      );
    });
  }

  /** 推荐只保留最佳的一条金箭头，备选在面板里看。 */
  setRecommendations(recommendations: Recommendation[]): void {
    this.clearGroup(this.recommendationsGroup);
    const best = recommendations.find((item) => item.rank === 1);
    if (!best) return;
    this.addArrow(
      this.recommendationsGroup,
      best.move.from,
      best.move.to,
      this.recommendationArrowMaterial,
      0.018,
      0.06,
      0.2,
      0.16,
      9,
    );
  }

  /** 虚影预测：虚线 + 锥形头，仍然只画最多 3 条。 */
  setPreviewConnections(connections: BoardConnection[]): void {
    this.clearGroup(this.previewConnectionsGroup);
    connections.slice(0, 3).forEach((connection, index) => {
      const lineMaterial =
        connection.kind === 'threat'
          ? this.ghostThreatLineMaterial
          : connection.kind === 'protect'
            ? this.ghostProtectLineMaterial
            : this.ghostCaptureLineMaterial;
      const coneMaterial =
        connection.kind === 'threat'
          ? this.ghostThreatConeMaterial
          : connection.kind === 'protect'
            ? this.ghostProtectConeMaterial
            : this.ghostCaptureConeMaterial;
      this.addDashedArrow(
        this.previewConnectionsGroup,
        connection.from,
        connection.to,
        lineMaterial,
        coneMaterial,
        0.13,
        10 + index,
      );
    });
  }

  /** 对手最可能应招：半透明直箭头，只一条。 */
  setOpponentArrow(arrow: { from: Square; to: Square } | null): void {
    this.clearGroup(this.opponentArrowGroup);
    if (!arrow) return;
    this.addArrow(
      this.opponentArrowGroup,
      arrow.from,
      arrow.to,
      this.opponentArrowMaterial,
      0.035,
      0.1,
      0.28,
      0.18,
      7,
    );
  }

  update(
    snapshot: PositionSnapshot,
    selected: Square | null,
    targets: ReadonlyMap<Square, LegalMove>,
    preview: MovePreview | null,
  ): void {
    this.clear();
    this.checkMesh = null;
    this.previewMesh = null;

    if (snapshot.lastMove) {
      // 抬高到棋盘表面以上，避免和格子 z-fighting 造成“闪烁的残光”。
      this.addPlane(snapshot.lastMove.from, this.lastMoveMaterial, 0.014, 1);
      this.addPlane(snapshot.lastMove.to, this.lastMoveMaterial, 0.014, 1);
    }

    if (selected) {
      this.addMesh(this.selectedGeometry, this.selectedMaterial, selected, 0.026, 2);
    }

    for (const [square, move] of targets) {
      // 底部发光方框：外圈柔光 + 内圈清晰边框。
      this.addMesh(
        this.targetGlowGeometry,
        this.targetGlowMaterial,
        square,
        0.018,
        3,
      );
      this.addMesh(
        this.targetRingGeometry,
        move.isCapture ? this.targetCaptureMaterial : this.targetMaterial,
        square,
        0.026,
        4,
      );
    }

    if (snapshot.checkSquare) {
      this.checkMesh = this.addMesh(
        this.checkGeometry,
        this.checkMaterial,
        snapshot.checkSquare,
        0.03,
        5,
      );
    }

    if (preview) {
      this.previewMesh = this.addMesh(
        this.previewGeometry,
        this.previewMaterial,
        preview.to,
        0.034,
        6,
      );
    }

    this.buildHover();
  }

  setHover(square: Square | null): void {
    if (this.hovered === square) return;
    this.hovered = square;
    this.buildHover();
  }

  tick(time: number): void {
    const pulse = 0.5 + 0.5 * Math.sin(time / 260);
    if (this.checkMesh) {
      this.checkMaterial.opacity = 0.55 + pulse * 0.35;
      this.checkMesh.scale.setScalar(1 + pulse * 0.04);
    }
    if (this.previewMesh) {
      this.previewMaterial.opacity = 0.42 + pulse * 0.3;
      this.previewMesh.scale.setScalar(1 + pulse * 0.025);
    }
    this.targetMaterial.opacity = 0.72 + pulse * 0.24;
    this.targetCaptureMaterial.opacity = 0.72 + pulse * 0.24;
    this.targetGlowMaterial.opacity = 0.1 + pulse * 0.12;
    this.recommendationArrowMaterial.opacity = 0.65 + pulse * 0.25;
    this.ghostThreatLineMaterial.opacity = 0.65 + pulse * 0.2;
    this.ghostProtectLineMaterial.opacity = 0.6 + pulse * 0.2;
    this.ghostCaptureLineMaterial.opacity = 0.6 + pulse * 0.2;
    this.opponentArrowMaterial.opacity = 0.26 + pulse * 0.1;
  }

  dispose(): void {
    this.clear();
    this.clearGroup(this.connectionsGroup);
    this.clearGroup(this.previewConnectionsGroup);
    this.clearGroup(this.recommendationsGroup);
    this.clearGroup(this.opponentArrowGroup);
    this.planeGeometry.dispose();
    this.targetRingGeometry.dispose();
    this.targetGlowGeometry.dispose();
    this.selectedGeometry.dispose();
    this.checkGeometry.dispose();
    this.previewGeometry.dispose();
    this.lastMoveMaterial.dispose();
    this.selectedMaterial.dispose();
    this.targetMaterial.dispose();
    this.targetCaptureMaterial.dispose();
    this.targetGlowMaterial.dispose();
    this.checkMaterial.dispose();
    this.previewMaterial.dispose();
    this.hoverMaterial.dispose();
    this.hoverLineMaterial.dispose();
    this.threatArrowMaterial.dispose();
    this.protectArrowMaterial.dispose();
    this.captureArrowMaterial.dispose();
    this.recommendationArrowMaterial.dispose();
    this.opponentArrowMaterial.dispose();
    this.ghostThreatLineMaterial.dispose();
    this.ghostProtectLineMaterial.dispose();
    this.ghostCaptureLineMaterial.dispose();
    this.ghostThreatConeMaterial.dispose();
    this.ghostProtectConeMaterial.dispose();
    this.ghostCaptureConeMaterial.dispose();
  }

  private clear(): void {
    for (const child of [...this.marks.children]) {
      this.disposeGeometry(child);
      this.marks.remove(child);
    }
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      this.disposeGeometry(child);
      group.remove(child);
    }
  }

  private disposeGeometry(object: THREE.Object3D): void {
    const mesh = object as THREE.Mesh;
    if (mesh.userData.ownedGeometry && mesh.geometry) {
      mesh.geometry.dispose();
    }
  }

  private buildHover(): void {
    for (const child of [...this.marks.children]) {
      if (child.userData.kind !== 'hover') continue;
      this.disposeGeometry(child);
      this.marks.remove(child);
    }
    if (!this.hovered) return;

    this.addPlane(this.hovered, this.hoverMaterial, 0.028, 6);
    const point = squareToWorld(this.hovered, 0.032);
    const half = 0.48;
    const points = [
      new THREE.Vector3(point.x - half, point.y, point.z - half),
      new THREE.Vector3(point.x + half, point.y, point.z - half),
      new THREE.Vector3(point.x + half, point.y, point.z + half),
      new THREE.Vector3(point.x - half, point.y, point.z + half),
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.LineLoop(geometry, this.hoverLineMaterial);
    line.userData.kind = 'hover';
    line.userData.ownedGeometry = true;
    line.renderOrder = 7;
    this.marks.add(line);
  }

  private addPlane(
    square: Square,
    material: THREE.Material,
    y: number,
    renderOrder: number,
  ): THREE.Mesh {
    return this.addMesh(this.planeGeometry, material, square, y, renderOrder);
  }

  private addMesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    square: Square,
    y: number,
    renderOrder: number,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(squareToWorld(square, y));
    mesh.renderOrder = renderOrder;
    this.marks.add(mesh);
    return mesh;
  }

  /**
   * 直线箭头：圆柱杆 + 圆锥头。
   * 不再使用曲线和终点圆环，减少画面上的“蜘蛛网”。
   */
  private addArrow(
    group: THREE.Group,
    from: Square,
    to: Square,
    material: THREE.MeshBasicMaterial,
    radius: number,
    headRadius: number,
    headLength: number,
    y: number,
    renderOrder: number,
  ): void {
    const start = squareToWorld(from, y);
    const end = squareToWorld(to, y);
    const direction = new THREE.Vector3(
      end.x - start.x,
      0,
      end.z - start.z,
    );
    const length = direction.length();
    if (length < 0.001) return;
    direction.normalize();

    const shaftLength = Math.max(0.02, length - headLength);
    const midpoint = start.clone().addScaledVector(direction, shaftLength / 2);
    const shaftGeometry = new THREE.CylinderGeometry(
      radius,
      radius,
      shaftLength,
      6,
    );
    const shaft = new THREE.Mesh(shaftGeometry, material);
    shaft.position.copy(midpoint);
    shaft.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction,
    );
    shaft.renderOrder = renderOrder;
    shaft.raycast = () => {};
    shaft.userData.ownedGeometry = true;
    group.add(shaft);

    const coneGeometry = new THREE.ConeGeometry(headRadius, headLength, 8);
    const cone = new THREE.Mesh(coneGeometry, material);
    cone.position.copy(end).addScaledVector(direction, -headLength / 2);
    cone.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction,
    );
    cone.renderOrder = renderOrder;
    cone.raycast = () => {};
    cone.userData.ownedGeometry = true;
    group.add(cone);
  }

  /** 虚影箭头：虚线杆 + 实心锥头；不会用曲线。 */
  private addDashedArrow(
    group: THREE.Group,
    from: Square,
    to: Square,
    lineMaterial: THREE.LineDashedMaterial,
    coneMaterial: THREE.MeshBasicMaterial,
    y: number,
    renderOrder: number,
  ): void {
    const start = squareToWorld(from, y);
    const end = squareToWorld(to, y);
    const direction = new THREE.Vector3(
      end.x - start.x,
      0,
      end.z - start.z,
    );
    const length = direction.length();
    if (length < 0.001) return;
    direction.normalize();

    const headLength = 0.18;
    const shaftEnd = end.clone().addScaledVector(direction, -headLength);
    const lineGeometry = new THREE.BufferGeometry().setFromPoints([
      start,
      shaftEnd,
    ]);
    const line = new THREE.Line(lineGeometry, lineMaterial);
    line.computeLineDistances();
    line.renderOrder = renderOrder;
    line.raycast = () => {};
    line.userData.ownedGeometry = true;
    group.add(line);

    const coneGeometry = new THREE.ConeGeometry(0.05, headLength, 8);
    const cone = new THREE.Mesh(coneGeometry, coneMaterial);
    cone.position.copy(end).addScaledVector(direction, -headLength / 2);
    cone.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction,
    );
    cone.renderOrder = renderOrder;
    cone.raycast = () => {};
    cone.userData.ownedGeometry = true;
    group.add(cone);
  }

  private flatMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
  }

  private arrowMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }

  private dashedLineMaterial(
    color: number,
    opacity: number,
  ): THREE.LineDashedMaterial {
    return new THREE.LineDashedMaterial({
      color,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      dashSize: 0.14,
      gapSize: 0.08,
    });
  }

  private flatPlane(): THREE.PlaneGeometry {
    const geometry = new THREE.PlaneGeometry(0.98, 0.98);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }

  private flatRing(inner: number, outer: number): THREE.RingGeometry {
    const geometry = new THREE.RingGeometry(inner, outer, 36);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }

  /**
   * 四段 RingGeometry 在 thetaStart=45° 时形成“方形边框”：
   * 不再是圆环，而是像发光地砖的边缘。
   */
  private flatSquareRing(inner: number, outer: number): THREE.BufferGeometry {
    const geometry = new THREE.RingGeometry(
      inner,
      outer,
      4,
      1,
      Math.PI / 4,
    );
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }
}
