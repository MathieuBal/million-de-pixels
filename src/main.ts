import { Application } from "pixi.js";
import { GameController } from "./app/GameController";
import { detectFeatures } from "./app/FeatureDetection";
import { GameScreen } from "./ui/GameScreen";
import { ImportScreen } from "./ui/ImportScreen";
import { RunMenu } from "./ui/RunMenu";
import { OfflineScreen } from "./ui/OfflineScreen";
import { ViewportControls } from "./ui/ViewportControls";

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
    backgroundAlpha: 0,
    powerPreference: "high-performance",
  });

  // Declared ahead of the controller: its callbacks close over them, and they
  // in turn need the controller to read state from.
  let gameScreen: GameScreen;
  let importScreen: ImportScreen;
  let offlineScreen: OfflineScreen;
  let runMenu: RunMenu;
  let syncBoard: () => void;

  const game: GameController = new GameController(app, {
    onPhase: (phase) => {
      if (phase === "processing") {
        importScreen.beginAnalysis();
      } else if (phase === "playing") {
        importScreen.hide();
        gameScreen.show();
        syncBoard();
      } else {
        gameScreen.hide();
        // A level set aside is still there: the import screen says so.
        importScreen.setResumable(game.canResume);
        importScreen.show();
      }
    },
    onProgress: ({ stage, progress }) => importScreen.updateStage(stage, progress),
    onLevelPrepared: (palette, colorId, width) => {
      importScreen.showResult(palette, colorId, width);
    },
    onLevelReady: (world) => {
      gameScreen.setLevelLabel(`Image · ${world.paletteSize} couleurs`);
      gameScreen.renderCards();
    },
    onMilestone: (milestone) => gameScreen.announceMilestone(milestone),
    onLevelCleared: (_pass, shards) => runMenu.announceCleared(shards),
    onFinale: () =>
      gameScreen.notify("99,9 % — la toile se termine toute seule, munitions illimitées."),
    onOfflineReport: (report) => {
      const world = game.getWorld();
      if (world) offlineScreen.show(report, world.palette);
    },
    onError: (message) => {
      importScreen.showError(message);
      gameScreen.notify(message, "error");
    },
  });

  importScreen = new ImportScreen((file, options) => void game.importImage(file, options));
  gameScreen = new GameScreen(game);
  offlineScreen = new OfflineScreen(() => {});

  runMenu = new RunMenu(game);

  importScreen.onStart(() => game.startPreparedLevel());
  importScreen.onResume(() => game.resume());

  const zoomLevel = document.getElementById("zoom-level") as HTMLOutputElement;
  const showZoom = (): void => {
    game.applyViewport();
    const scale = game.viewport.scale;
    zoomLevel.textContent = `×${scale.toFixed(scale < 10 ? 1 : 0)}`;
  };

  const controls = new ViewportControls(canvas, game.viewport, showZoom);
  document.getElementById("zoom-in")!.addEventListener("click", () => controls.zoomIn());
  document.getElementById("zoom-out")!.addEventListener("click", () => controls.zoomOut());
  document.getElementById("zoom-fit")!.addEventListener("click", () => controls.fit());
  document.getElementById("pause")!.addEventListener("click", () => gameScreen.upgrades.open());

  /**
   * The canvas lives inside the play area, so the camera's rectangle is simply
   * the canvas itself — in logical pixels, not device pixels.
   */
  syncBoard = (): void => {
    const size = gameScreen.takeBoardSize();
    if (!size) return;
    // Pixi cannot measure the canvas while the game screen is still hidden, so
    // the size is pushed in from the layout rather than polled.
    app.renderer.resize(size.width, size.height);
    game.layoutBoard({ x: 0, y: 0, width: size.width, height: size.height });
    showZoom();
  };

  app.ticker.add(() => {
    syncBoard();
    gameScreen.update(performance.now());
  });
  window.addEventListener("resize", syncBoard);

  if (!features.indexedDB) {
    gameScreen.notify("IndexedDB indisponible : la partie ne sera pas sauvegardée.", "error");
  }

  await game.loadMeta();

  const restored = await game.restoreLatest().catch(() => false);
  if (!restored) importScreen.show();

  Object.assign(window, { __game: game, __controls: controls, __menu: runMenu });
}

function fatal(message: string): void {
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = `<section class="screen screen-import"><h1>Incompatible</h1><p class="lede">${message}</p></section>`;
}

void boot();
