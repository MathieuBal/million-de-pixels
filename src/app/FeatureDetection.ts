export interface FeatureReport {
  webgl2: boolean;
  webWorkers: boolean;
  offscreenCanvas: boolean;
  createImageBitmap: boolean;
  indexedDB: boolean;
  missing: string[];
}

/**
 * The prototype refuses to start silently degraded: WebGL2, Workers and
 * OffscreenCanvas are structural, not optional. IndexedDB failing only costs
 * persistence, so it is reported but not fatal.
 */
export function detectFeatures(): FeatureReport {
  const webgl2 = hasWebGL2();
  const webWorkers = typeof Worker !== "undefined";
  const offscreenCanvas = typeof OffscreenCanvas !== "undefined";
  const bitmap = typeof createImageBitmap === "function";
  const idb = typeof indexedDB !== "undefined";

  const missing: string[] = [];
  if (!webgl2) missing.push("WebGL2");
  if (!webWorkers) missing.push("Web Workers");
  if (!offscreenCanvas) missing.push("OffscreenCanvas");
  if (!bitmap) missing.push("createImageBitmap");

  return {
    webgl2,
    webWorkers,
    offscreenCanvas,
    createImageBitmap: bitmap,
    indexedDB: idb,
    missing,
  };
}

function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    const supported = gl !== null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return supported;
  } catch {
    return false;
  }
}

/** Coarse device profile used to pick the LOD budget. */
export function isMobileProfile(): boolean {
  if (typeof navigator === "undefined") return false;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const smallScreen = typeof window !== "undefined" && Math.min(window.innerWidth, window.innerHeight) < 800;
  return coarse && smallScreen;
}
