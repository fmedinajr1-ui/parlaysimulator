// Admin monitoring digest for MLB Fair-Price v1.
//   ?mode=pulse  (default) — 5-min window, fired by 1-min cron. Includes outage detection.
//   ?mode=daily              — 24h + 7d rollup for once-daily admin summary.
//   &force=1                 — bypass the quiet-window skip (always send).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildFairPriceAdminPayload } from "../_shared/mlb-fair-price/alert-payload.ts";
import { etDateShort } from "../_shared/date-et.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Row {
  gate_decision: string;
  skip_reason: string | null;
  telegram_sent: boolean;
  edge: number | null;
  ev_pct: number | null;
  realized_hit: boolean | null;
  outcome_attached_at: string | null;
  closing_attached_at: string | null;
  clv_pct: number | null;
  feed_ts: number | null;
  book_last_move_ts: number | null;
}

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return ((n / d) * 100).toFixed(1) + "%";
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[i];
}

function summarize(rows: Row[], label: string): string {
  const total = rows.length;
  const fires = rows.filter((r) => r.gate_decision === "fire");
  const sent = fires.filter((r) => r.telegram_sent).length;
  const resolved = fires.filter((r) => r.outcome_attached_at && r.realized_hit !== null);
  const hits = resolved.filter((r) => r.realized_hit).length;
  const avgEdge = fires.length
    ? (fires.reduce((s, r) => s + (r.edge ?? 0), 0) / fires.length * 100).toFixed(2) + "%"
    : "—";
  const avgEv = fires.length
    ? (fires.reduce((s, r) => s + (r.ev_pct ?? 0), 0) / fires.length * 100).toFixed(2) + "%"
    : "—";

  const clvFires = fires.filter((r) => r.clv_pct != null) as (Row & { clv_pct: number })[];
  const avgClv = clvFires.length
    ? (clvFires.reduce((s, r) => s + r.clv_pct, 0) / clvFires.length * 100).toFixed(2) + "%"
    : "—";
  const posClv = clvFires.length
    ? pct(clvFires.filter((r) => r.clv_pct > 0).length, clvFires.length)
    : "—";
  const missingClosing = fires.filter((r) => r.outcome_attached_at && !r.closing_attached_at).length;

  const skips: Record<string, number> = {};
  for (const r of rows) {
    if (r.gate_decision === "skip" && r.skip_reason) {
      skips[r.skip_reason] = (skips[r.skip_reason] ?? 0) + 1;
    }
  }
  const skipLines = Object.entries(skips)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `   • \`${k}\`: ${v}`)
    .join("\n");

  return [
    `*${label}*`,
    `Evaluations: ${total} · FIRE: ${fires.length} · SKIP: ${total - fires.length}`,
    `Fill rate (sent/fire): ${pct(sent, fires.length)}`,
    `Realized hit rate: ${pct(hits, resolved.length)} (${resolved.length} resolved)`,
    `Avg edge: ${avgEdge} · Avg EV: ${avgEv}`,
    `CLV: avg ${avgClv} · positive ${posClv} (${clvFires.length} graded)`,
    `Closing line missing on ${missingClosing} resolved fires`,
    skipLines ? `Top skip reasons:\n${skipLines}` : "",
  ].filter(Boolean).join("\n");
}

