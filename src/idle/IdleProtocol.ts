import type { RngAlgorithm } from "../rng/XorShift32";

export interface IdleSimulateRequest {
  v: 1;
  requestId: string;
  type: "IDLE_SIMULATE";

  elapsedMs: number;

  width: number;
  height: number;
  paletteSize: number;

  /** Transferred, not copied — the caller loses access until the reply. */
  colorId: ArrayBuffer;
  hp: ArrayBuffer;

  rngAlgorithm: RngAlgorithm;
  rngState: number;

  model: {
    damagePerSecondByColor: number[];
    fractionalCarryByColor: number[];
    maxOfflineMs: number;
  };
}

export interface IdleResultResponse {
  v: 1;
  requestId: string;
  type: "IDLE_RESULT";

  colorId: ArrayBuffer;
  hp: ArrayBuffer;

  rngState: number;
  fractionalCarryByColor: number[];
  removedByColor: ArrayBuffer;

  summary: {
    elapsedAppliedMs: number;
    totalDestroyed: number;
    durationMs: number;
  };
}

export interface IdleErrorResponse {
  v: 1;
  requestId: string;
  type: "ERROR";
  code: string;
  message: string;
}

export type IdleWorkerRequest = IdleSimulateRequest;
export type IdleWorkerResponse = IdleResultResponse | IdleErrorResponse;

/** Default cap on an absence. Economy decision, deliberately left tunable. */
export const DEFAULT_MAX_OFFLINE_MS = 8 * 60 * 60 * 1000;

/**
 * Below this, the catch-up still runs but nothing is announced. Reloading the
 * page is not an absence, and a panel reading "Absence 0 min" is noise.
 */
export const OFFLINE_REPORT_THRESHOLD_MS = 2 * 60 * 1000;
