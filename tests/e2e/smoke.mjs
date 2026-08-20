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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(URL, { waitUntil: "networkidle" });
  check("demarre sans mur de compatibilite", (await page.locator("h1", { hasText: "Incompatible" }).count()) === 0);

  console.log("\n— import —");
  await page.setInputFiles("#file-input", fixture);
  await page.waitForSelector("#hud:not([hidden])", { timeout: 60000 });

  // The board always holds 1 048 576 cells; a non-square image letterboxes, so
  // the *playable* count is lower — the margins are VOID, not missing.
  const playable = digits(await page.locator("#playable-count").innerText());
  check(
    "la silhouette jouable tient dans le million de cellules",
    playable > 0 && playable <= 1_048_576,
    `${playable} / 1 048 576`,
  );
  check("palette detectee", (await page.locator("#color-table tbody tr").count()) > 0);
  check("file de canons remplie", (await page.locator("#queue-list .load").count()) > 0);

  console.log("\n— un canon —");
  const before = digits(await page.locator("#alive-count").innerText());
  await page.locator("#queue-list .load button").first().click();
  await page.waitForTimeout(400);
  check("le canon rejoint le rail", firstNumber(await page.locator("#rail-count").innerText()) >= 1);

  await page.waitForTimeout(5000);
  const after = digits(await page.locator("#alive-count").innerText());
  check("des pixels sont reellement detruits", after < before, `${before} → ${after}`);

  const single = await perf(page);
  table(single);

  console.log("\n— plusieurs canons —");
  let launches = 0;
  for (let i = 0; i < 5; i++) {
    const button = page.locator("#queue-list .load button:not([disabled])").first();
    if ((await button.count()) === 0) break;
    await button.click();
    launches++;
    await page.waitForTimeout(120);
  }
  const rail = firstNumber(await page.locator("#rail-count").innerText());
  check("plusieurs canons tournent ensemble", rail > 1, `${rail} canons`);
  check("le rail refuse un sixieme canon", rail <= 5, `${rail} canons`);

  await page.waitForTimeout(6000);
  const loaded = await perf(page);
  table(loaded);

  // The rule the whole design rests on, measured end to end: every block that
  // disappeared cost one round, so the total can never exceed the rounds ever
  // committed to the rail. A per-second readout cannot show this — balls fired
  // in one sampling window land in the next — so it is checked cumulatively.
  const destroyedTotal = before - digits(await page.locator("#alive-count").innerText());
  const roundsCommitted = (launches + 1) * 40;
  check(
    "un tir ne detruit jamais plus d'un bloc",
    destroyedTotal <= roundsCommitted,
    `${destroyedTotal} blocs pour ${roundsCommitted} billes engagees`,
  );
  check("la simulation reste sous 4 ms/frame", parseFloat(loaded["Simulation"]) < 4, loaded["Simulation"]);
  check("les canons vides quittent le rail", firstNumber(await page.locator("#rail-count").innerText()) <= rail);

  console.log("\n— persistance et hors-ligne —");
  const beforeReload = digits(await page.locator("#alive-count").innerText());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#hud:not([hidden])", { timeout: 60000 });
  const afterReload = digits(await page.locator("#alive-count").innerText());
  check("niveau restaure depuis IndexedDB", afterReload > 0 && afterReload <= beforeReload, `${beforeReload} → ${afterReload}`);

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

async function perf(page) {
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
