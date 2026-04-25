// Self-hosted FanDuel stealth scraper.
// Runs Playwright + stealth plugin on a tiny VPS (Fly/Render/Hetzner ~$5/mo)
// and exposes a single POST /scrape endpoint that the Lovable Cloud edge
// function (`fanduel-boost-scanner`) calls. Bypasses Akamai by using a real
// headful-flavored Chromium with stealth evasions instead of the headless
// fingerprint that ScrapingAnt/ScrapingBee/Firecrawl all leak.

import express from "express";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const PORT = parseInt(process.env.PORT ?? "8080", 10);
const SECRET = process.env.WORKER_SECRET ?? "";

if (!SECRET) {
  console.warn("[worker] WORKER_SECRET not set — refusing all requests");
}

// Reuse a single browser across requests. Cold-starting Chromium per call
// is what makes stealth proxies expensive — keeping it warm cuts each scrape
// from ~12s to ~3s and lets us preserve cookies/session between /promos and
// /boosts (which is a small but real anti-bot signal).
let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
      ],
    });
  }
  return browserPromise;
}

const UA_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

async function scrapeUrl(url, { waitMs = 6000 } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: UA_DESKTOP,
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  // Strip the `webdriver` flag stealth missed in some Chromium builds.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const page = await context.newPage();
  try {
    const res = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    const status = res?.status() ?? 0;

    // Give SPA boost cards time to mount, then scroll to trigger lazy lists.
    await page.waitForTimeout(waitMs);
    try {
      await page.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        for (let y = 0; y < 4; y++) {
          window.scrollBy(0, window.innerHeight);
          await sleep(600);
        }
      });
    } catch {
      // Ignore — sometimes SPA navigations cancel the eval.
    }
    await page.waitForTimeout(1500);

    const html = await page.content();
    return { status, html };
  } finally {
    await context.close().catch(() => {});
  }
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.post("/scrape", async (req, res) => {
  const auth = req.header("authorization") ?? "";
  if (!SECRET || auth !== `Bearer ${SECRET}`) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const { url, waitMs } = req.body ?? {};
  if (typeof url !== "string" || !/^https:\/\/[^/]*fanduel\.com/.test(url)) {
    return res.status(400).json({ ok: false, error: "invalid url" });
  }

  const t0 = Date.now();
  try {
    const { status, html } = await scrapeUrl(url, { waitMs });
    const ms = Date.now() - t0;
    console.log(`[worker] ${url} -> ${status} in ${ms}ms (${html.length} bytes)`);
    if (status >= 400) {
      return res.status(502).json({ ok: false, status, ms, error: `upstream_${status}` });
    }
    res.json({ ok: true, status, ms, html });
  } catch (e) {
    const ms = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[worker] ${url} threw after ${ms}ms: ${msg}`);
    res.status(500).json({ ok: false, ms, error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`[worker] listening on :${PORT}`);
});

// Clean shutdown so Docker SIGTERM doesn't leave Chromium zombies.
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    console.log(`[worker] ${sig} received, closing browser`);
    try {
      const b = await browserPromise;
      await b?.close();
    } catch {}
    process.exit(0);
  });
}