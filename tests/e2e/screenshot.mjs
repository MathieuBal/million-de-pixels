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
  if (process.env.SHOT_CLEAR) {
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
  if (process.env.SHOT_PANEL) {
    await page.locator("#pause").click();
    await page.waitForSelector("#upgrade-panel:not([hidden])");
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: OUT });
  console.log("shot:", OUT);
  await browser.close();
} finally {
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
