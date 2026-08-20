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
import { quadrantsPng } from "../../scripts/makeFixturePng.mjs";

const PORT = 4173;
const URL = `http://localhost:${PORT}/`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? undefined;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pixel-idle-"));
const fixture = path.join(tmp, "quadrants.png");
fs.writeFileSync(fixture, quadrantsPng(256));

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
  check("boots without a compatibility wall", (await page.locator("h1", { hasText: "Incompatible" }).count()) === 0);

  console.log("\n— import —");
  await page.setInputFiles("#file-input", fixture);
  await page.waitForSelector("#hud:not([hidden])", { timeout: 60000 });

  const playable = digits(await page.locator("#playable-count").innerText());
  check("board holds one million cells", playable === 1_048_576, String(playable));
  check("palette rows rendered", (await page.locator("#color-table tbody tr").count()) > 0);
  check("deck generated", (await page.locator("#deck-list li").count()) > 0);

  console.log("\n— exact regime —");
  const before = digits(await page.locator("#alive-count").innerText());
  await page.waitForTimeout(5000);
  const after = digits(await page.locator("#alive-count").innerText());
  check("pixels are actually destroyed", after < before, `${before} → ${after}`);
  const exact = await perf(page);
  check("projectiles are individually simulated", Number(digits(exact["Projectiles actifs"])) > 0, exact["Projectiles actifs"]);
  table(exact);

  console.log("\n— aggregate regime —");
  for (let round = 0; round < 8; round++) {
    for (const button of await page.locator("#deck-list button").all()) await button.click();
  }
  await page.waitForTimeout(2000);

  let peakLogical = 0;
  let peakVisual = 0;
  for (let i = 0; i < 6; i++) {
    const p = await perf(page);
    peakLogical = Math.max(peakLogical, digits(p["Impacts logiques/s"]));
    peakVisual = Math.max(peakVisual, digits(p["Impacts visuels/s"]));
    await page.waitForTimeout(700);
  }
  const loaded = await perf(page);
  table(loaded);
  check("logical throughput exceeds 10k/s", peakLogical > 10_000, `${peakLogical}/s`);
  check("VFX stay within budget", peakVisual < 1500, `${peakVisual}/s`);
  check("VFX decoupled from logic", peakVisual < peakLogical / 5, `1 : ${Math.round(peakLogical / Math.max(1, peakVisual))}`);
  check("simulation stays under 4 ms/frame", parseFloat(loaded["Simulation"]) < 4, loaded["Simulation"]);

  console.log("\n— persistence & offline —");
  const beforeReload = digits(await page.locator("#alive-count").innerText());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#hud:not([hidden])", { timeout: 60000 });
  const afterReload = digits(await page.locator("#alive-count").innerText());
  check("level restored from IndexedDB", afterReload > 0 && afterReload <= beforeReload, `${beforeReload} → ${afterReload}`);

  check("no console errors", errors.length === 0, errors.join(" | "));

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
