// Shared headless Chromium with stealth. Reused across all scrape calls so
// HR session cookies persist and we avoid 12s cold-starts per request.
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(StealthPlugin());

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

let browserPromise = null;
let sharedContext = null;
let cookiesReady = false;
let lastLoginAt = 0;
const LOGIN_TTL_MS = 30 * 60 * 1000;

const HR_LOGIN_URL = "https://app.hardrock.bet/";

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

async function loginIfPossible(ctx) {
  const user = process.env.HARDROCK_USER;
  const pass = process.env.HARDROCK_PASS;
  if (!user || !pass) {
    console.warn("[hr] HARDROCK_USER/PASS not set — using anonymous session");
    return;
  }
  const page = await ctx.newPage();
  try {
    await page.goto(HR_LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);
    const loginBtn = await page.$('button:has-text("Log in"), a:has-text("Log in")');
    if (loginBtn) await loginBtn.click().catch(() => {});
    await page.waitForTimeout(1500);
    const email = await page.$('input[type="email"], input[name="username"], input[name="email"]');
    const pw = await page.$('input[type="password"]');
    if (email && pw) {
      await email.fill(user);
      await pw.fill(pass);
      const submit = await page.$('button[type="submit"], button:has-text("Log in")');
      if (submit) await submit.click().catch(() => {});
      await page.waitForTimeout(6000);
    } else {
      console.warn("[hr] login form not detected — continuing as guest");
    }
  } catch (e) {
    console.warn("[hr] login flow threw:", e?.message ?? e);
  } finally {
    await page.close().catch(() => {});
  }
}

export async function getContext() {
  if (sharedContext && cookiesReady && Date.now() - lastLoginAt < LOGIN_TTL_MS) {
    return sharedContext;
  }
  if (sharedContext) {
    await sharedContext.close().catch(() => {});
    sharedContext = null;
    cookiesReady = false;
  }
  const browser = await getBrowser();
  sharedContext = await browser.newContext({
    userAgent: UA,
    locale: "en-US",
    timezoneId: "America/New_York",
    viewport: { width: 1366, height: 900 },
  });
  await sharedContext.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  await loginIfPossible(sharedContext);
  cookiesReady = true;
  lastLoginAt = Date.now();
  return sharedContext;
}

export function invalidateSession() {
  cookiesReady = false;
}

export async function fetchJson(url, { timeout = 15000 } = {}) {
  const ctx = await getContext();
  const page = await ctx.newPage();
  try {
    const res = await page.request.get(url, {
      headers: { Accept: "application/json", "User-Agent": UA },
      timeout,
    });
    const status = res.status();
    if (status === 401 || status === 403) {
      invalidateSession();
      throw new Error(`hr_auth_${status}`);
    }
    if (status >= 400) throw new Error(`hr_http_${status}`);
    return await res.json();
  } finally {
    await page.close().catch(() => {});
  }
}

export async function shutdownBrowser() {
  try {
    await sharedContext?.close();
    const b = await browserPromise;
    await b?.close();
  } catch {}
}

export function decimalToAmerican(dec) {
  if (!Number.isFinite(dec) || dec <= 1) return null;
  if (dec >= 2) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}