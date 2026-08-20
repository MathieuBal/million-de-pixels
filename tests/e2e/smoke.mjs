/**
 * Browser smoke test and throughput benchmark.
 *
 * The renderer path (R8 texture, palette shader, particle packing) cannot be
 * covered by unit tests, and the design's acceptance criteria are measurements,
 * not assertions — so this drives a real browser and prints the numbers.
 *
 * Usage: npm run build && npm run e2e
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { posterPng } from "../../scripts/makePosterPng.mjs";

const PORT = 4173;
const URL = `http://localhost:${PORT}/`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? undefined;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-idle-"));
// A poster-like image: flat fields, fine hatching, a few tiny details. Closer
// to what players actually drop in than four solid quadrants.
const fixture = path.join(tmp, "poster.png");
fs.writeFileSync(fixture, posterPng());

const server = spawn("npx", ["vite", "preview", "--port", String(PORT)], {
  stdio: "ignore",
  detached: false,
});

const failures = [];
function check(label, condition, detail = "") {
  console.log(`${condition ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

try {
  await waitForServer(URL);

  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  // The reference layout: portrait 430 x 932.
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // Font CDN failures are a known sandbox limitation, not a page fault.
    if (m.type() === "error" && !/fonts\.(googleapis|gstatic)|ERR_CONNECTION/.test(m.text())) {
      errors.push(m.text());
    }
  });

  await page.goto(URL, { waitUntil: "networkidle" });
  check("demarre sans mur de compatibilite", (await page.locator("h1", { hasText: "Incompatible" }).count()) === 0);

  console.log("\n— import —");
  await page.setInputFiles("#file-input", fixture);
  await page.waitForSelector("#start-run:not([disabled])", { timeout: 60000 });

  const detected = await page.locator("#palette-count").innerText();
  check("palette detectee automatiquement", digits(detected) > 0, detected);
  check("apercu quantifie rendu", (await page.locator("#quantized-preview div").count()) === 256);
  check("palette affichee", (await page.locator("#palette-swatches div").count()) > 0);

  // The level is prepared, not started: the player chooses when to begin.
  check("la partie ne demarre pas toute seule", await page.locator("#screen-game").isHidden());
  await page.locator("#start-run").click();
  await page.waitForSelector("#screen-game:not([hidden])", { timeout: 30000 });

  const playable = digits(await page.locator("#playable-count").innerText());
  check(
    "la silhouette jouable tient dans le million de cellules",
    playable > 0 && playable <= 1_048_576,
    `${playable} / 1 048 576`,
  );
  check("slots du rail affiches", (await page.locator("#slots > div").count()) === 5);
  check("cartes couleurs generees", (await page.locator("#cards button").count()) > 0);

  // The reference layout is 430 x 932 and must hold without scrolling.
  const overflow = await page.evaluate(() => {
    const app = document.getElementById("app");
    return app.scrollHeight - app.clientHeight;
  });
  check("l'ecran tient sans defilement", overflow <= 0, `${overflow}px de debordement`);

  console.log("\n— un canon —");
  const before = digits(await page.locator("#alive-count").innerText());
  await page.locator("#cards button:not([disabled])").first().click();
  await page.waitForTimeout(400);
  check("le canon rejoint le rail", (await page.locator(".rail-token").count()) >= 1);
  check("un slot est occupe", (await page.locator('#slots > div[data-filled="true"]').count()) >= 1);

  await page.waitForTimeout(5000);
  const after = digits(await page.locator("#alive-count").innerText());
  check("des pixels sont reellement detruits", after < before, `${before} → ${after}`);

  console.log("\n— plusieurs canons —");
  let launches = 1;
  for (let i = 0; i < 5; i++) {
    const button = page.locator("#cards button:not([disabled])").first();
    if ((await button.count()) === 0) break;
    await button.click();
    launches++;
    await page.waitForTimeout(120);
  }
  const rail = await page.locator(".rail-token").count();
  check("plusieurs canons tournent ensemble", rail > 1, `${rail} canons`);
  check("le rail refuse un sixieme canon", rail <= 5, `${rail} canons`);

  await page.waitForTimeout(6000);

  // The rule the whole design rests on, measured end to end: every block that
  // disappeared cost one round, so the total can never exceed the rounds ever
  // committed to the rail.
  const destroyedTotal = before - digits(await page.locator("#alive-count").innerText());
  const roundsCommitted = launches * 40;
  check(
    "un tir ne detruit jamais plus d'un bloc",
    destroyedTotal <= roundsCommitted,
    `${destroyedTotal} blocs pour ${roundsCommitted} billes engagees`,
  );

  console.log("\n— camera —");
  const zoomStart = await page.locator("#zoom-level").innerText();
  await page.locator("#zoom-in").click();
  await page.waitForTimeout(150);
  const zoomIn = await page.locator("#zoom-level").innerText();
  check("le zoom repond", zoomIn !== zoomStart, `${zoomStart} → ${zoomIn}`);

  await page.locator("#zoom-fit").click();
  await page.waitForTimeout(150);
  check("la vue d'ensemble recadre", (await page.locator("#zoom-level").innerText()) !== zoomIn);

  await page.locator("#pause").click();
  await page.waitForTimeout(150);
  const perf = await perfPanel(page);
  table(perf);
  check("la simulation reste sous 4 ms/frame", parseFloat(perf["Simulation"]) < 4, perf["Simulation"]);

  console.log("\n— persistance et hors-ligne —");
  const beforeReload = digits(await page.locator("#alive-count").innerText());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#screen-game:not([hidden])", { timeout: 60000 });
  const afterReload = digits(await page.locator("#alive-count").innerText());
  check(
    "niveau restaure depuis IndexedDB",
    afterReload > 0 && afterReload <= beforeReload,
    `${beforeReload} → ${afterReload}`,
  );

  check("aucune erreur console", errors.length === 0, errors.join(" | "));

  await browser.close();
} finally {
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) failed.`);
process.exit(failures.length === 0 ? 0 : 1);

function digits(text) {
  return Number(text.replace(/[^\d]/g, "")) || 0;
}

/** First number of a "3 / 5" style readout. */
function firstNumber(text) {
  const match = text.replace(/\u202f|\u00a0/g, "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

async function perfPanel(page) {
  const lines = (await page.locator("#perf-list").innerText()).split("\n");
  const out = {};
  for (let i = 0; i + 1 < lines.length; i += 2) out[lines[i]] = lines[i + 1];
  return out;
}

function table(entries) {
  for (const [key, value] of Object.entries(entries)) {
    console.log(`        ${key.padEnd(22)} ${value}`);
  }
}

async function waitForServer(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`preview server did not start on ${url}`);
}
