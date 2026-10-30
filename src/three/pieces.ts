import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PieceType, Side } from '../domain/types';
import { COLORS } from './palette';
import {
  createWoodTexture,
  WOOD_PALETTES,
  type WoodTextureSet,
} from './wood';

export type PieceGeometryMap = Record<PieceType, THREE.BufferGeometry>;

export interface PieceAssets {
  geometries: PieceGeometryMap;
  materials: Record<Side, THREE.MeshPhysicalMaterial>;
  ghostMaterials: Record<Side, THREE.MeshStandardMaterial>;
  outlineMaterials: Record<Side, THREE.MeshBasicMaterial>;
  dispose: () => void;
}

function base(): THREE.BufferGeometry {
  const foot = new THREE.CylinderGeometry(0.34, 0.43, 0.13, 48);
  foot.translate(0, 0.065, 0);
  const rim = new THREE.TorusGeometry(0.355, 0.022, 8, 48);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, 0.112, 0);
  return mergeParts([foot, rim]);
}

function lathe(profile: Array<[number, number]>, segments = 48): THREE.BufferGeometry {
  const points = profile.map(([radius, height]) => new THREE.Vector2(radius, height));
  return new THREE.LatheGeometry(points, segments);
}

function sphere(radius: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(radius, 32, 20);
  geometry.translate(x, y, z);
  return geometry;
}

function cylinder(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  x: number,
  y: number,
  z: number,
  segments = 40,
): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(
    radiusTop,
    radiusBottom,
    height,
    segments,
  );
  geometry.translate(x, y, z);
  return geometry;
}

function box(
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(x, y, z);
  return geometry;
}

function torus(radius: number, tube: number, y: number): THREE.BufferGeometry {
  const geometry = new THREE.TorusGeometry(radius, tube, 8, 48);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, y, 0);
  return geometry;
}

function cone(radius: number, height: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(radius, height, 16);
  geometry.translate(x, y, z);
  return geometry;
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // ExtrudeGeometry 是非索引几何，统一转成非索引后再合并，避免属性/索引不一致。
  const normalized = parts.map((part) => {
    if (!part.index) return part;
    const clone = part.toNonIndexed();
    part.dispose();
    return clone;
  });
  const merged = mergeGeometries(normalized, false);
  normalized.forEach((part) => part.dispose());
  if (!merged) throw new Error('棋子几何合并失败');
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function buildPawn(): THREE.BufferGeometry {
  return mergeParts([
    base(),
    lathe([
      [0.2, 0.13],
      [0.18, 0.18],
      [0.13, 0.32],
      [0.12, 0.42],
      [0.17, 0.5],
      [0.11, 0.56],
    ]),
    torus(0.135, 0.022, 0.57),
    cylinder(0.055, 0.09, 0.08, 0, 0.61, 0),
    sphere(0.17, 0, 0.78, 0),
  ]);
}

function buildRook(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    base(),
    cylinder(0.21, 0.25, 0.78, 0, 0.52, 0, 8),
    torus(0.25, 0.022, 0.92),
    cylinder(0.29, 0.29, 0.1, 0, 0.98, 0),
    cylinder(0.2, 0.2, 0.06, 0, 1.04, 0),
  ];

  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    const battlement = new THREE.BoxGeometry(0.17, 0.18, 0.12);
    battlement.translate(0, 0, 0.21);
    battlement.rotateY(angle);
    battlement.translate(0, 1.13, 0);
    parts.push(battlement);
  }

  return mergeParts(parts);
}

function buildBishop(): THREE.BufferGeometry {
  return mergeParts([
    base(),
    lathe([
      [0.21, 0.13],
      [0.17, 0.28],
      [0.12, 0.58],
      [0.18, 0.78],
      [0.11, 0.88],
    ]),
    torus(0.14, 0.022, 0.9),
    lathe([
      [0.1, 0.9],
      [0.2, 1.0],
      [0.18, 1.14],
      [0.1, 1.26],
      [0.02, 1.32],
    ]),
    sphere(0.04, 0, 1.34, 0),
  ]);
}

