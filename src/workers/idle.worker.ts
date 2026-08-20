/// <reference lib="webworker" />

import type { IdleWorkerRequest, IdleWorkerResponse } from "../idle/IdleProtocol";
import { simulateOffline } from "../idle/OfflineModel";
import { RNG_ALGORITHM } from "../rng/XorShift32";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<IdleWorkerRequest>) => {
  const msg = event.data;
  if (msg.type !== "IDLE_SIMULATE") return;

  const startedAt = performance.now();

  try {
    if (msg.rngAlgorithm !== RNG_ALGORITHM) {
      throw new Error(`Unsupported RNG algorithm: ${msg.rngAlgorithm}`);
    }

    const colorId = new Uint8Array(msg.colorId);
    const hp = new Uint8Array(msg.hp);

    const result = simulateOffline({
      colorId,
      hp,
      paletteSize: msg.paletteSize,
      elapsedMs: msg.elapsedMs,
      maxOfflineMs: msg.model.maxOfflineMs,
      damagePerSecondByColor: msg.model.damagePerSecondByColor,
      fractionalCarryByColor: msg.model.fractionalCarryByColor,
      rngState: msg.rngState,
    });

    const response: IdleWorkerResponse = {
      v: 1,
      requestId: msg.requestId,
      type: "IDLE_RESULT",
      colorId: colorId.buffer as ArrayBuffer,
      hp: hp.buffer as ArrayBuffer,
      rngState: result.rngState,
      fractionalCarryByColor: result.fractionalCarryByColor,
      removedByColor: result.removedByColor.buffer as ArrayBuffer,
      summary: {
        elapsedAppliedMs: result.elapsedAppliedMs,
        totalDestroyed: result.totalDestroyed,
        durationMs: performance.now() - startedAt,
      },
    };

    ctx.postMessage(response, [response.colorId, response.hp, response.removedByColor]);
  } catch (error) {
    ctx.postMessage({
      v: 1,
      requestId: msg.requestId,
      type: "ERROR",
      code: "IDLE_SIMULATE_FAILED",
      message: error instanceof Error ? error.message : String(error),
    } satisfies IdleWorkerResponse);
  }
};
