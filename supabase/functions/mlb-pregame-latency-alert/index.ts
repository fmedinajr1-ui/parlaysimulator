// Pre-game MLB latency alerts (admin-only).
// Cron every 1 min. For each MLB game today:
//   - Fires once at T-30m and once at T-5m (deduped via mlb_pregame_alert_log).
// Alert includes: matchup + first pitch, books currently missing, per-book
// latency table (Hard Rock / FanDuel / DraftKings pinned), top delay catches 24h.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PINNED = ["fanduel", "draftkings"];
const KNOWN_BOOKS = [
  "fanduel", "draftkings", "betmgm", "caesars",
  "espnbet", "fanatics", "betrivers", "pinnacle",
];
const STALE_MS = 5000;

function etDateKey(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
}
function etTime(at: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(at);
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function pad(s: string, n: number) { return (s + " ".repeat(n)).slice(0, n); }

function labelBook(b: string) {
  const map: Record<string, string> = {
    fanduel: "FanDuel", draftkings: "DraftKings",
    betmgm: "BetMGM", caesars: "Caesars", espnbet: "ESPNBet",
    fanatics: "Fanatics", betrivers: "BetRivers", pinnacle: "Pinnacle",
  };
  return map[b?.toLowerCase?.()] ?? (b ?? "unknown");
}

interface FpRow {
  game_id: string | null;
  book_id: string | null;
  event_time: string;
  feed_ts: number | null;
}

async function buildGameSection(
  supabase: any,
  gamePk: number,
  away: string,
  home: string,
  startIso: string,
  kind: "30m" | "5m",
) {
  const gameId = `mlb_${gamePk}`;
  const since6h = new Date(Date.now() - 6 * 3600_000).toISOString();

  const { data: gameRows } = await supabase
    .from("mlb_fair_price_events")
    .select("book_id, event_time, feed_ts")
    .eq("game_id", gameId)
    .gte("created_at", since6h);

  const seenBooks = new Set<string>(
    ((gameRows ?? []) as FpRow[])
      .map((r) => (r.book_id || "").toLowerCase())
      .filter(Boolean),
  );
  const missing = KNOWN_BOOKS.filter((b) => !seenBooks.has(b));

  const start = new Date(startIso);
  const kindLabel = kind === "30m" ? "T-30m" : "T-5m";

  const lines = [
    `⚾ <b>Pre-game · ${kindLabel}</b>`,
    `${away} @ ${home} — ${etTime(start)} ET`,
    "",
    `Missing books (${missing.length}): ${missing.length ? missing.map(labelBook).join(", ") : "none"}`,
  ];

  return { gameId, lines, gameRows: (gameRows ?? []) as FpRow[] };
}

function lagMs(r: FpRow): number | null {
  if (!r.feed_ts || !r.event_time) return null;
  const ev = new Date(r.event_time).getTime();
  const ft = Number(r.feed_ts);
  const lag = ev - ft;
  return isFinite(lag) ? lag : null;
}

function buildLatencyTable(rows: FpRow[]): string {
  const byBook: Record<string, number[]> = {};
  for (const r of rows) {
    const lag = lagMs(r);
    if (lag == null || lag < 0) continue;
    const b = (r.book_id || "unknown").toLowerCase();
    (byBook[b] ??= []).push(lag);
  }
  const books = Object.keys(byBook);
  if (!books.length) return "Latency (24h): no book-tagged events yet.";
  const ranked = books.sort((a, b) => {
    const pa = PINNED.indexOf(a), pb = PINNED.indexOf(b);
    if (pa !== -1 || pb !== -1) {
      if (pa === -1) return 1;
      if (pb === -1) return -1;
      return pa - pb;
    }
    return median(byBook[b]) - median(byBook[a]);
  });
  const header = `${pad("Book", 12)}${pad("med", 7)}${pad("n", 5)}stale%`;
  const body = ranked.map((b) => {
    const arr = byBook[b];
    const med = median(arr);
    const stale = arr.filter((x) => x >= STALE_MS).length;
    const stalePct = Math.round((stale / arr.length) * 100);
    return `${pad(labelBook(b), 12)}${pad(med + "ms", 7)}${pad(String(arr.length), 5)}${stalePct}%`;
  }).join("\n");
  return `<pre>Latency (24h)\n${header}\n${body}</pre>`;
}

function buildTopDelays(rows: FpRow[]): string {
  const scored = rows
    .map((r) => ({ r, lag: lagMs(r) ?? 0 }))
    .filter((x) => x.lag >= STALE_MS)
    .sort((a, b) => b.lag - a.lag)
    .slice(0, 5);
  if (!scored.length) return "Top delay catches (24h): none ≥ 5s.";
  return [
    "<b>Top delay catches (24h)</b>",
    ...scored.map((x, i) =>
      `${i + 1}. ${(x.lag / 1000).toFixed(1)}s — ${labelBook(x.r.book_id || "unknown")} — ${x.r.game_id ?? ""}`
    ),
  ].join("\n");
}

async function sendAdminTelegram(message: string) {
  const res = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/bot-send-telegram`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        message,
        parse_mode: "HTML",
        admin_only: true,
        type: "mlb_pregame_latency",
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";
  const forcePk = url.searchParams.get("game_pk");
  const forceKind = (url.searchParams.get("kind") as "30m" | "5m" | null) ?? null;

  // 1. Today's MLB slate (ET).
  const date = etDateKey();
  let slate: any[] = [];
  try {
    const r = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`);
    const j = await r.json();
    slate = (j?.dates?.[0]?.games ?? []).map((g: any) => ({
      gamePk: g.gamePk,
      gameDate: g.gameDate,
      status: g.status?.abstractGameState,
      away: g.teams?.away?.team?.name,
      home: g.teams?.home?.team?.name,
    }));
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: `slate fetch failed: ${e}` }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Last-24h fair-price events (for global latency table + top delays).
  const since24 = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { data: all24 } = await supabase
    .from("mlb_fair_price_events")
    .select("game_id, book_id, event_time, feed_ts")
    .gte("created_at", since24)
    .limit(5000);
  const allRows = (all24 ?? []) as FpRow[];

  // 3. Existing sent log for today.
  const { data: sentLog } = await supabase
    .from("mlb_pregame_alert_log")
    .select("game_pk, kind")
    .gte("sent_at", new Date(Date.now() - 18 * 3600_000).toISOString());
  const sentSet = new Set((sentLog ?? []).map((r: any) => `${r.game_pk}:${r.kind}`));

  const now = Date.now();
  const sent: any[] = [];

  for (const g of slate) {
    if (!g.gameDate || !g.gamePk) continue;
    if (g.status === "Final" || g.status === "Live") continue;
    const startMs = new Date(g.gameDate).getTime();
    const minsAway = Math.round((startMs - now) / 60000);

    const candidates: ("30m" | "5m")[] = [];
    if (forcePk && Number(forcePk) === g.gamePk && forceKind) {
      candidates.push(forceKind);
    } else {
      if (minsAway >= 29 && minsAway <= 31) candidates.push("30m");
      if (minsAway >= 4 && minsAway <= 6) candidates.push("5m");
    }

    for (const kind of candidates) {
      const key = `${g.gamePk}:${kind}`;
      if (sentSet.has(key)) continue;

      const sec = await buildGameSection(
        supabase, g.gamePk, g.away, g.home, g.gameDate, kind,
      );
      const message = [
        ...sec.lines,
        "",
        buildLatencyTable(allRows),
        "",
        buildTopDelays(allRows),
      ].join("\n");

      let tg: any = { skipped: true };
      if (!dryRun) {
        tg = await sendAdminTelegram(message);
        if (tg.ok) {
          await supabase.from("mlb_pregame_alert_log").upsert({
            game_pk: g.gamePk, kind, payload: { message },
          }, { onConflict: "game_pk,kind" });
        }
      }
      sent.push({ gamePk: g.gamePk, kind, minsAway, ok: tg.ok, dryRun, preview: dryRun ? message : undefined });
    }
  }

  return new Response(JSON.stringify({
    ok: true, date, slate: slate.length, evaluated: slate.length, sent,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});