async function sendAdmin(message: string) {
  const res = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/bot-send-telegram`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify(buildFairPriceAdminPayload(message)),
    },
  );
  return await res.json().catch(() => ({}));
}

async function runDaily(supabase: ReturnType<typeof createClient>) {
  const since24 = new Date(Date.now() - 24 * 3600_000).toISOString();
  const since7d = new Date(Date.now() - 7 * 86400_000).toISOString();

  const { data, error } = await supabase
    .from("mlb_fair_price_events")
    .select("gate_decision, skip_reason, telegram_sent, edge, ev_pct, realized_hit, outcome_attached_at, closing_attached_at, clv_pct, feed_ts, book_last_move_ts, created_at")
    .gte("created_at", since7d);

  if (error) throw new Error(error.message);

  const rows7d = (data ?? []) as (Row & { created_at: string })[];
  const rows24 = rows7d.filter((r) => r.created_at >= since24);

  const body = [
    `📊 *MLB Fair-Price v1 — Daily Digest*`,
    `_${etDateShort()} · measurement mode (WARN-only, uncalibrated WP)_`,
    ``,
    summarize(rows24, "Last 24h"),
    ``,
    summarize(rows7d, "Last 7d"),
    ``,
    `_Goal: ≥2 weeks of FIRE events with attached outcomes before refitting WP coefficients._`,
  ].join("\n");

  const telegram = await sendAdmin(body);
  return { mode: "daily", rows_24h: rows24.length, rows_7d: rows7d.length, telegram };
}

async function runPulse(supabase: ReturnType<typeof createClient>, force: boolean) {
  const WINDOW_MIN = 5;
  const sinceISO = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();

  const [evRes, lagRes, snapRes] = await Promise.all([
    supabase
      .from("mlb_fair_price_events")
      .select("gate_decision, skip_reason, telegram_sent, edge, ev_pct, realized_hit, outcome_attached_at, closing_attached_at, clv_pct, feed_ts, book_last_move_ts, created_at")
      .gte("created_at", sinceISO),
    supabase
      .from("lag_edges")
      .select("excess_lag_seconds, created_at")
      .gte("created_at", sinceISO),
    supabase
      .from("book_snapshot")
      .select("captured_at", { count: "exact", head: false })
      .gte("captured_at", sinceISO)
      .limit(1),
  ]);

  const rows = (evRes.data ?? []) as Row[];
  const lags = (lagRes.data ?? []) as { excess_lag_seconds: number | null }[];
  const bookSnapshotCount = snapRes.count ?? (snapRes.data?.length ?? 0);

  const evals = rows.length;
  const fires = rows.filter((r) => r.gate_decision === "fire");
  const skips = rows.filter((r) => r.gate_decision === "skip");
  const sent = fires.filter((r) => r.telegram_sent).length;

  const skipCounts: Record<string, number> = {};
  for (const r of skips) {
    if (r.skip_reason) skipCounts[r.skip_reason] = (skipCounts[r.skip_reason] ?? 0) + 1;
  }
  const topSkips = Object.entries(skipCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const noBookCount = skipCounts["no_book_or_suspended"] ?? 0;

  const fireLags = fires
    .map((r) => (r.feed_ts != null && r.book_last_move_ts != null ? (r.feed_ts as number) - (r.book_last_move_ts as number) : null))
    .filter((n): n is number => n != null && Number.isFinite(n))
    .sort((a, b) => a - b);
  const lagSecs = lags
    .map((r) => r.excess_lag_seconds)
    .filter((n): n is number => n != null && Number.isFinite(n))
    .sort((a, b) => a - b);

  // Outage detection: in the window, either snapshot table got zero rows OR
  // ≥90% of skips were no_book_or_suspended (with a meaningful sample).
  const skipDominatedByNoBook = skips.length >= 5 && noBookCount / Math.max(1, skips.length) >= 0.9;
  const outage = bookSnapshotCount === 0 && (evals > 0 || skipDominatedByNoBook);
  const fullOutage = outage || skipDominatedByNoBook;

  // Quiet rule: skip if no activity AND no outage AND not forced.
  if (!force && evals === 0 && lagSecs.length === 0 && !fullOutage) {
    return { mode: "pulse", skipped: "quiet_window", evals, lag_edges: 0, book_snapshot_count: bookSnapshotCount };
  }

  // Outage debounce via admin_alert_state.
  const alertKey = "mlb_fair_price.book_snapshot";
  const prevState = await supabase
    .from("admin_alert_state")
    .select("status, last_sent_at")
    .eq("alert_key", alertKey)
    .maybeSingle();
  const prev = prevState.data as { status: string; last_sent_at: string } | null;
  const currentStatus = fullOutage ? "down" : "healthy";
  const minutesSinceSent = prev ? (Date.now() - new Date(prev.last_sent_at).getTime()) / 60_000 : Infinity;

  let banner = "";
  let stateChanged = false;
  if (fullOutage) {
    if (!prev || prev.status !== "down" || minutesSinceSent >= 15) {
      banner = `🚨 *BOOK FEED DOWN* — 0 book_snapshot rows in last ${WINDOW_MIN}m; ${noBookCount}/${skips.length} skips = no_book_or_suspended\n`;
      stateChanged = true;
    }
  } else if (prev?.status === "down") {
    banner = `✅ *BOOK FEED RECOVERED* — book_snapshot writing again (${bookSnapshotCount} rows in last ${WINDOW_MIN}m)\n`;
    stateChanged = true;
  }

  const lines = [
    `📡 *MLB Fair-Price Pulse* · _${etDateShort()} · last ${WINDOW_MIN}m_`,
    banner,
    `Evals: ${evals} · FIRE: ${fires.length} · sent: ${sent} · skips: ${skips.length}`,
    `book_snapshot rows: ${bookSnapshotCount}`,
    fireLags.length
      ? `Fire lag (ms): p50 ${quantile(fireLags, 0.5)} · p90 ${quantile(fireLags, 0.9)} · n=${fireLags.length}`
      : `Fire lag: — (no real-book fires)`,
    lagSecs.length
      ? `lag_edges: ${lagSecs.length} · p50 ${quantile(lagSecs, 0.5)?.toFixed(1)}s · p90 ${quantile(lagSecs, 0.9)?.toFixed(1)}s`
      : `lag_edges: 0`,
    topSkips.length ? `Top skips: ${topSkips.map(([k, v]) => `\`${k}\`(${v})`).join(" · ")}` : "",
    force ? `\n_(manual test ping)_` : "",
  ].filter(Boolean);

  const telegram = await sendAdmin(lines.join("\n"));

  if (stateChanged) {
    await supabase.from("admin_alert_state").upsert({
      alert_key: alertKey,
      status: currentStatus,
      last_sent_at: new Date().toISOString(),
      payload: { evals, skips: skips.length, no_book: noBookCount, book_snapshot_count: bookSnapshotCount },
      updated_at: new Date().toISOString(),
    }, { onConflict: "alert_key" });
  }

  return {
    mode: "pulse",
    evals,
    fires: fires.length,
    skips: skips.length,
    lag_edges: lagSecs.length,
    book_snapshot_count: bookSnapshotCount,
    outage: fullOutage,
    state_changed: stateChanged,
    telegram,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // MLB Fair-Price v1 is SHUT DOWN. Digest disabled — return ok no-op so
  // any lingering cron entry doesn't error.
  return new Response(JSON.stringify({ ok: true, disabled: true, reason: "mlb_fair_price_shutdown" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  // eslint-disable-next-line no-unreachable

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = new URL(req.url);
  const mode = (url.searchParams.get("mode") || "pulse").toLowerCase();
  const force = url.searchParams.get("force") === "1";

  try {
    const result = mode === "daily" ? await runDaily(supabase) : await runPulse(supabase, force);
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});