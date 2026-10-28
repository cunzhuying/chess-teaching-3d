import * as THREE from 'three';

export interface WoodPalette {
  base: string;
  grain: string;
  highlight: string;
}

export interface WoodTextureSet {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  dispose: () => void;
}

const SIZE = 512;

function drawGrain(
  context: CanvasRenderingContext2D,
  palette: WoodPalette,
  monochrome: boolean,
): void {
  const base = monochrome ? '#7d7d7d' : palette.base;
  const grain = monochrome ? '#a8a8a8' : palette.grain;
  const highlight = monochrome ? '#606060' : palette.highlight;

  context.fillStyle = base;
  context.fillRect(0, 0, SIZE, SIZE);

  // 大块色差，让木纹不是均匀噪声。
  for (let band = 0; band < 9; band += 1) {
    context.globalAlpha = 0.05 + Math.random() * 0.05;
    context.fillStyle = band % 2 === 0 ? grain : highlight;
    const width = 20 + Math.random() * 70;
    context.fillRect(Math.random() * SIZE, 0, width, SIZE);
  }

  // 细长、轻微弯曲的年轮线。
  context.lineCap = 'round';
  for (let line = 0; line < 95; line += 1) {
    const startX = Math.random() * SIZE;
    const amplitude = 1.5 + Math.random() * 8;
    const phase = Math.random() * Math.PI * 2;
    const drift = (Math.random() - 0.5) * 36;
    context.globalAlpha = 0.06 + Math.random() * 0.13;
    context.strokeStyle = Math.random() > 0.75 ? highlight : grain;
    context.lineWidth = 0.4 + Math.random() * 1.8;
    context.beginPath();
    for (let y = -8; y <= SIZE + 8; y += 5) {
      const x =
        startX +
        Math.sin(y / 42 + phase) * amplitude +
        Math.sin(y / 9 + phase * 1.7) * 0.7 +
        (y / SIZE) * drift;
      if (y === -8) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }

  // 少量木节。
  for (let knot = 0; knot < 3; knot += 1) {
    const x = 40 + Math.random() * (SIZE - 80);
    const y = 40 + Math.random() * (SIZE - 80);
    for (let ring = 0; ring < 4; ring += 1) {
      context.globalAlpha = 0.08 + ring * 0.025;
      context.strokeStyle = grain;
      context.lineWidth = 1.2;
      context.beginPath();
      context.ellipse(
        x,
        y,
        10 + ring * 9,
        4 + ring * 4,
        Math.random() * 0.4,
        0,
        Math.PI * 2,
      );
      context.stroke();
    }
  }

  // 细颗粒，避免近距离像塑料。
  const image = context.getImageData(0, 0, SIZE, SIZE);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const noise = (Math.random() - 0.5) * (monochrome ? 16 : 10);
    data[index] = Math.max(0, Math.min(255, data[index] + noise));
    data[index + 1] = Math.max(0, Math.min(255, data[index + 1] + noise));
    data[index + 2] = Math.max(0, Math.min(255, data[index + 2] + noise));
  }
  context.putImageData(image, 0, 0);
  context.globalAlpha = 1;
}

export function createWoodTexture(palette: WoodPalette): WoodTextureSet {
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = SIZE;
  colorCanvas.height = SIZE;
  const colorContext = colorCanvas.getContext('2d');
  if (!colorContext) throw new Error('无法创建木纹画布');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = SIZE;
  bumpCanvas.height = SIZE;
  const bumpContext = bumpCanvas.getContext('2d');
  if (!bumpContext) throw new Error('无法创建木纹凹凸画布');

  drawGrain(colorContext, palette, false);
  drawGrain(bumpContext, palette, true);

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 4;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.anisotropy = 4;

  return {
    map,
    bumpMap,
    dispose: () => {
      map.dispose();
      bumpMap.dispose();
    },
  };
}

export const WOOD_PALETTES = {
  whitePiece: { base: '#d9b884', grain: '#b28550', highlight: '#efd5a8' },
  blackPiece: { base: '#4a2a18', grain: '#2a150b', highlight: '#7d4d2d' },
  boardLight: { base: '#d8bd94', grain: '#b28a5d', highlight: '#ead3aa' },
  boardDark: { base: '#71452a', grain: '#4b2815', highlight: '#915c37' },
  frame: { base: '#3a2418', grain: '#1f110a', highlight: '#5b3822' },
} satisfies Record<string, WoodPalette>;
