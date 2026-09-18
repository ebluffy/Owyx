/** Must match AvatarCropModal preview frame / crop circle. */
export const AVATAR_VIEW_PX = 288;
export const AVATAR_CROP_PX = 256;
const PAD = (AVATAR_VIEW_PX - AVATAR_CROP_PX) / 2;
const RADIUS = AVATAR_CROP_PX / 2;

export type AvatarCropParams = {
  naturalWidth: number;
  naturalHeight: number;
  zoom: number;
  rotation: number;
  flipX: number;
  offsetX: number;
  offsetY: number;
  outputSize?: number;
};

/** Scale that exactly covers the crop circle at zoom=1. */
export function avatarCoverBase(natW: number, natH: number): number {
  if (natW <= 0 || natH <= 0) return 1;
  return Math.max(AVATAR_CROP_PX / natW, AVATAR_CROP_PX / natH);
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function rotatedHalfExtents(w: number, h: number, scale: number, rotationDeg: number) {
  const rad = degToRad(rotationDeg);
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return {
    halfW: ((w * c + h * s) * scale) / 2,
    halfH: ((w * s + h * c) * scale) / 2,
  };
}

/** Keep the crop circle fully inside the uploaded image (no empty / black holes). */
export function clampAvatarOffset(
  ox: number,
  oy: number,
  natW: number,
  natH: number,
  zoom: number,
  rotationDeg: number,
): { x: number; y: number } {
  const scale = avatarCoverBase(natW, natH) * zoom;
  const { halfW, halfH } = rotatedHalfExtents(natW, natH, scale, rotationDeg);
  const maxX = Math.max(0, halfW - RADIUS);
  const maxY = Math.max(0, halfH - RADIUS);
  return {
    x: Math.min(maxX, Math.max(-maxX, ox)),
    y: Math.min(maxY, Math.max(-maxY, oy)),
  };
}

/**
 * Renders the same transform stack as the crop modal (translate → rotate → scale)
 * and exports a square PNG matching the on-screen circle.
 */
export async function renderAvatarCropPng(
  image: HTMLImageElement,
  params: AvatarCropParams,
): Promise<Blob> {
  const {
    naturalWidth: natW,
    naturalHeight: natH,
    zoom,
    rotation,
    flipX,
    offsetX,
    offsetY,
    outputSize = 512,
  } = params;

  const displayScale = avatarCoverBase(natW, natH) * zoom;
  const clamped = clampAvatarOffset(offsetX, offsetY, natW, natH, zoom, rotation);

  const view = document.createElement("canvas");
  view.width = AVATAR_VIEW_PX;
  view.height = AVATAR_VIEW_PX;
  const ctx = view.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");

  ctx.save();
  ctx.translate(AVATAR_VIEW_PX / 2 + clamped.x, AVATAR_VIEW_PX / 2 + clamped.y);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(flipX * displayScale, displayScale);
  ctx.drawImage(image, -natW / 2, -natH / 2);
  ctx.restore();

  const crop = document.createElement("canvas");
  crop.width = AVATAR_CROP_PX;
  crop.height = AVATAR_CROP_PX;
  const cropCtx = crop.getContext("2d");
  if (!cropCtx) throw new Error("canvas unsupported");
  cropCtx.drawImage(
    view,
    PAD,
    PAD,
    AVATAR_CROP_PX,
    AVATAR_CROP_PX,
    0,
    0,
    AVATAR_CROP_PX,
    AVATAR_CROP_PX,
  );

  const out = document.createElement("canvas");
  out.width = outputSize;
  out.height = outputSize;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("canvas unsupported");
  outCtx.drawImage(crop, 0, 0, outputSize, outputSize);

  return new Promise((resolve, reject) => {
    out.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("failed to encode avatar png"))),
      "image/png",
      0.92,
    );
  });
}
