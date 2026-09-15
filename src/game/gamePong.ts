const PONG_WIDTH: number = 160;
const PONG_HEIGHT: number = 210;
const BYTES_PER_PIXEL: number = 4;

export type PlayerColor = "green" | "blue";

export interface PaddleColors {
  left: PlayerColor;
  right: PlayerColor;
}

const PLAYER_RGB: Record<PlayerColor, readonly [number, number, number]> = {
  green: [34, 197, 94],
  blue: [59, 130, 246],
};

interface PixelBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function isPongForeground(pixels: Uint8Array, idx: number): boolean {
  const r: number = pixels[idx];
  const g: number = pixels[idx + 1];
  const b: number = pixels[idx + 2];
  const max: number = Math.max(r, g, b);
  const luminance: number = r * 0.2126 + g * 0.7152 + b * 0.0722;
  return max >= 110 && luminance >= 100;
}

function findPongPaddle(
  pixels: Uint8Array,
  width: number,
  xFrom: number,
  xTo: number,
): PixelBounds | null {
  const yFrom: number = 30;
  const yTo: number = 199;
  let bestTop: number = -1;
  let bestBottom: number = -1;
  let runTop: number = -1;

  for (let y: number = yFrom; y <= yTo + 1; y += 1) {
    let brightCount: number = 0;
    if (y <= yTo) {
      for (let x: number = xFrom; x <= xTo; x += 1) {
        const idx: number = (y * width + x) * BYTES_PER_PIXEL;
        if (isPongForeground(pixels, idx)) brightCount += 1;
      }
    }

    if (brightCount >= 2) {
      if (runTop < 0) runTop = y;
      continue;
    }

    if (runTop >= 0) {
      const runBottom: number = y - 1;
      if (runBottom - runTop > bestBottom - bestTop) {
        bestTop = runTop;
        bestBottom = runBottom;
      }
      runTop = -1;
    }
  }

  if (bestTop < 0 || bestBottom - bestTop + 1 < 5) return null;

  let left: number = xTo;
  let right: number = xFrom;
  for (let y: number = bestTop; y <= bestBottom; y += 1) {
    for (let x: number = xFrom; x <= xTo; x += 1) {
      const idx: number = (y * width + x) * BYTES_PER_PIXEL;
      if (!isPongForeground(pixels, idx)) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }

  return left <= right ? { left, right, top: bestTop, bottom: bestBottom } : null;
}

function recolorBrightRegion(
  pixels: Uint8Array,
  width: number,
  bounds: PixelBounds,
  color: PlayerColor,
): void {
  const [tr, tg, tb] = PLAYER_RGB[color];
  for (let y: number = bounds.top; y <= bounds.bottom; y += 1) {
    for (let x: number = bounds.left; x <= bounds.right; x += 1) {
      const idx: number = (y * width + x) * BYTES_PER_PIXEL;
      if (!isPongForeground(pixels, idx)) continue;
      pixels[idx] = tr;
      pixels[idx + 1] = tg;
      pixels[idx + 2] = tb;
    }
  }
}

function normPongPaddles(
  pixels: Uint8Array,
  width: number,
  left: PixelBounds,
  right: PixelBounds,
  colors: PaddleColors,
): void {
  const leftWidth: number = left.right - left.left + 1;
  const rightWidth: number = right.right - right.left + 1;
  const leftHeight: number = left.bottom - left.top + 1;
  const rightHeight: number = right.bottom - right.top + 1;
  const targetWidth: number = Math.max(2, Math.min(leftWidth, rightWidth, 6));
  const targetHeight: number = Math.max(5, Math.min(leftHeight, rightHeight, 24));

  const render: (bounds: PixelBounds, color: PlayerColor, sampleDir: -1 | 1) => void = (
    bounds: PixelBounds,
    color: PlayerColor,
    sampleDir: -1 | 1,
  ): void => {
    for (let y: number = bounds.top; y <= bounds.bottom; y += 1) {
      let sampleIdx: number = (y * width + bounds.left) * BYTES_PER_PIXEL;
      let sampleBrightness: number = Number.POSITIVE_INFINITY;
      for (const distance of [5, 8, 12]) {
        const sampleX: number = Math.max(
          0,
          Math.min(width - 1, sampleDir < 0 ? bounds.left - distance : bounds.right + distance),
        );
        const candidateIdx: number = (y * width + sampleX) * BYTES_PER_PIXEL;
        const brightness: number =
          pixels[candidateIdx] + pixels[candidateIdx + 1] + pixels[candidateIdx + 2];
        if (brightness < sampleBrightness) {
          sampleBrightness = brightness;
          sampleIdx = candidateIdx;
        }
      }
      for (let x: number = bounds.left; x <= bounds.right; x += 1) {
        const idx: number = (y * width + x) * BYTES_PER_PIXEL;
        if (!isPongForeground(pixels, idx)) continue;
        pixels[idx] = pixels[sampleIdx];
        pixels[idx + 1] = pixels[sampleIdx + 1];
        pixels[idx + 2] = pixels[sampleIdx + 2];
      }
    }

    const centerX: number = Math.round((bounds.left + bounds.right) / 2);
    const centerY: number = Math.round((bounds.top + bounds.bottom) / 2);
    const drawLeft: number = Math.round(centerX - (targetWidth - 1) / 2);
    const drawTop: number = Math.round(centerY - (targetHeight - 1) / 2);
    const [tr, tg, tb] = PLAYER_RGB[color];

    for (let y: number = drawTop; y < drawTop + targetHeight; y += 1) {
      for (let x: number = drawLeft; x < drawLeft + targetWidth; x += 1) {
        if (x < 0 || x >= width || y < 0 || y >= PONG_HEIGHT) continue;
        const idx: number = (y * width + x) * BYTES_PER_PIXEL;
        pixels[idx] = tr;
        pixels[idx + 1] = tg;
        pixels[idx + 2] = tb;
      }
    }
  };

  render(left, colors.left, 1);
  render(right, colors.right, -1);
}

export function stylePongFrame(
  pixels: Uint8Array,
  width: number,
  height: number,
  colors: PaddleColors,
): void {
  if (width !== PONG_WIDTH || height !== PONG_HEIGHT) return;

  const leftPaddle: PixelBounds | null = findPongPaddle(pixels, width, 10, 28);
  const rightPaddle: PixelBounds | null = findPongPaddle(pixels, width, 131, 150);

  if (leftPaddle && rightPaddle) {
    normPongPaddles(pixels, width, leftPaddle, rightPaddle, colors);
  } else {
    if (leftPaddle) recolorBrightRegion(pixels, width, leftPaddle, colors.left);
    if (rightPaddle) recolorBrightRegion(pixels, width, rightPaddle, colors.right);
  }

  recolorBrightRegion(pixels, width, { left: 20, right: 52, top: 0, bottom: 22 }, colors.left);
  recolorBrightRegion(pixels, width, { left: 108, right: 140, top: 0, bottom: 22 }, colors.right);
}
