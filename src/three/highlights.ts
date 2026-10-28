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
 * 妫嬬洏涓婄殑鍏ㄩ儴淇℃伅灞傦細涓婁竴姝ャ€侀€変腑銆佸悎娉曟牸銆佸皢鍐涖€侀瑙堢洰鏍囥€? * 濞佽儊/淇濇姢杩炵嚎涓庢帹鑽愮澶淬€? */
export class HighlightLayer {
  readonly group = new THREE.Group();

  private readonly marks = new THREE.Group();
  private readonly connectionsGroup = new THREE.Group();
  private readonly previewConnectionsGroup = new THREE.Group();
  private readonly recommendationsGroup = new THREE.Group();
  private readonly opponentArrowGroup = new THREE.Group();

  private readonly planeGeometry: THREE.PlaneGeometry;
  private readonly dotGeometry: THREE.CircleGeometry;
  private readonly captureGeometry: THREE.RingGeometry;
  private readonly selectedGeometry: THREE.RingGeometry;
  private readonly checkGeometry: THREE.RingGeometry;
  private readonly previewGeometry: THREE.RingGeometry;
  private readonly linkRingGeometry: THREE.RingGeometry;

  private readonly lastMoveMaterial: THREE.MeshBasicMaterial;
  private readonly selectedMaterial: THREE.MeshBasicMaterial;
  private readonly dotMaterial: THREE.MeshBasicMaterial;
  private readonly captureMaterial: THREE.MeshBasicMaterial;
  private readonly checkMaterial: THREE.MeshBasicMaterial;
  private readonly previewMaterial: THREE.MeshBasicMaterial;
  private readonly hoverMaterial: THREE.MeshBasicMaterial;
  private readonly hoverLineMaterial: THREE.LineBasicMaterial;
  private readonly threatLineMaterial: THREE.MeshBasicMaterial;
  private readonly protectLineMaterial: THREE.MeshBasicMaterial;
  private readonly captureLineMaterial: THREE.MeshBasicMaterial;
  private readonly bestRecommendationMaterial: THREE.MeshBasicMaterial;
  private readonly alternativeRecommendationMaterial: THREE.MeshBasicMaterial;
  private readonly ghostThreatMaterial: THREE.LineDashedMaterial;
  private readonly ghostProtectMaterial: THREE.LineDashedMaterial;
  private readonly ghostCaptureMaterial: THREE.LineDashedMaterial;
  private readonly ghostThreatRingMaterial: THREE.MeshBasicMaterial;
  private readonly ghostProtectRingMaterial: THREE.MeshBasicMaterial;
  private readonly ghostCaptureRingMaterial: THREE.MeshBasicMaterial;
  private readonly opponentArrowMaterial: THREE.MeshBasicMaterial;
  private readonly opponentArrowRingMaterial: THREE.MeshBasicMaterial;

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
    this.dotGeometry = this.flatCircle(0.1);
    this.captureGeometry = this.flatRing(0.34, 0.42);
    this.selectedGeometry = this.flatRing(0.41, 0.48);
    this.checkGeometry = this.flatRing(0.36, 0.47);
    this.previewGeometry = this.flatRing(0.43, 0.5);
    this.linkRingGeometry = this.flatRing(0.44, 0.5);

