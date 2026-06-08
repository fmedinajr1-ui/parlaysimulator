// Hard Rock Bet login + MLB moneyline scraper.
//
// HR has no public odds API and geo-locks to specific US states. Strategy:
//   1. Use a real Chromium (Playwright + stealth) to log in once with
//      HARDROCK_USER / HARDROCK_PASS and capture session cookies.
//   2. Reuse those cookies for cheap fetch() calls to HR's internal JSON
//      odds endpoint (reverse-engineered from devtools — see HR_ODDS_URL).
//   3. On 401/403, re-login once and retry.

import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

const HR_LOGIN_URL = "https://app.hardrock.bet/";
// Reverse-engineered from devtools. HR uses a Kambi-style betoffer endpoint.
const HR_ODDS_URL =
  "https://eu-offering-api.kambicdn.com/offering/v2018/hrcza/listView/baseball/mlb.json?lang=en_US&market=US&includeParticipants=true";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

let browserPromise = null;
let context = null;
let cookiesReady = false;
let lastLoginAt = 0;
const LOGIN_TTL_MS = 30 * 60 * 1000;

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

async function ensureContext() {
  if (context && Date.now() - lastLoginAt < LOGIN_TTL_MS && cookiesReady) return context;
  if (context) {
    await context.close().catch(() => {});
    context = null;
    cookiesReady = false;
  }
  const browser = await getBrowser();
  context = await browser.newContext({
    userAgent: UA,
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1366, height: 900 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  await loginIfPossible(context);
  cookiesReady = true;
  lastLoginAt = Date.now();
  return context;
}

async function loginIfPossible(ctx) {
  const user = process.env.HARDROCK_USER;
  const pass = process.env.HARDROCK_PASS;
  if (!user || !pass) {
    console.warn("[hardrock] HARDROCK_USER/PASS not set — trying anonymous");
    return;
  }
  const page = await ctx.newPage();
  try {
    await page.goto(HR_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);
    const loginBtn = await page.$('button:has-text("Log in"), a:has-text("Log in")');
    if (loginBtn) await loginBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
    const emailInput = await page.$('input[type="email"], input[name="username"], input[name="email"]');
    const passInput = await page.$('input[type="password"]');
    if (emailInput && passInput) {
      await emailInput.fill(user);
      await passInput.fill(pass);
      const submit = await page.$('button[type="submit"], button:has-text("Log in")');
      if (submit) await submit.click().catch(() => {});
      await page.waitForTimeout(6000);
    } else {
      console.warn("[hardrock] login form not detected — continuing with guest cookies");
    }
  } catch (e) {
    console.warn("[hardrock] login flow threw:", e?.message ?? e);
  } finally {
    await page.close().catch(() => {});
  }
}

async function fetchOddsJson() {
  const ctx = await ensureContext();
  const page = await ctx.newPage();
  try {
    const res = await page.request.get(HR_ODDS_URL, {
      headers: { Accept: "application/json", "User-Agent": UA },
      timeout: 15000,
    });
    const status = res.status();
    if (status === 401 || status === 403) throw new Error(`hr_auth_${status}`);
    if (status >= 400) throw new Error(`hr_http_${status}`);
    return await res.json();
  } finally {
    await page.close().catch(() => {});
  }
}

export async function scrapeMlbMoneylines() {
  let json;
  try {
    json = await fetchOddsJson();
  } catch (e) {
    if (String(e.message).startsWith("hr_auth_")) {
      cookiesReady = false;
      json = await fetchOddsJson();
    } else {
      throw e;
    }
  }

  const out = [];
  const events = json?.events ?? [];
  for (const wrap of events) {
    const event = wrap.event;
    const offers = wrap.betOffers ?? [];
    if (!event || !offers.length) continue;
    const ml = offers.find((o) =>
      Array.isArray(o.outcomes) &&
      o.outcomes.length === 2 &&
      o.outcomes.every((x) => x.type === "OT_ONE" || x.type === "OT_TWO") &&
      (o.criterion?.label?.toLowerCase().includes("money") ||
        o.betOfferType?.englishName?.toLowerCase().includes("match"))
    );
    if (!ml) continue;

    const homeName = event.homeName;
    const awayName = event.awayName;
    if (!homeName || !awayName) continue;

    const homeOut = ml.outcomes.find((o) => o.participant === homeName);
    const awayOut = ml.outcomes.find((o) => o.participant === awayName);
    if (!homeOut || !awayOut) continue;

    // Kambi prices: milli-decimal (1500 => 1.5 decimal).
    const homePrice = decimalToAmerican(homeOut.odds / 1000);
    const awayPrice = decimalToAmerican(awayOut.odds / 1000);
    if (homePrice == null || awayPrice == null) continue;

    out.push({
      event_id: String(event.id),
      start_time: event.start,
      home_team: homeName,
      away_team: awayName,
      home_price: homePrice,
      away_price: awayPrice,
      captured_at: new Date().toISOString(),
    });
  }
  return out;
}

function decimalToAmerican(dec) {
  if (!Number.isFinite(dec) || dec <= 1) return null;
  if (dec >= 2) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}

export async function shutdown() {
  try {
    await context?.close();
    const b = await browserPromise;
    await b?.close();
  } catch {}
}