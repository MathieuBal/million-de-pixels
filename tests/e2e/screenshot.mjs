/**
 * Screenshot harness.
 *
 * The layout is the one part of this project no assertion covers: a grid that
 * technically applies can still put eight offers in columns the height of the
 * board. This drives a real browser to a playable state and writes a PNG, so a
 * layout change can be looked at instead of guessed at.
 *
 * Usage: npm run build && node tests/e2e/screenshot.mjs out.png [width] [height]
 *        SHOT_PANEL=1 to capture the upgrade panel open.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { posterPng } from "../../scripts/makePosterPng.mjs";

const PORT = 4188;
const URL = `http://localhost:${PORT}/`;
const OUT = process.argv[2];
const W = Number(process.argv[3] ?? 1440);
const H = Number(process.argv[4] ?? 900);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shot-"));
const fixture = path.join(tmp, "poster.png");
fs.writeFileSync(fixture, posterPng());

const server = spawn("npx", ["vite", "preview", "--port", String(PORT)], {
  stdio: "ignore", cwd: "/home/user/million-de-pixels",
});

async function waitForServer(url) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server never came up");
}

try {
  await waitForServer(URL);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(URL, { waitUntil: "networkidle" });

  // L'accueil tel qu'il s'ouvre : campagne comprise, sans rien avoir importé.
  if (process.env.SHOT_HOME) {
    await page.waitForTimeout(700);
    if (process.env.SHOT_SCROLL) {
      await page.evaluate((y) => window.scrollTo(0, Number(y)), process.env.SHOT_SCROLL);
      await page.waitForTimeout(200);
    }
    await page.screenshot({ path: OUT, fullPage: process.env.SHOT_FULL === "1" });
    await browser.close();
    process.exit(0);
  }

  await page.setInputFiles("#file-input", fixture);
  await page.waitForSelector("#start-run:not([disabled])", { timeout: 60000 });
  await page.locator("#start-run").click();
  await page.waitForSelector("#screen-game:not([hidden])", { timeout: 60000 });
  await page.waitForTimeout(2500);
  // Launch a few cannons so the rail is visible.
  for (let i = 0; i < 4; i++) {
    const card = page.locator("#cards button:not([disabled])").first();
    if (await card.count()) { await card.click(); await page.waitForTimeout(150); }
  }
  await page.waitForTimeout(1500);
  if (process.env.SHOT_RAIL) {
    // Close in until a board cell is a handful of screen pixels: the cannon is
    // drawn at the board's own scale, so it is only legible when the board is.
    await page.evaluate((withFx) => {
      const game = window.__game;
      if (withFx) {
        const meta = game.getMeta();
        meta.recordClear({ playablePixels: 200_000_000, paletteSize: 8, awkwardColors: 5, pass: 1 });
        for (const id of ["explosion", "foudre", "feu"]) meta.buy(id);
        for (let i = 0; i < 400; i++) { meta.buy("explosionProc"); meta.buy("souffle"); }
      }
      const cannon = game.getCombat().activeCannons[0];
      // Freeze the rail: at 260 cells a second it would be a third of the way
      // round the board by the time the shutter opens. With effects on, leave
      // it crawling so something actually fires in frame.
      for (const c of game.getCombat().activeCannons) c.tune(withFx ? 3 : 0);
      const aim = cannon?.aim();
      for (let i = 0; i < 8; i++) window.__controls.zoomIn();
      if (aim) {
        // Centre on the board edge the cannon straddles, not on the aim point:
        // the aim sits outside the board and the sprite hangs back from it.
        game.viewport.centerX = aim.axis === "row" ? (aim.direction > 0 ? 6 : 1018) : aim.x;
        game.viewport.centerY = aim.axis === "column" ? (aim.direction > 0 ? 6 : 1018) : aim.y;
      }
      game.applyViewport();
    }, Boolean(process.env.SHOT_FX));
    await page.waitForTimeout(900);
    await page.screenshot({ path: OUT });
    await browser.close();
    process.exit(0);
  }
  if (process.env.SHOT_LIBRARY) {
    await page.evaluate(() => {
      const meta = window.__game.getMeta();
      // A profile a few dozen toiles in: enough holes for the grid to read.
      // The cube is four thousand hexes now, so a plausible profile fills a few
      // hundred of them — sparse pages are the honest picture.
      let seed = 7;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      for (let i = 0; i < 400; i++) {
        meta.library.record({
          r: Math.floor(rnd() * 256), g: Math.floor(rnd() * 256), b: Math.floor(rnd() * 256),
          count: Math.floor(rnd() * 90000),
        });
      }
    });
    await page.locator("#pause").click();
    await page.waitForSelector("#upgrade-panel:not([hidden])");
    await page.locator('#upgrade-tabs button[data-tab="library"]').click();
    await page.waitForTimeout(400);
    if (process.env.SHOT_SPECIMEN) {
      await page.locator('.hex-cell[data-found="true"]').first().click();
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: OUT });
    await browser.close();
    process.exit(0);
  }
  if (process.env.SHOT_CLEAR) {
    // Give the run a history so the clear panel has a record to beat.
    await page.evaluate(() => {
      const game = window.__game;
      const gallery = game.getGallery();
      const record = gallery.all()[0];
      if (record) gallery.noteClear(record.id, 214_000, 25, Date.now());
    });
    await page.evaluate(() => {
      const world = window.__game.getWorld();
      const rng = { nextInt: () => 0, nextFloat: () => 0, nextUint32: () => 1 };
      for (let c = 0; c < world.paletteSize; c++) {
        world.destroyRandomOfColor(c, world.aliveByColor(c), rng);
      }
    });
    await page.waitForSelector("#run-menu:not([hidden])", { timeout: 15000 });
    await page.waitForTimeout(400);
  }
  if (process.env.SHOT_PALETTE) {
    await page.evaluate(() => {
      const meta = window.__game.getMeta();
      meta.recordClear({ playablePixels: 60_000_000, paletteSize: 8, awkwardColors: 5, pass: 1 });
      meta.buy("nuancier");
      meta.buy("filtre");
    });
    await page.waitForTimeout(900);
    await page.locator("#palette-toggle").click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: OUT });
    await browser.close();
    process.exit(0);
  }
  if (process.env.SHOT_TREE) {
    await page.evaluate(() => {
      const meta = window.__game.getMeta();
      meta.recordClear({ playablePixels: 40_000_000, paletteSize: 8, awkwardColors: 5, pass: 1 });
      for (const id of ["explosion", "foudre", "filtre", "nuancier"]) meta.buy(id);
      for (let i = 0; i < 30; i++) { meta.buy("fondation"); meta.buy("souffle"); }
    });
    await page.locator("#pause").click();
    await page.waitForSelector("#upgrade-panel:not([hidden])");
    await page.locator('#upgrade-tabs button[data-tab="permanent"]').click();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const rows = document.getElementById("upgrade-rows");
      rows.scrollTop = rows.scrollHeight;
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: OUT });
    await browser.close();
    process.exit(0);
  }
  if (process.env.SHOT_GALLERY) {
    // Une galerie plausible : quelques images, des temps, une jamais finie.
    await page.evaluate(() => {
      const g = window.__game.getGallery();
      const seed = g.all()[0];
      if (seed) {
        g.noteClear(seed.id, 726_000, 25, Date.now() - 400_000);
        g.noteClear(seed.id, 512_000, 31, Date.now() - 300_000);
        for (const [i, name] of ["montagne.jpg", "portrait.png", "affiche-2.webp"].entries()) {
          g.remember({ ...seed, id: `demo-${i}`, name }, Date.now() - i * 10_000);
          if (i < 2) g.noteClear(`demo-${i}`, 300_000 + i * 240_000, 20, Date.now() - i * 9000);
        }
      }
    });
    // Retour à l'accueil par le chemin du joueur : le menu, puis « changer »,
    // qui demande deux clics — le premier ne fait qu'armer le bouton.
    await page.locator("#menu").click();
    await page.waitForSelector("#run-menu:not([hidden])");
    await page.locator("#run-change").click();
    await page.locator("#run-change").click();
    await page.waitForSelector("#screen-import:not([hidden])", { timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: OUT });
    await browser.close();
    process.exit(0);
  }
  if (process.env.SHOT_AUTO) {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    const report = [];
    await page.evaluate(() => {
      const g = window.__game;
      g.getUpgrades().earn(50_000);
      g.buyUpgrade("automate");
      g.setAutoLaunch(true);
    });
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(5000);
      report.push(await page.evaluate(() => {
        const g = window.__game;
        return {
          canons: document.querySelectorAll(".rail-token").length,
          vivants: g.getWorld().aliveTotal(),
          auto: g.isAutoLaunching,
          delai: g.getUpgrades().effects(g.getMeta().bonus()).autoLaunchMs,
        };
      }));
    }
    console.log("AUTO " + JSON.stringify(report));
    console.log("ERREURS " + JSON.stringify(errors.slice(0, 5)));
    await browser.close();
    process.exit(0);
  }
  if (process.env.SHOT_PANEL) {
    await page.locator("#pause").click();
    await page.waitForSelector("#upgrade-panel:not([hidden])");
    if (process.env.SHOT_FAMILY) {
      await page.locator(`.sub-tab[data-id="${process.env.SHOT_FAMILY}"]`).click();
    }
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: OUT });
  console.log("shot:", OUT);
  await browser.close();
} finally {
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