    this.lastMoveMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.lastMove,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      toneMapped: false,
    });
    this.selectedMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.selection,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      toneMapped: false,
    });
    this.dotMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.gold,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      toneMapped: false,
    });
    this.captureMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.goldBright,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      toneMapped: false,
    });
    this.checkMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.danger,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      toneMapped: false,
    });
    this.previewMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.goldBright,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      toneMapped: false,
    });
    this.hoverMaterial = new THREE.MeshBasicMaterial({
      color: COLORS.selection,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      toneMapped: false,
    });
    this.hoverLineMaterial = new THREE.LineBasicMaterial({
      color: COLORS.goldBright,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      toneMapped: false,
    });
    this.threatLineMaterial = this.lineMaterial(0xe0604f, 0.9);
    this.protectLineMaterial = this.lineMaterial(0x6fbf8b, 0.72);
    this.captureLineMaterial = this.lineMaterial(0xe0b45e, 0.78);
    this.bestRecommendationMaterial = this.lineMaterial(0xf3cd7d, 0.9);
    this.alternativeRecommendationMaterial = this.lineMaterial(0x5aa9e6, 0.55);
    this.ghostThreatMaterial = this.dashedLineMaterial(0xff7b68, 0.95);
    this.ghostProtectMaterial = this.dashedLineMaterial(0x7fd8a0, 0.9);
    this.ghostCaptureMaterial = this.dashedLineMaterial(0xf0c56b, 0.9);
    this.ghostThreatRingMaterial = this.lineMaterial(0xff7b68, 0.55);
    this.ghostProtectRingMaterial = this.lineMaterial(0x7fd8a0, 0.5);
    this.ghostCaptureRingMaterial = this.lineMaterial(0xf0c56b, 0.5);
    this.opponentArrowMaterial = new THREE.MeshBasicMaterial({
      color: 0xd05a4f,
      transparent: true,
      opacity: 0.34,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.opponentArrowRingMaterial = this.lineMaterial(0xd05a4f, 0.32);
  }

  setConnections(connections: BoardConnection[]): void {
    this.clearGroup(this.connectionsGroup);
    connections.slice(0, 3).forEach((connection, index) => {
      const material =
        connection.kind === 'threat'
          ? this.threatLineMaterial
          : connection.kind === 'protect'
            ? this.protectLineMaterial
            : this.captureLineMaterial;
      const radius = connection.kind === 'threat' ? 0.022 : 0.017;
      const height =
        connection.kind === 'threat'
          ? 0.3
          : connection.kind === 'protect'
            ? 0.5
            : 0.68;
      this.addCurve(
        this.connectionsGroup,
        connection.from,
        connection.to,
        material,
        radius,
        height,
        8 + index,
      );
      this.addRingTo(
        this.connectionsGroup,
        connection.to,
        material,
        0.03,
        8 + index,
      );
    });
  }

  setRecommendations(recommendations: Recommendation[]): void {
    this.clearGroup(this.recommendationsGroup);
    recommendations.slice(0, 3).forEach((recommendation, index) => {
      const best = recommendation.rank === 1;
      const material = best
        ? this.bestRecommendationMaterial
        : this.alternativeRecommendationMaterial;
      this.addCurve(
        this.recommendationsGroup,
        recommendation.move.from,
        recommendation.move.to,
        material,
        best ? 0.03 : 0.015,
        best ? 1.1 : 0.62,
        9 + index,
      );
      this.addRingTo(
        this.recommendationsGroup,
        recommendation.move.to,
        material,
        0.035,
        9 + index,
      );
    });
  }

  /**
   * 虚影预测线：走法还没有落子，所以用虚线表示“假想局面”。
   * 颜色与真实关系线一致：红=走后被威胁，金=走后能吃什么，绿=走后谁保护它。
   */
  setPreviewConnections(connections: BoardConnection[]): void {
    this.clearGroup(this.previewConnectionsGroup);
    connections.slice(0, 3).forEach((connection, index) => {
      const material =
        connection.kind === 'threat'
          ? this.ghostThreatMaterial
          : connection.kind === 'protect'
            ? this.ghostProtectMaterial
            : this.ghostCaptureMaterial;
      const ringMaterial =
        connection.kind === 'threat'
          ? this.ghostThreatRingMaterial
          : connection.kind === 'protect'
            ? this.ghostProtectRingMaterial
            : this.ghostCaptureRingMaterial;
      this.addDashedCurve(
        this.previewConnectionsGroup,
        connection.from,
        connection.to,
        material,
        0.45,
        10 + index,
      );
      this.addRingTo(
        this.previewConnectionsGroup,
        connection.to,
        ringMaterial,
        0.05,
        10 + index,
      );
    });
  }

  /**
   * 对手最可能应招：半透明、较粗的敌方箭头，和“我现在被谁威胁”的红线区分开。
   * 只画一条，避免推演信息压过玩家自己的选择。
   */
  setOpponentArrow(arrow: { from: Square; to: Square } | null): void {
    this.clearGroup(this.opponentArrowGroup);
    if (!arrow) return;
    this.addCurve(
      this.opponentArrowGroup,
      arrow.from,
      arrow.to,
      this.opponentArrowMaterial,
      0.045,
      1.05,
      7,
    );
    this.addRingTo(
      this.opponentArrowGroup,
      arrow.to,
      this.opponentArrowRingMaterial,
      0.06,
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
      this.addPlane(snapshot.lastMove.from, this.lastMoveMaterial, 0.006, 1);
      this.addPlane(snapshot.lastMove.to, this.lastMoveMaterial, 0.006, 1);
    }

    if (selected) {
      this.addMesh(this.selectedGeometry, this.selectedMaterial, selected, 0.013, 2);
    }

    for (const [square, move] of targets) {
      if (move.isCapture) {
        this.addMesh(this.captureGeometry, this.captureMaterial, square, 0.016, 3);
      } else {
        this.addMesh(this.dotGeometry, this.dotMaterial, square, 0.016, 3);
      }
    }

    if (snapshot.checkSquare) {
      this.checkMesh = this.addMesh(
        this.checkGeometry,
        this.checkMaterial,
        snapshot.checkSquare,
        0.019,
        4,
      );
    }

    if (preview) {
      this.previewMesh = this.addMesh(
        this.previewGeometry,
        this.previewMaterial,
        preview.to,
        0.023,
        5,
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
      this.checkMesh.scale.setScalar(1 + pulse * 0.06);
    }
    if (this.previewMesh) {
      this.previewMaterial.opacity = 0.42 + pulse * 0.3;
      this.previewMesh.scale.setScalar(1 + pulse * 0.035);
    }
    // 最佳推荐做轻微“呼吸”，不闪烁、不遮挡。
    this.bestRecommendationMaterial.opacity = 0.55 + pulse * 0.32;
    this.alternativeRecommendationMaterial.opacity = 0.42 + pulse * 0.12;
    const ghostPulse = 0.5 + 0.5 * Math.sin(time / 330);
    this.ghostThreatMaterial.opacity = 0.7 + ghostPulse * 0.25;
    this.ghostProtectMaterial.opacity = 0.62 + ghostPulse * 0.22;
    this.ghostCaptureMaterial.opacity = 0.62 + ghostPulse * 0.22;
    this.opponentArrowMaterial.opacity = 0.26 + ghostPulse * 0.14;
  }

  dispose(): void {
    this.clear();
    this.clearGroup(this.connectionsGroup);
    this.clearGroup(this.previewConnectionsGroup);
    this.clearGroup(this.recommendationsGroup);
    this.clearGroup(this.opponentArrowGroup);
    this.planeGeometry.dispose();
    this.dotGeometry.dispose();
    this.captureGeometry.dispose();
    this.selectedGeometry.dispose();
    this.checkGeometry.dispose();
    this.previewGeometry.dispose();
    this.linkRingGeometry.dispose();
    this.lastMoveMaterial.dispose();
    this.selectedMaterial.dispose();
    this.dotMaterial.dispose();
    this.captureMaterial.dispose();
    this.checkMaterial.dispose();
    this.previewMaterial.dispose();
    this.hoverMaterial.dispose();
    this.hoverLineMaterial.dispose();
    this.threatLineMaterial.dispose();
    this.protectLineMaterial.dispose();
    this.captureLineMaterial.dispose();
    this.bestRecommendationMaterial.dispose();
    this.alternativeRecommendationMaterial.dispose();
    this.ghostThreatMaterial.dispose();
    this.ghostProtectMaterial.dispose();
    this.ghostCaptureMaterial.dispose();
    this.ghostThreatRingMaterial.dispose();
    this.ghostProtectRingMaterial.dispose();
    this.ghostCaptureRingMaterial.dispose();
    this.opponentArrowMaterial.dispose();
    this.opponentArrowRingMaterial.dispose();
  }

  private clear(): void {
    for (const child of [...this.marks.children]) {
      const object = child as THREE.Mesh;
      if (object.userData.ownedGeometry && object.geometry) {
        object.geometry.dispose();
      }
      this.marks.remove(child);
    }
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      const object = child as THREE.Mesh;
      if (object.userData.ownedGeometry && object.geometry) {
        object.geometry.dispose();
      }
      group.remove(child);
    }
  }

  private buildHover(): void {
    for (const child of [...this.marks.children]) {
      if (child.userData.kind !== 'hover') continue;
      if (child.userData.ownedGeometry && child instanceof THREE.Line) {
        child.geometry.dispose();
      }
      this.marks.remove(child);
    }
    if (!this.hovered) return;

    this.addPlane(this.hovered, this.hoverMaterial, 0.02, 6);
    const point = squareToWorld(this.hovered, 0.024);
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
    const point = squareToWorld(square, y);
    mesh.position.copy(point);
    mesh.renderOrder = renderOrder;
    this.marks.add(mesh);
    return mesh;
  }

  private addCurve(
    group: THREE.Group,
    from: Square,
    to: Square,
    material: THREE.Material,
    radius: number,
    height: number,
    renderOrder: number,
  ): void {
    const start = squareToWorld(from, 0.08);
    const end = squareToWorld(to, 0.08);
    const middle = start.clone().add(end).multiplyScalar(0.5);
    middle.y += height;
    const curve = new THREE.QuadraticBezierCurve3(start, middle, end);
    const geometry = new THREE.TubeGeometry(curve, 20, radius, 6, false);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = renderOrder;
    mesh.raycast = () => {};
    mesh.userData.ownedGeometry = true;
    group.add(mesh);
  }

  private addRingTo(
    group: THREE.Group,
    square: Square,
    material: THREE.Material,
    y: number,
    renderOrder: number,
  ): void {
    const mesh = new THREE.Mesh(this.linkRingGeometry, material);
    mesh.position.copy(squareToWorld(square, y));
    mesh.renderOrder = renderOrder;
    mesh.raycast = () => {};
    group.add(mesh);
  }

  private addDashedCurve(
    group: THREE.Group,
    from: Square,
    to: Square,
    material: THREE.LineDashedMaterial,
    height: number,
    renderOrder: number,
  ): void {
    const start = squareToWorld(from, 0.09);
    const end = squareToWorld(to, 0.09);
    const middle = start.clone().add(end).multiplyScalar(0.5);
    middle.y += height;
    const curve = new THREE.QuadraticBezierCurve3(start, middle, end);
    const geometry = new THREE.BufferGeometry().setFromPoints(
      curve.getPoints(28),
    );
    const line = new THREE.Line(geometry, material);
    line.computeLineDistances();
    line.renderOrder = renderOrder;
    line.raycast = () => {};
    line.userData.ownedGeometry = true;
    group.add(line);
  }

  private lineMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
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
      dashSize: 0.12,
      gapSize: 0.075,
    });
  }

  private flatPlane(): THREE.PlaneGeometry {
    const geometry = new THREE.PlaneGeometry(0.98, 0.98);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }

  private flatCircle(radius: number): THREE.CircleGeometry {
    const geometry = new THREE.CircleGeometry(radius, 28);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }

  private flatRing(inner: number, outer: number): THREE.RingGeometry {
    const geometry = new THREE.RingGeometry(inner, outer, 36);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }
}

