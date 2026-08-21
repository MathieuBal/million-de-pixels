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
  // A lone cannon may legitimately destroy nothing: a ball stops at the first
  // solid cell, so a colour buried behind another has no shot until the facade
  // is gone. What must never happen is pixels coming back.
  check("aucun pixel ne reapparait", after <= before, `${before} → ${after}`);

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
  // With a rail full of colours, at least one of them faces the board.
  check("le rail entame l'image", destroyedTotal > 0, `${destroyedTotal} blocs`);

  console.log("\n— camera —");
  const zoomStart = await page.locator("#zoom-level").innerText();
  await page.locator("#zoom-in").click();
  await page.waitForTimeout(150);
  const zoomIn = await page.locator("#zoom-level").innerText();
  check("le zoom repond", zoomIn !== zoomStart, `${zoomStart} → ${zoomIn}`);

  await page.locator("#zoom-fit").click();
  await page.waitForTimeout(150);
  check("la vue d'ensemble recadre", (await page.locator("#zoom-level").innerText()) !== zoomIn);

  // The debug panel has its own shortcut; the pause button opens the upgrades.
  await page.keyboard.press("Alt+d");
  await page.waitForTimeout(600);
  const perf = await perfPanel(page);
  table(perf);
  check("la simulation reste sous 4 ms/frame", parseFloat(perf["Simulation"]) < 4, perf["Simulation"]);
  await page.keyboard.press("Alt+d");
  await page.waitForTimeout(100);

  console.log("\n— ameliorations —");
  // Bank fragments first: the shop is funded by destruction, so it needs the
  // rail to have actually been working.
  await page.waitForTimeout(12000);

  await page.locator("#pause").click();
  await page.waitForSelector("#upgrade-panel:not([hidden])", { timeout: 10000 });
  check("le panneau liste les quatre axes", (await page.locator(".upgrade-row").count()) === 4);

  const balanceBefore = digits(await page.locator("#upgrade-balance").innerText());
  check("les pixels detruits financent les achats", balanceBefore > 0, `${balanceBefore} fragments`);

  const cheapest = Math.min(
    ...(await page.locator(".upgrade-row .price").allInnerTexts())
      .map(digits)
      .filter((n) => n > 0),
  );
  check(
    "la premiere amelioration est atteignable",
    balanceBefore >= cheapest,
    `${balanceBefore} fragments pour ${cheapest} demandes`,
  );

  const affordable = page.locator(".upgrade-row .price:not([disabled])").first();
  if ((await affordable.count()) > 0) {
    const price = digits(await affordable.innerText());
    await affordable.click();
    await page.waitForTimeout(200);
    const balanceAfter = digits(await page.locator("#upgrade-balance").innerText());
    // Fragments keep coming in while the rail works, so the balance can only be
    // bounded, never predicted exactly.
    check(
      "un achat debite le solde",
      balanceAfter < balanceBefore && balanceAfter >= balanceBefore - price,
      `${balanceBefore} − ${price} → ${balanceAfter}`,
    );
  } else {
    check("un achat debite le solde", false, "aucune amelioration abordable");
  }

  // Does buying actually move the game? Measured, not assumed.
  await page.keyboard.press("Alt+d");
  await page.waitForTimeout(600);
  const rateBefore = digits((await perfPanel(page))["Blocs/s"]);
  await page.keyboard.press("Alt+d");

  let bought = 0;
  for (let i = 0; i < 12; i++) {
    const next = page.locator(".upgrade-row .price:not([disabled])").first();
    if ((await next.count()) === 0) break;
    await next.click();
    bought++;
    await page.waitForTimeout(120);
  }

  await page.locator("#upgrade-close").click();
  await page.waitForTimeout(200);
  check("le panneau se referme", await page.locator("#upgrade-panel").isHidden());

  // Refill the rail: cannons spend their stock and leave, so an idle rail would
  // measure nothing at all.
  for (let i = 0; i < 8; i++) {
    const card = page.locator("#cards button:not([disabled])").first();
    if ((await card.count()) === 0) break;
    await card.click();
    await page.waitForTimeout(100);
  }

  await page.waitForTimeout(6000);
  await page.keyboard.press("Alt+d");
  await page.waitForTimeout(600);
  const rateAfter = digits((await perfPanel(page))["Blocs/s"]);
  await page.keyboard.press("Alt+d");
  console.log(`        ${bought} ameliorations achetees · ${rateBefore} → ${rateAfter} blocs/s`);

  console.log("\n— persistance et hors-ligne —");
  // Wait for the rail to go quiet, then for one autosave window on top of it.
  // The save is throttled, so reading the live counter while blocks are still
  // falling compares a live number against a snapshot taken up to ten seconds
  // earlier — that used to pass only because destruction was thirty-six times
  // slower, not because the two were ever equal.
  let stable = 0;
  let previous = -1;
  while (stable < 5) {
    const alive = digits(await page.locator("#alive-count").innerText());
    stable = alive === previous ? stable + 1 : 0;
    previous = alive;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(11000); // AUTOSAVE_INTERVAL_MS + margin

  const beforeReload = digits(await page.locator("#alive-count").innerText());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#screen-game:not([hidden])", { timeout: 60000 });
  const afterReload = digits(await page.locator("#alive-count").innerText());
  check(
    "niveau restaure depuis IndexedDB",
    afterReload > 0 && afterReload <= beforeReload,
    `${beforeReload} → ${afterReload}`,
  );

  await page.locator("#pause").click();
  await page.waitForSelector("#upgrade-panel:not([hidden])", { timeout: 10000 });
  const levels = await page.locator(".upgrade-row .name").allInnerTexts();
  check(
    "les ameliorations survivent au rechargement",
    levels.some((text) => !text.includes("niv. 0")),
    levels.filter((t) => !t.includes("niv. 0")).join(", ") || "toutes a zero",
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
