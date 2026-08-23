/**
 * Note les toiles de campagne, en les faisant passer par le vrai pipeline.
 *
 * La difficulté ne se lit pas sur un fichier : elle sort de la quantification,
 * qui est un worker du navigateur. Une image de mille couleurs peut retomber
 * sur huit une fois quantifiée, et deux images qui se ressemblent peuvent
 * donner des plateaux très différents. Donc on importe pour de bon, on lit la
 * palette obtenue, et on demande au plateau intact quelles couleurs sont déjà
 * enterrées — c'est ce dernier point qui fait qu'une toile coince.
 *
 * Usage : npm run build && node tests/e2e/rate-campaign.mjs [sortie.json]
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT = 4191;
const URL = `http://localhost:${PORT}/`;
const ROOT = "/home/user/million-de-pixels";
const DIR = path.join(ROOT, "public/campagne");
const OUT = process.argv[2] ?? path.join(ROOT, "src/progression/campaign-ratings.json");

const server = spawn("npx", ["vite", "preview", "--port", String(PORT)], {
  stdio: "ignore", cwd: ROOT,
});

async function waitForServer(url) {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("le serveur n'est jamais venu");
}

const files = fs.readdirSync(DIR).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
const readings = [];

try {
  await waitForServer(URL);
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });

  for (const [i, file] of files.entries()) {
    // Un contexte neuf par image : une page réutilisée garde le profil, la
    // galerie et la partie précédente, et une toile mesurée avec les canons de
    // la précédente ne serait pas mesurée du tout.
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const page = await ctx.newPage();
    try {
      await page.goto(URL, { waitUntil: "networkidle" });
      await page.setInputFiles("#file-input", path.join(DIR, file));
      await page.waitForSelector("#start-run:not([disabled])", { timeout: 120000 });
      await page.locator("#start-run").click();
      await page.waitForSelector("#screen-game:not([hidden])", { timeout: 60000 });

      // Tout de suite : le rail commence à tirer, et « enterrée au départ » ne
      // veut dire quelque chose que sur un plateau encore intact.
      const reading = await page.evaluate(() => {
        const world = window.__game.getWorld();
        const reachable = world.reachableColors();
        const palette = world.palette.map((p) => ({
          share: p.share,
          rarity: p.rarity,
          reachable: reachable[p.id] === true,
        }));
        return {
          paletteSize: world.paletteSize,
          playablePixels: world.playablePixels,
          rareColors: palette.filter((p) => p.rarity === "rare" || p.rarity === "exotique").length,
          buriedAtStart: palette.filter((p) => !p.reachable).length,
          smallestShare: Math.min(...palette.map((p) => p.share)),
        };
      });

      readings.push({ file, ...reading });
      console.log(
        `${String(i + 1).padStart(2)}/${files.length} ${file} — ` +
        `${reading.paletteSize} couleurs · ${reading.rareColors} rares · ` +
        `${reading.buriedAtStart} enterrées · ${reading.playablePixels} px`,
      );
    } catch (error) {
      // Une image qui ne passe pas est un fait à garder, pas une exception à
      // avaler : elle ne doit simplement pas entrer dans la campagne.
      console.log(`${String(i + 1).padStart(2)}/${files.length} ${file} — ÉCHEC : ${error.message.split("\n")[0]}`);
      readings.push({ file, failed: true });
    }
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(readings, null, 2));
  console.log(`\n${readings.filter((r) => !r.failed).length}/${files.length} mesurées → ${OUT}`);
} finally {
  server.kill();
}
