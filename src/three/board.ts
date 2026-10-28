import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Square } from 'chess.js';
import { FILES, isLightSquare, squareToWorld } from './square';
import { createWoodTexture, WOOD_PALETTES, type WoodTextureSet } from './wood';

export interface BoardView {
  group: THREE.Group;
  dispose: () => void;
}

function mergeSquares(light: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const file of FILES) {
    for (let rank = 1; rank <= 8; rank += 1) {
      const square = `${file}${rank}` as Square;
      if (isLightSquare(square) !== light) continue;
      const point = squareToWorld(square, 0.004);
      const plane = new THREE.PlaneGeometry(1, 1);
      plane.rotateX(-Math.PI / 2);
      plane.translate(point.x, point.y, point.z);

      // 连续 UV：整块棋盘的木纹从 a1 贯到 h8，不会每格重复同一张贴图。
      const position = plane.attributes.position;
      const uv = plane.attributes.uv;
      for (let index = 0; index < position.count; index += 1) {
        uv.setXY(
          index,
          (position.getX(index) + 4) / 8,
          (4 - position.getZ(index)) / 8,
        );
      }
      uv.needsUpdate = true;
      parts.push(plane);
    }
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  if (!merged) throw new Error('棋盘格几何合并失败');
  return merged;
}

function makeLabelTexture(text: string): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建坐标画布');
  context.clearRect(0, 0, size, size);
  context.fillStyle = '#e2c79b';
  context.font = 'bold 76px Georgia, "Times New Roman", serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, size / 2, size / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function addLabel(
  group: THREE.Group,
  text: string,
  x: number,
  z: number,
): THREE.Texture {
  const texture = makeLabelTexture(text);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.set(x, 0.075, z);
  sprite.scale.set(0.3, 0.3, 0.3);
  sprite.renderOrder = 30;
  group.add(sprite);
  return texture;
}

export function createBoard(): BoardView {
  const group = new THREE.Group();
  const labelTextures: THREE.Texture[] = [];
  const woodTextures: WoodTextureSet[] = [];

  const lightWood = createWoodTexture(WOOD_PALETTES.boardLight);
  const darkWood = createWoodTexture(WOOD_PALETTES.boardDark);
  const frameWood = createWoodTexture(WOOD_PALETTES.frame);
  woodTextures.push(lightWood, darkWood, frameWood);

  lightWood.map.wrapS = THREE.ClampToEdgeWrapping;
  lightWood.map.wrapT = THREE.ClampToEdgeWrapping;
  darkWood.map.wrapS = THREE.ClampToEdgeWrapping;
  darkWood.map.wrapT = THREE.ClampToEdgeWrapping;
  frameWood.map.repeat.set(2, 1.2);
  frameWood.bumpMap.repeat.set(2, 1.2);

  const lightMaterial = new THREE.MeshPhysicalMaterial({
    map: lightWood.map,
    bumpMap: lightWood.bumpMap,
    bumpScale: 0.012,
    color: 0xffffff,
    roughness: 0.52,
    metalness: 0,
    clearcoat: 0.16,
    clearcoatRoughness: 0.4,
  });
  const darkMaterial = new THREE.MeshPhysicalMaterial({
    map: darkWood.map,
    bumpMap: darkWood.bumpMap,
    bumpScale: 0.014,
    color: 0xffffff,
    roughness: 0.48,
    metalness: 0,
    clearcoat: 0.22,
    clearcoatRoughness: 0.34,
  });

  const lightSquares = new THREE.Mesh(mergeSquares(true), lightMaterial);
  lightSquares.receiveShadow = true;
  const darkSquares = new THREE.Mesh(mergeSquares(false), darkMaterial);
  darkSquares.receiveShadow = true;
  group.add(lightSquares, darkSquares);

  const frameMaterial = new THREE.MeshPhysicalMaterial({
    map: frameWood.map,
    bumpMap: frameWood.bumpMap,
    bumpScale: 0.02,
    color: 0xffffff,
    roughness: 0.46,
    metalness: 0,
    clearcoat: 0.3,
    clearcoatRoughness: 0.3,
  });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.4, 9.5), frameMaterial);
  frame.position.y = -0.2;
  frame.receiveShadow = true;
  frame.castShadow = true;
  group.add(frame);

  const outerFrameMaterial = new THREE.MeshPhysicalMaterial({
    map: frameWood.map,
    bumpMap: frameWood.bumpMap,
    bumpScale: 0.018,
    color: 0xd8c0a0,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.25,
  });
  const outerFrame = new THREE.Mesh(
    new THREE.BoxGeometry(9.76, 0.22, 9.76),
    outerFrameMaterial,
  );
  outerFrame.position.y = -0.36;
  outerFrame.receiveShadow = true;
  outerFrame.castShadow = true;
  group.add(outerFrame);

  const trimMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xc79a52,
    roughness: 0.3,
    metalness: 0.72,
    clearcoat: 0.4,
    clearcoatRoughness: 0.2,
  });
  const trimGeometryH = new THREE.BoxGeometry(9.3, 0.04, 0.11);
  const trimGeometryV = new THREE.BoxGeometry(0.11, 0.04, 9.3);
  for (const z of [-4.58, 4.58]) {
    const trim = new THREE.Mesh(trimGeometryH, trimMaterial);
    trim.position.set(0, 0.018, z);
    trim.receiveShadow = true;
    group.add(trim);
  }
  for (const x of [-4.58, 4.58]) {
    const trim = new THREE.Mesh(trimGeometryV, trimMaterial);
    trim.position.set(x, 0.018, 0);
    trim.receiveShadow = true;
    group.add(trim);
  }

  for (let index = 0; index < 8; index += 1) {
    labelTextures.push(addLabel(group, FILES[index], index - 3.5, 4.2));
    labelTextures.push(addLabel(group, String(index + 1), -4.2, 3.5 - index));
  }

  return {
    group,
    dispose: () => {
      lightSquares.geometry.dispose();
      darkSquares.geometry.dispose();
      lightMaterial.dispose();
      darkMaterial.dispose();
      frame.geometry.dispose();
      frameMaterial.dispose();
      outerFrame.geometry.dispose();
      outerFrameMaterial.dispose();
      trimGeometryH.dispose();
      trimGeometryV.dispose();
      trimMaterial.dispose();
      labelTextures.forEach((texture) => texture.dispose());
      woodTextures.forEach((texture) => texture.dispose());
      group.traverse((object) => {
        if (object instanceof THREE.Sprite) object.material.dispose();
      });
    },
  };
}
