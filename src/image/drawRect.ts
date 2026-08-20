import type { FitMode } from "./ImageProtocol";

export interface DrawRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Source/destination rectangles for drawing an arbitrary image into the
 * fixed 1024x1024 board.
 *
 * `contain` letterboxes (margins become VOID or a filled background),
 * `cover` crops the long side, `stretch` ignores the aspect ratio.
 */
export function computeDrawRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  fit: FitMode,
): DrawRect {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new RangeError("source dimensions must be positive");
  }

  if (fit === "stretch") {
    return {
      sx: 0,
      sy: 0,
      sw: sourceWidth,
      sh: sourceHeight,
      dx: 0,
      dy: 0,
      dw: targetWidth,
      dh: targetHeight,
    };
  }

  if (fit === "cover") {
    const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const cropW = Math.min(sourceWidth, targetWidth / scale);
    const cropH = Math.min(sourceHeight, targetHeight / scale);
    return {
      sx: (sourceWidth - cropW) / 2,
      sy: (sourceHeight - cropH) / 2,
      sw: cropW,
      sh: cropH,
      dx: 0,
      dy: 0,
      dw: targetWidth,
      dh: targetHeight,
    };
  }

  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const dw = Math.max(1, Math.round(sourceWidth * scale));
  const dh = Math.max(1, Math.round(sourceHeight * scale));
  return {
    sx: 0,
    sy: 0,
    sw: sourceWidth,
    sh: sourceHeight,
    dx: Math.floor((targetWidth - dw) / 2),
    dy: Math.floor((targetHeight - dh) / 2),
    dw,
    dh,
  };
}
