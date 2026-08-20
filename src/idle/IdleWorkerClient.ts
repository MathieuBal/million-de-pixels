import { RNG_ALGORITHM } from "../rng/XorShift32";
import type { IdleResultResponse, IdleWorkerResponse } from "./IdleProtocol";

export interface IdleSimulationInput {
  elapsedMs: number;
  width: number;
  height: number;
  paletteSize: number;
  colorId: Uint8Array;
  hp: Uint8Array;
  rngState: number;
  damagePerSecondByColor: number[];
  fractionalCarryByColor: number[];
  maxOfflineMs: number;
}

export interface IdleSimulationOutput {
  colorId: Uint8Array;
  hp: Uint8Array;
  removedByColor: Uint32Array;
  rngState: number;
  fractionalCarryByColor: number[];
  elapsedAppliedMs: number;
  totalDestroyed: number;
  durationMs: number;
}

/**
 * Main-thread facade over `idle.worker`.
 *
 * The board buffers are transferred, so the caller must treat them as detached
 * until the reply lands and must adopt the buffers that come back.
 */
export class IdleWorkerClient {
  private worker: Worker | null = null;
  private counter = 0;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("../workers/idle.worker.ts", import.meta.url), {
        type: "module",
      });
    }
    return this.worker;
  }

  simulate(input: IdleSimulationInput): Promise<IdleSimulationOutput> {
    const worker = this.ensureWorker();
    const requestId = `idle-${++this.counter}`;

    const colorBuffer = input.colorId.buffer as ArrayBuffer;
    const hpBuffer = input.hp.buffer as ArrayBuffer;

    return new Promise((resolve, reject) => {
      const handle = (event: MessageEvent<IdleWorkerResponse>) => {
        const msg = event.data;
        if (msg.requestId !== requestId) return;

        worker.removeEventListener("message", handle);
        worker.removeEventListener("error", onError);

        if (msg.type === "ERROR") {
          reject(new Error(msg.message));
          return;
        }
        resolve(adopt(msg));
      };

      const onError = (event: ErrorEvent) => {
        worker.removeEventListener("message", handle);
        worker.removeEventListener("error", onError);
        reject(new Error(event.message || "idle worker crashed"));
      };

      worker.addEventListener("message", handle);
      worker.addEventListener("error", onError);

      worker.postMessage(
        {
          v: 1,
          requestId,
          type: "IDLE_SIMULATE",
          elapsedMs: input.elapsedMs,
          width: input.width,
          height: input.height,
          paletteSize: input.paletteSize,
          colorId: colorBuffer,
          hp: hpBuffer,
          rngAlgorithm: RNG_ALGORITHM,
          rngState: input.rngState,
          model: {
            damagePerSecondByColor: input.damagePerSecondByColor,
            fractionalCarryByColor: input.fractionalCarryByColor,
            maxOfflineMs: input.maxOfflineMs,
          },
        },
        [colorBuffer, hpBuffer],
      );
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

function adopt(msg: IdleResultResponse): IdleSimulationOutput {
  return {
    colorId: new Uint8Array(msg.colorId),
    hp: new Uint8Array(msg.hp),
    removedByColor: new Uint32Array(msg.removedByColor),
    rngState: msg.rngState,
    fractionalCarryByColor: msg.fractionalCarryByColor,
    elapsedAppliedMs: msg.summary.elapsedAppliedMs,
    totalDestroyed: msg.summary.totalDestroyed,
    durationMs: msg.summary.durationMs,
  };
}