function buildKnight(): THREE.BufferGeometry {
  const neck = new THREE.CylinderGeometry(0.16, 0.25, 0.62, 32);
  neck.rotateZ(-0.22);
  neck.translate(0.02, 0.45, 0);

  const head = new THREE.SphereGeometry(0.23, 32, 24);
  head.scale(1.25, 1.05, 1.08);
  head.translate(0.16, 0.95, 0);

  const muzzle = new THREE.CylinderGeometry(0.09, 0.17, 0.38, 24);
  muzzle.rotateZ(-Math.PI / 2);
  muzzle.translate(0.43, 0.93, 0);

  const nose = new THREE.SphereGeometry(0.09, 24, 16);
  nose.translate(0.62, 0.9, 0);

  const jaw = new THREE.SphereGeometry(0.12, 24, 16);
  jaw.scale(1.15, 0.8, 1);
  jaw.translate(0.3, 0.8, 0);

  const parts: THREE.BufferGeometry[] = [base(), neck, head, muzzle, nose, jaw];

  for (const side of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.055, 0.2, 12);
    ear.rotateX(side * 0.18);
    ear.translate(0.02, 1.28, side * 0.09);
    parts.push(ear);
  }

  // 鬃毛：一排向后倾斜的小锥体，让侧面轮廓不像一块板。
  for (let index = 0; index < 5; index += 1) {
    const mane = new THREE.ConeGeometry(0.04, 0.14, 8);
    mane.rotateZ(0.55);
    mane.translate(-0.14 + index * 0.035, 0.72 + index * 0.075, 0);
    parts.push(mane);
  }

  return mergeParts(parts);
}

function buildQueen(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    base(),
    lathe([
      [0.22, 0.13],
      [0.17, 0.32],
      [0.12, 0.62],
      [0.19, 0.86],
      [0.13, 1.02],
      [0.2, 1.1],
    ]),
    torus(0.15, 0.022, 1.04),
    cylinder(0.23, 0.23, 0.12, 0, 1.17, 0),
  ];

  for (let index = 0; index < 9; index += 1) {
    const angle = (index / 9) * Math.PI * 2;
    parts.push(
      cone(
        0.038,
        0.16,
        Math.cos(angle) * 0.19,
        1.31,
        Math.sin(angle) * 0.19,
      ),
    );
  }
  parts.push(sphere(0.075, 0, 1.42, 0));

  return mergeParts(parts);
}

function buildKing(): THREE.BufferGeometry {
  return mergeParts([
    base(),
    lathe([
      [0.23, 0.13],
      [0.18, 0.36],
      [0.12, 0.74],
      [0.19, 1.0],
      [0.13, 1.14],
      [0.2, 1.22],
    ]),
    torus(0.16, 0.024, 1.14),
    cylinder(0.24, 0.24, 0.12, 0, 1.3, 0),
    box(0.1, 0.36, 0.1, 0, 1.55, 0),
    box(0.34, 0.1, 0.1, 0, 1.53, 0),
  ]);
}

