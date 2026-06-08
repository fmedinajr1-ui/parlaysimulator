// Hard Rock Bet MLB moneyline scraper — runs on same VPS as fanduel-worker
// but on port 8081. Bridge edge function calls POST /scrape-hardrock-mlb-ml
// every 30s.

import express from "express";
import { scrapeMlbMoneylines, shutdown } from "./hardrock-client.js";

const PORT = parseInt(process.env.PORT ?? "8081", 10);
const SECRET = process.env.WORKER_SECRET ?? "";

if (!SECRET) {
  console.warn("[hardrock-worker] WORKER_SECRET not set — refusing all requests");
}

const app = express();
app.use(express.json({ limit: "256kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.post("/scrape-hardrock-mlb-ml", async (req, res) => {
  const auth = req.header("authorization") ?? "";
  if (!SECRET || auth !== `Bearer ${SECRET}`) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  const t0 = Date.now();
  try {
    const events = await scrapeMlbMoneylines();
    const ms = Date.now() - t0;
    console.log(`[hardrock-worker] scraped ${events.length} MLB games in ${ms}ms`);
    res.json({ ok: true, ms, events });
  } catch (e) {
    const ms = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[hardrock-worker] scrape failed in ${ms}ms: ${msg}`);
    res.status(502).json({ ok: false, ms, error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`[hardrock-worker] listening on :${PORT}`);
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    console.log(`[hardrock-worker] ${sig} received, closing`);
    await shutdown();
    process.exit(0);
  });
}