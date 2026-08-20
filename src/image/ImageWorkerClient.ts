import type {
  ImageProcessOptions,
  ImageResultResponse,
  ImageStage,
  ImageWorkerResponse,
} from "./ImageProtocol";

export interface ImageProgress {
  stage: ImageStage;
  progress: number;
}

/**
 * Main-thread facade over `image.worker`.
 *
 * Requests carry an id so a result that arrives after the player dropped a
 * second image is discarded instead of overwriting the newer level.
 */
export class ImageWorkerClient {
  private worker: Worker | null = null;
  private requestCounter = 0;
  private currentRequestId: string | null = null;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("../workers/image.worker.ts", import.meta.url), {
        type: "module",
      });
    }
    return this.worker;
  }

  cancel(): void {
    if (!this.worker || !this.currentRequestId) return;
    this.worker.postMessage({ v: 1, requestId: this.currentRequestId, type: "CANCEL" });
    this.currentRequestId = null;
  }

  process(
    file: Blob,
    options: ImageProcessOptions,
    onProgress?: (progress: ImageProgress) => void,
  ): Promise<ImageResultResponse> {
    const worker = this.ensureWorker();
    const requestId = `img-${++this.requestCounter}`;
    this.currentRequestId = requestId;

    return new Promise((resolve, reject) => {
      const handle = (event: MessageEvent<ImageWorkerResponse>) => {
        const msg = event.data;
        if (msg.requestId !== requestId) return; // stale response, ignore

        if (msg.type === "IMAGE_PROGRESS") {
          onProgress?.({ stage: msg.stage, progress: msg.progress });
          return;
        }

        worker.removeEventListener("message", handle);
        worker.removeEventListener("error", onError);
        this.currentRequestId = null;

        if (msg.type === "ERROR") reject(new Error(msg.message));
        else resolve(msg);
      };

      const onError = (event: ErrorEvent) => {
        worker.removeEventListener("message", handle);
        worker.removeEventListener("error", onError);
        this.currentRequestId = null;
        reject(new Error(event.message || "image worker crashed"));
      };

      worker.addEventListener("message", handle);
      worker.addEventListener("error", onError);
      worker.postMessage({ v: 1, requestId, type: "IMAGE_PROCESS", file, options });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