function createMaterials(): {
  materials: Record<Side, THREE.MeshPhysicalMaterial>;
  ghostMaterials: Record<Side, THREE.MeshStandardMaterial>;
  outlineMaterials: Record<Side, THREE.MeshBasicMaterial>;
  whiteWood: WoodTextureSet;
  blackWood: WoodTextureSet;
} {
  const whiteWood: WoodTextureSet = createWoodTexture(WOOD_PALETTES.whitePiece);
  const blackWood: WoodTextureSet = createWoodTexture(WOOD_PALETTES.blackPiece);
  whiteWood.map.repeat.set(1.6, 2.2);
  whiteWood.bumpMap.repeat.set(1.6, 2.2);
  blackWood.map.repeat.set(1.6, 2.2);
  blackWood.bumpMap.repeat.set(1.6, 2.2);

  const materials: Record<Side, THREE.MeshPhysicalMaterial> = {
    w: new THREE.MeshPhysicalMaterial({
      map: whiteWood.map,
      bumpMap: whiteWood.bumpMap,
      bumpScale: 0.018,
      roughness: 0.47,
      metalness: 0,
      clearcoat: 0.28,
      clearcoatRoughness: 0.35,
    }),
    b: new THREE.MeshPhysicalMaterial({
      map: blackWood.map,
      bumpMap: blackWood.bumpMap,
      bumpScale: 0.02,
      roughness: 0.4,
      metalness: 0,
      clearcoat: 0.36,
      clearcoatRoughness: 0.28,
    }),
  };

  const ghostMaterials: Record<Side, THREE.MeshStandardMaterial> = {
    w: new THREE.MeshStandardMaterial({
      color: COLORS.whiteGhost,
      transparent: true,
      opacity: 0.42,
      roughness: 0.6,
      metalness: 0,
      depthWrite: false,
    }),
    b: new THREE.MeshStandardMaterial({
      color: COLORS.blackGhost,
      transparent: true,
      opacity: 0.42,
      roughness: 0.6,
      metalness: 0,
      depthWrite: false,
    }),
  };

  const outlineMaterials: Record<Side, THREE.MeshBasicMaterial> = {
    w: new THREE.MeshBasicMaterial({
      color: 0x3d2c1b,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
    b: new THREE.MeshBasicMaterial({
      color: 0xf0d7b0,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    }),
  };

  return { materials, ghostMaterials, outlineMaterials, whiteWood, blackWood };
}

function buildAssets(geometries: PieceGeometryMap): PieceAssets {
  const { materials, ghostMaterials, outlineMaterials, whiteWood, blackWood } =
    createMaterials();

  return {
    geometries,
    materials,
    ghostMaterials,
    outlineMaterials,
    dispose: () => {
      Object.values(geometries).forEach((geometry) => geometry.dispose());
      Object.values(materials).forEach((material) => material.dispose());
      Object.values(ghostMaterials).forEach((material) => material.dispose());
      Object.values(outlineMaterials).forEach((material) => material.dispose());
      whiteWood.dispose();
      blackWood.dispose();
    },
  };
}

/** 程序化棋子：仅在 GLB 加载失败时作为兜底。 */
export function createPieceAssets(): PieceAssets {
  const geometries: PieceGeometryMap = {
    p: buildPawn(),
    r: buildRook(),
    n: buildKnight(),
    b: buildBishop(),
    q: buildQueen(),
    k: buildKing(),
  };

  Object.values(geometries).forEach((geometry) => {
    geometry.scale(0.92, 0.92, 0.92);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  });

  return buildAssets(geometries);
}

const GLB_URL = '/models/chess-set-pia.glb';

/** GLB 里的棋子高度约为 4.8–9.0，这里归一化成棋盘格 1.0 下的教学比例。 */
const PIECE_HEIGHTS: Record<PieceType, number> = {
  p: 0.9,
  r: 1.2,
  n: 1.32,
  b: 1.48,
  q: 1.55,
  k: 1.72,
};

function addWoodUv(geometry: THREE.BufferGeometry, height: number): void {
  const position = geometry.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    uv[index * 2] = 0.5 + Math.atan2(z, x) / (Math.PI * 2);
    uv[index * 2 + 1] = y / height;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * 皇后和国王的轮廓太接近；只把皇后上半段（皇冠区域）在 XZ 方向放大，
 * 底座和身体比例不变，避免整体变胖。
 */
function enlargeQueenCrown(geometry: THREE.BufferGeometry): void {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return;
  const height = box.max.y - box.min.y;
  if (height <= 0) return;

  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index);
    const t = (y - box.min.y) / height;
    if (t < 0.62) continue;
    const progress = Math.min(1, (t - 0.62) / 0.38);
    const smooth = progress * progress * (3 - 2 * progress);
    const factor = 1 + smooth * 0.2;
    position.setX(index, position.getX(index) * factor);
    position.setZ(index, position.getZ(index) * factor);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function extractModelGeometries(root: THREE.Object3D): PieceGeometryMap {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshes.push(object as THREE.Mesh);
  });

  const definitions: Array<{ type: PieceType; needle: string }> = [
    { type: 'p', needle: 'pawn' },
    { type: 'r', needle: 'rook' },
    { type: 'n', needle: 'knight' },
    { type: 'b', needle: 'bishop' },
    { type: 'q', needle: 'queen' },
    { type: 'k', needle: 'king' },
  ];

  const geometries = {} as PieceGeometryMap;

  for (const definition of definitions) {
    const source = meshes.find((mesh) => {
      const name = mesh.name.toLowerCase();
      return name.includes(definition.needle) && !name.includes('board');
    });
    if (!source) throw new Error(`GLB 缺少棋子：${definition.needle}`);

    const geometry = source.geometry.clone();
    geometry.applyMatrix4(source.matrixWorld);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) throw new Error(`GLB 棋子无包围盒：${definition.needle}`);

    const center = box.getCenter(new THREE.Vector3());
    geometry.translate(-center.x, -box.min.y, -center.z);
    geometry.computeBoundingBox();
    const height = (geometry.boundingBox?.max.y ?? 0) - (geometry.boundingBox?.min.y ?? 0);
    if (height <= 0) throw new Error(`GLB 棋子高度异常：${definition.needle}`);

    const scale = PIECE_HEIGHTS[definition.type] / height;
    // 低多边形模型的原型偏矮胖；稍微收窄底座、拉高一点，更接近标准棋子的比例。
    geometry.scale(scale * 0.88, scale * 1.08, scale * 0.88);
    if (definition.type === 'q') enlargeQueenCrown(geometry);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    addWoodUv(geometry, PIECE_HEIGHTS[definition.type] * 1.08);
    geometries[definition.type] = geometry;
  }

  return geometries;
}

export async function loadPieceAssets(): Promise<PieceAssets> {
  try {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(GLB_URL);
    return buildAssets(extractModelGeometries(gltf.scene));
  } catch (error) {
    console.warn('GLB 棋子加载失败，回退到程序化棋子。', error);
    return createPieceAssets();
  }
}
