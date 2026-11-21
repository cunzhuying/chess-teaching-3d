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
 * - 合法落子 = 单圈圆形发光环，不再用方框；
 * - 关系线 = 一条立体的弧形箭头，红=威胁，绿=保护，金=可吃；
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
  private readonly selectedGeometry: THREE.RingGeometry;
  private readonly checkGeometry: THREE.RingGeometry;
  private readonly previewGeometry: THREE.RingGeometry;

  private readonly lastMoveMaterial: THREE.MeshBasicMaterial;
  private readonly selectedMaterial: THREE.MeshBasicMaterial;
  private readonly targetMaterial: THREE.MeshBasicMaterial;
  private readonly targetCaptureMaterial: THREE.MeshBasicMaterial;
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
    // 可落子点只保留一圈清晰的圆形 RingGeometry。
    this.targetRingGeometry = this.flatRing(0.28, 0.35);
    this.selectedGeometry = this.flatRing(0.41, 0.48);
    this.checkGeometry = this.flatRing(0.36, 0.47);
    this.previewGeometry = this.flatRing(0.43, 0.5);

    // 棋盘上的提示层不参与光照和 tone mapping。
    // 主环 opacity=1、normal blending：颜色不会再被浅色/深色格底板“染”成两种颜色。
    this.lastMoveMaterial = this.flatMaterial(COLORS.lastMove, 0.2);
    this.selectedMaterial = this.flatMaterial(COLORS.selection, 1, true);
    this.targetMaterial = this.flatMaterial(COLORS.goldBright, 1, true);
    this.targetCaptureMaterial = this.flatMaterial(COLORS.danger, 1, true);
    this.checkMaterial = this.flatMaterial(COLORS.danger, 1, true);
    this.previewMaterial = this.flatMaterial(COLORS.goldBright, 1, true);
    this.hoverMaterial = this.flatMaterial(COLORS.selection, 0.07);
    this.hoverLineMaterial = new THREE.LineBasicMaterial({
      color: COLORS.goldBright,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });

    // 关系/推荐箭头也用不透明 MeshBasicMaterial，颜色统一，不受光照影响。
    this.threatArrowMaterial = this.arrowMaterial(0xe0604f, 1);
    this.protectArrowMaterial = this.arrowMaterial(0x6fbf8b, 1);
    this.captureArrowMaterial = this.arrowMaterial(0xe0b45e, 1);
    this.recommendationArrowMaterial = this.arrowMaterial(0xf3cd7d, 1);
    this.opponentArrowMaterial = this.arrowMaterial(0xd05a4f, 0.34);

    this.ghostThreatLineMaterial = this.dashedLineMaterial(0xff7b68, 1);
    this.ghostProtectLineMaterial = this.dashedLineMaterial(0x7fd8a0, 1);
    this.ghostCaptureLineMaterial = this.dashedLineMaterial(0xf0c56b, 1);
    this.ghostThreatConeMaterial = this.arrowMaterial(0xff7b68, 0.95);
    this.ghostProtectConeMaterial = this.arrowMaterial(0x7fd8a0, 0.95);
    this.ghostCaptureConeMaterial = this.arrowMaterial(0xf0c56b, 0.95);
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

  /** 对手最可能应招：半透明弧形箭头，只一条。 */
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
      // 只保留一圈清晰的圆形落子环。
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
      this.checkMesh.scale.setScalar(1 + pulse * 0.04);
    }
    if (this.previewMesh) {
      this.previewMesh.scale.setScalar(1 + pulse * 0.025);
    }
    // 主环保持 opacity=1，不参与明暗变化；外圈也是不透明暖金，
    // 不会像半透明光晕那样被浅色格“洗白”。
    this.opponentArrowMaterial.opacity = 0.3 + pulse * 0.08;
  }

  dispose(): void {
    this.clear();
    this.clearGroup(this.connectionsGroup);
    this.clearGroup(this.previewConnectionsGroup);
    this.clearGroup(this.recommendationsGroup);
    this.clearGroup(this.opponentArrowGroup);
    this.planeGeometry.dispose();
    this.targetRingGeometry.dispose();
    this.selectedGeometry.dispose();
    this.checkGeometry.dispose();
    this.previewGeometry.dispose();
    this.lastMoveMaterial.dispose();
    this.selectedMaterial.dispose();
    this.targetMaterial.dispose();
    this.targetCaptureMaterial.dispose();
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

    this.addPlane(this.hovered, this.hoverMaterial, 0.028, 1);
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
   * 立体弧形箭头：抬高的管状弧线 + 切线方向的圆锥头。
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
    const arc = this.arrowCurve(from, to, y);
    if (!arc) return;
    const { curve, end } = arc;

    // 用抬高的二次贝塞尔曲线生成有厚度的管状弧线，而不是贴着棋盘的直线。
    const shaftGeometry = new THREE.TubeGeometry(curve, 36, radius, 8, false);
    const shaft = new THREE.Mesh(shaftGeometry, material);
    shaft.renderOrder = renderOrder;
    shaft.raycast = () => {};
    shaft.userData.ownedGeometry = true;
    group.add(shaft);

    const tangent = curve.getTangentAt(1).normalize();
    const coneGeometry = new THREE.ConeGeometry(headRadius, headLength, 8);
    const cone = new THREE.Mesh(coneGeometry, material);
    cone.position.copy(end).addScaledVector(tangent, -headLength / 2);
    cone.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      tangent,
    );
    cone.renderOrder = renderOrder;
    cone.raycast = () => {};
    cone.userData.ownedGeometry = true;
    group.add(cone);
  }

  /** 虚影箭头：沿同一弧线采样成虚线，锥头贴住终点切线。 */
  private addDashedArrow(
    group: THREE.Group,
    from: Square,
    to: Square,
    lineMaterial: THREE.LineDashedMaterial,
    coneMaterial: THREE.MeshBasicMaterial,
    y: number,
    renderOrder: number,
  ): void {
    const arc = this.arrowCurve(from, to, y);
    if (!arc) return;
    const { curve, end } = arc;

    const headLength = 0.18;
    const points = curve
      .getSpacedPoints(48)
      .filter((point) => point.distanceTo(end) > headLength * 0.9);
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(
      points.length >= 2 ? points : [curve.getPointAt(0), curve.getPointAt(0.5)],
    );
    const line = new THREE.Line(lineGeometry, lineMaterial);
    line.computeLineDistances();
    line.renderOrder = renderOrder;
    line.raycast = () => {};
    line.userData.ownedGeometry = true;
    group.add(line);

    const tangent = curve.getTangentAt(1).normalize();
    const coneGeometry = new THREE.ConeGeometry(0.05, headLength, 8);
    const cone = new THREE.Mesh(coneGeometry, coneMaterial);
    cone.position.copy(end).addScaledVector(tangent, -headLength / 2);
    cone.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      tangent,
    );
    cone.renderOrder = renderOrder;
    cone.raycast = () => {};
    cone.userData.ownedGeometry = true;
    group.add(cone);
  }

  /**
   * 起点/终点抬离棋盘，控制点再抬高，形成从上方跨过去的立体弧度。
   * 距离越长，拱得越高，但仍然限制在合理高度内。
   */
  private arrowCurve(
    from: Square,
    to: Square,
    y: number,
  ): {
    curve: THREE.QuadraticBezierCurve3;
    start: THREE.Vector3;
    end: THREE.Vector3;
  } | null {
    const start = squareToWorld(from, y + 0.16);
    const end = squareToWorld(to, y + 0.06);
    const distance = Math.hypot(end.x - start.x, end.z - start.z);
    if (distance < 0.001) return null;
    const peak = Math.min(0.9, 0.26 + distance * 0.11);
    const control = new THREE.Vector3(
      (start.x + end.x) / 2,
      Math.max(start.y, end.y) + peak * 2,
      (start.z + end.z) / 2,
    );
    return {
      curve: new THREE.QuadraticBezierCurve3(start, control, end),
      start,
      end,
    };
  }

  private flatMaterial(
    color: number,
    opacity: number,
    overlay = false,
  ): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      // 落子提示是 UI 层：不参与深度遮挡，永远画在棋子和棋盘之上。
      depthTest: !overlay,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
      // 关键：不用 AdditiveBlending。加法混合会把金色叠在浅色格上变白，
      // 普通 alpha 混合 + 主环 opacity=1 才能保证颜色固定。
      blending: THREE.NormalBlending,
      fog: false,
    });
  }

  private arrowMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NormalBlending,
      fog: false,
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
      fog: false,
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
}
