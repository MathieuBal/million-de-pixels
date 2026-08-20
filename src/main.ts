import { Application } from "pixi.js";
import { GameController } from "./app/GameController";
import { detectFeatures } from "./app/FeatureDetection";
import { DropZone } from "./ui/DropZone";
import { Hud } from "./ui/Hud";
import { ProgressPanel } from "./ui/ProgressPanel";

async function boot(): Promise<void> {
  const features = detectFeatures();
  if (features.missing.length > 0) {
    fatal(
      `Ce prototype nécessite ${features.missing.join(", ")}. ` +
        "Essayez un navigateur récent (Chrome, Firefox, Safari 17+).",
    );
    return;
  }

  const canvas = document.getElementById("board") as HTMLCanvasElement;
  const app = new Application();

  // WebGL is the recommended production renderer for Pixi v8; WebGPU stays a
  // post-profiling experiment, not a dependency of the prototype.
  await app.init({
    canvas,
    preference: "webgl",
    antialias: false,
    background: 0x08080c,
    resizeTo: window,
    powerPreference: "high-performance",
  });

  const progressPanel = new ProgressPanel();

  const game = new GameController(app, {
    onPhase: (phase) => {
      if (phase === "processing") {
        dropZone.hide();
        progressPanel.show();
      } else if (phase === "playing") {
        progressPanel.hide();
        dropZone.hide();
        hud.show();
      } else {
        progressPanel.hide();
        dropZone.show();
        hud.hide();
      }
    },
    onProgress: ({ stage, progress }) => progressPanel.update(stage, progress),
    onLevelReady: () => hud.renderDeck(),
    onMilestone: (milestone) => hud.announceMilestone(milestone),
    onOfflineReport: (report) => hud.announceOffline(report.elapsedMs, report.totalDestroyed),
    onError: (message) => {
      dropZone.showError(message);
      hud.notify(message, "error");
    },
  });

  const hud = new Hud(game);
  const dropZone = new DropZone((file, options) => void game.importImage(file, options));

  if (!features.indexedDB) {
    hud.notify("IndexedDB indisponible : la partie ne sera pas sauvegardée.", "error");
  }

  app.ticker.add(() => hud.update(performance.now()));

  const restored = await game.restoreLatest().catch(() => false);
  if (!restored) dropZone.show();

  // Handy for manual profiling from the console.
  Object.assign(window, { __game: game });
}

function fatal(message: string): void {
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = `<div class="overlay"><div class="panel"><h1>Incompatible</h1><p class="lede">${message}</p></div></div>`;
}

void boot();
