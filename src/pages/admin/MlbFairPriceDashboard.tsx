import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { Activity, Flame, RefreshCw, Search } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid,
} from "recharts";

type Event = {
  id: string;
  game_id: string;
  event_type: string | null;
  event_time: string | null;
  created_at: string;
  pre_state: any;
  post_state: any;
  wp_pre: number | null;
  wp_post: number | null;
  delta_wp: number | null;
  market: string | null;
  book_id: string | null;
  book_implied: number | null;
  book_implied_devig: number | null;
  book_last_move_ts: number | null;
  feed_ts: number | null;
  edge: number | null;
  ev_pct: number | null;
  ttl_ms: number | null;
  gate_decision: string | null;
  skip_reason: string | null;
  severity: string | null;
  telegram_sent: boolean | null;
  side: string | null;
  book_price: number | null;
  opposite_book_price: number | null;
  final_home_score: number | null;
  final_away_score: number | null;
  home_won: boolean | null;
  outcome_attached_at: string | null;
  realized_hit: boolean | null;
  closing_book_implied_devig: number | null;
  closing_attached_at: string | null;
  clv_pct: number | null;
  closing_resolution_status: string | null;
};

type Trigger = { player_name: string | null; team: string | null };
type LagEdge = { excess_lag_seconds: number | null; created_at: string };

type Completeness = {
  day_et: string;
  fires: number;
  fires_with_outcome: number;
  fires_with_closing: number;
  fires_complete: number;
  avg_outcome_latency_sec: number | null;
  avg_closing_latency_sec: number | null;
};

type Score = {
  event_id: string;
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
  game_status: string | null;
  period: string | null;
  clock: string | null;
};

function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n * 100).toFixed(digits) + "%";
}
function pctRatio(num: number, den: number): string {
  if (!den) return "—";
  return ((num / den) * 100).toFixed(0) + "%";
}
function fmtSec(s: number | null | undefined): string {
  if (s == null) return "—";
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}
function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function decisionBadge(d: string | null) {
  if (d === "fire") return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/40">FIRE</Badge>;
  if (d === "skip") return <Badge variant="outline" className="text-muted-foreground">skip</Badge>;
  return <Badge variant="outline">{d ?? "—"}</Badge>;
}
function sideBadge(s: string | null) {
  if (!s) return null;
  return <Badge variant="outline" className="font-mono text-[10px]">{s}</Badge>;
}
function sevBadge(s: string | null) {
  if (s === "WARN") return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40">WARN</Badge>;
  if (s === "INFO") return <Badge variant="outline">INFO</Badge>;
  return null;
}
function hitBadge(r: boolean | null, clv: number | null) {
  return (
    <span className="inline-flex items-center gap-1">
      {r === true && <Badge className="bg-emerald-500/20 text-emerald-400">HIT</Badge>}
      {r === false && <Badge className="bg-red-500/20 text-red-400">MISS</Badge>}
      {r == null && <span className="text-muted-foreground text-xs">—</span>}
      {clv != null && (
        <span className={`text-xs font-mono ${clv >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {clv >= 0 ? "+" : ""}{(clv * 100).toFixed(2)}%
        </span>
      )}
    </span>
  );
}

export default function MlbFairPriceDashboard() {
  
  const [completeness, setCompleteness] = useState<Completeness[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [scores, setScores] = useState<Record<string, Score>>({});
  const [triggers, setTriggers] = useState<Record<string, Trigger>>({});
  const [lagEdges, setLagEdges] = useState<LagEdge[]>([]);
  const [mlbInfo, setMlbInfo] = useState<Record<string, Score>>({});
  const [todaySlate, setTodaySlate] = useState<Array<{
    gamePk: number;
    gameId: string;
    home_team: string;
    away_team: string;
    game_status: string;
    start_iso: string;
    home_score: number | null;
    away_score: number | null;
    inning: string | null;
  }>>([]);
  const [todayDate, setTodayDate] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [filter, setFilter] = useState<{ decision: string; severity: string; closing: string; side: string; search: string }>({
    decision: "all", severity: "all", closing: "all", side: "all", search: "",
  });
  const [openGameId, setOpenGameId] = useState<string | null>(null);

  async function load() {
    try {
      const since24 = new Date(Date.now() - 24 * 3600_000).toISOString();
      const [comp, evs, le] = await Promise.all([
        (supabase as any).from("mlb_fair_price_event_completeness").select("*").order("day_et", { ascending: false }).limit(14),
        (supabase as any).from("mlb_fair_price_events").select("*").gte("created_at", since24).order("created_at", { ascending: false }).limit(500),
        supabase.from("lag_edges").select("excess_lag_seconds, created_at").gte("created_at", since24).limit(1000),
      ]);
      if (!comp.error) setCompleteness((comp.data ?? []) as Completeness[]);
      const evRows = (evs.data ?? []) as Event[];
      if (!evs.error) setEvents(evRows);
      if (!le.error) setLagEdges((le.data ?? []) as LagEdge[]);

      const gameIds = Array.from(new Set(evRows.map(e => e.game_id).filter(Boolean)));
      if (gameIds.length) {
        const [sc, le2] = await Promise.all([
          supabase.from("live_game_scores").select("event_id, home_team, away_team, home_score, away_score, game_status, period, clock").in("event_id", gameIds),
          supabase.from("live_events").select("game_id, event_time, event_type, player_name, team").eq("sport", "MLB").gte("created_at", since24).in("game_id", gameIds).limit(2000),
        ]);
        if (!sc.error) {
          const map: Record<string, Score> = {};
          (sc.data ?? []).forEach((r: any) => { map[r.event_id] = r; });
          setScores(map);
        }
        if (!le2.error) {
          const tmap: Record<string, Trigger> = {};
          (le2.data ?? []).forEach((r: any) => {
            const k = `${r.game_id}|${r.event_time}|${r.event_type}`;
            tmap[k] = { player_name: r.player_name, team: r.team };
          });
          setTriggers(tmap);
        }
      }
      setLastRefresh(new Date());
    } catch (e) {
      console.error("[MlbFairPriceDashboard] load failed", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  // Today's MLB slate (ET) — refreshes every 60s
  useEffect(() => {
    let cancelled = false;
    async function loadSlate() {
      try {
        // ET date
        const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
        const y = etNow.getFullYear();
        const m = String(etNow.getMonth() + 1).padStart(2, "0");
        const d = String(etNow.getDate()).padStart(2, "0");
        const date = `${y}-${m}-${d}`;
        const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=linescore`;
        const r = await fetch(url);
        if (!r.ok) return;
        const j = await r.json();
        const rows: typeof todaySlate = [];
        for (const day of j?.dates ?? []) {
          for (const g of day?.games ?? []) {
            rows.push({
              gamePk: g.gamePk,
              gameId: `mlb_${g.gamePk}`,
              home_team: g.teams?.home?.team?.name ?? "?",
              away_team: g.teams?.away?.team?.name ?? "?",
              game_status: g.status?.detailedState ?? g.status?.abstractGameState ?? "—",
              start_iso: g.gameDate,
              home_score: g.teams?.home?.score ?? null,
              away_score: g.teams?.away?.score ?? null,
              inning: g.linescore?.currentInningOrdinal
                ? `${g.linescore.inningState ?? ""} ${g.linescore.currentInningOrdinal}`.trim()
                : null,
            });
          }
        }
        rows.sort((a, b) => a.start_iso.localeCompare(b.start_iso));
        if (!cancelled) {
          setTodaySlate(rows);
          setTodayDate(date);
        }
      } catch (e) {
        console.warn("[MlbFairPriceDashboard] today slate failed", e);
      }
    }
    loadSlate();
    const id = setInterval(loadSlate, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Resolve team names from MLB Stats API for any game_id (mlb_<gamePk>) we don't already have a score join for.
  useEffect(() => {
    const unresolved = Array.from(new Set(events.map(e => e.game_id).filter(Boolean)))
      .filter(gid => gid.startsWith("mlb_") && !scores[gid] && !mlbInfo[gid])
      .map(gid => gid.replace(/^mlb_/, ""))
      .filter(pk => /^\d+$/.test(pk));
    if (unresolved.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gamePks=${unresolved.join(",")}`;
        const r = await fetch(url);
        if (!r.ok) return;
        const j = await r.json();
        const map: Record<string, Score> = {};
        for (const day of j?.dates ?? []) {
          for (const g of day?.games ?? []) {
            const pk = String(g.gamePk);
            const gid = `mlb_${pk}`;
            map[gid] = {
              event_id: gid,
              home_team: g.teams?.home?.team?.name ?? null,
              away_team: g.teams?.away?.team?.name ?? null,
              home_score: g.teams?.home?.score ?? null,
              away_score: g.teams?.away?.score ?? null,
              game_status: g.status?.abstractGameState ?? g.status?.detailedState ?? null,
              period: g.linescore?.currentInningOrdinal ?? null,
              clock: g.linescore?.inningState ?? null,
            };
          }
        }
        if (!cancelled && Object.keys(map).length) {
          setMlbInfo(prev => ({ ...prev, ...map }));
        }
      } catch (e) {
        console.warn("[MlbFairPriceDashboard] MLB schedule lookup failed", e);
      }
    })();
    return () => { cancelled = true; };
  }, [events, scores, mlbInfo]);

  // Rollups
  const rollup24h = useMemo(() => {
    const fires = events.filter(e => e.gate_decision === "fire");
    const sent = fires.filter(e => e.telegram_sent).length;
    const resolved = fires.filter(e => e.realized_hit !== null);
    const hits = resolved.filter(e => e.realized_hit).length;
    const clvs = fires.filter(e => e.clv_pct != null).map(e => e.clv_pct as number);
    const posClv = clvs.filter(c => c > 0).length;
    const avgClv = clvs.length ? clvs.reduce((s, v) => s + v, 0) / clvs.length : null;
    const avgEdge = fires.length ? fires.reduce((s, e) => s + (e.edge ?? 0), 0) / fires.length : null;
    const avgEv = fires.length ? fires.reduce((s, e) => s + (e.ev_pct ?? 0), 0) / fires.length : null;
    const real = fires.filter(e => e.book_id && e.book_price != null).length;
    return { evals: events.length, fires: fires.length, sent, resolved: resolved.length, hits, avgEdge, avgEv, avgClv, posClv, clvCount: clvs.length, real };
  }, [events]);

  // Book-latency (latency-arb evidence): for FIRE rows, feed_ts − book_last_move_ts (ms).
  // Positive = book hadn't yet reacted to the event we just consumed.
  const latencyStats = useMemo(() => {
    const fires = events.filter(e => e.gate_decision === "fire" && e.feed_ts != null && e.book_last_move_ts != null);
    const lags = fires.map(e => (e.feed_ts as number) - (e.book_last_move_ts as number)).filter(Number.isFinite);
    lags.sort((a, b) => a - b);
    const p = (q: number) => lags.length ? lags[Math.min(lags.length - 1, Math.floor(lags.length * q))] : null;
    const skips = events.filter(e => e.gate_decision === "skip");
    const bookReacted = skips.filter(e => e.skip_reason === "book_reacted").length;
    const staleFeed = skips.filter(e => e.skip_reason === "stale_feed").length;
    const noBook = skips.filter(e => e.skip_reason === "no_book_or_suspended").length;

    const lagSecs = lagEdges.map(r => r.excess_lag_seconds ?? 0).filter(Number.isFinite).sort((a, b) => a - b);
    const lp = (q: number) => lagSecs.length ? lagSecs[Math.min(lagSecs.length - 1, Math.floor(lagSecs.length * q))] : null;

    // Simple buckets for fire-lag histogram (ms)
    const buckets = [
      { label: "<500ms", lo: -Infinity, hi: 500 },
      { label: "0.5–1s", lo: 500, hi: 1000 },
      { label: "1–2s", lo: 1000, hi: 2000 },
      { label: "2–5s", lo: 2000, hi: 5000 },
      { label: "5s+", lo: 5000, hi: Infinity },
    ].map(b => ({ ...b, n: lags.filter(l => l >= b.lo && l < b.hi).length }));
    const bucketMax = Math.max(1, ...buckets.map(b => b.n));

    return {
      fireCount: lags.length,
      median: p(0.5), p90: p(0.9),
      bookReacted, staleFeed, noBook,
      lagEdges24h: lagEdges.length,
      lagP50: lp(0.5), lagP90: lp(0.9),
      buckets, bucketMax,
    };
  }, [events, lagEdges]);

  const topSkipReasons = useMemo(() => {
    const counts: Record<string, number> = {};
    events.forEach(e => {
      if (e.gate_decision === "skip" && e.skip_reason) {
        counts[e.skip_reason] = (counts[e.skip_reason] ?? 0) + 1;
      }
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [events]);

  // Per-book latency leaderboard — real mlb_fair_price_events data, grouped by book_id.
  const perBookLatency = useMemo(() => {
    const groups: Record<string, { fires: number[]; reacted: number; stale: number; realFires: number; totalFires: number }> = {};
    events.forEach(e => {
      const bk = e.book_id;
      if (!bk) return;
      const g = (groups[bk] ||= { fires: [], reacted: 0, stale: 0, realFires: 0, totalFires: 0 });
      if (e.gate_decision === "fire") {
        g.totalFires += 1;
        if (e.book_price != null) g.realFires += 1;
        if (e.feed_ts != null && e.book_last_move_ts != null) {
          const lag = (e.feed_ts as number) - (e.book_last_move_ts as number);
          if (Number.isFinite(lag)) g.fires.push(lag);
        }
      } else if (e.gate_decision === "skip") {
        if (e.skip_reason === "book_reacted") g.reacted += 1;
        else if (e.skip_reason === "stale_feed") g.stale += 1;
      }
    });
    const rows = Object.entries(groups).map(([book, g]) => {
      const sorted = g.fires.slice().sort((a, b) => a - b);
      const q = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null;
      return {
        book,
        fires: g.totalFires,
        lagN: sorted.length,
        median: q(0.5),
        p90: q(0.9),
        max: sorted.length ? sorted[sorted.length - 1] : null,
        reacted: g.reacted,
        stale: g.stale,
        realPct: g.totalFires ? g.realFires / g.totalFires : null,
      };
    });
    const ranked = rows.filter(r => r.lagN >= 5).sort((a, b) => (b.median ?? -1) - (a.median ?? -1));
    const lowVol = rows.filter(r => r.lagN < 5);
    const slowest = Math.max(1, ...ranked.map(r => r.median ?? 0));
    return { ranked, lowVol, slowest };
  }, [events]);

  // Live game tiles: group events by game_id
  const gameTiles = useMemo(() => {
    const byGame: Record<string, Event[]> = {};
    events.forEach(e => {
      if (!e.game_id) return;
      (byGame[e.game_id] ||= []).push(e);
    });
    return Object.entries(byGame).map(([gid, evs]) => {
      const fires = evs.filter(e => e.gate_decision === "fire").length;
      const last = evs[0];
      return { gameId: gid, fires, total: evs.length, last, score: scores[gid] ?? mlbInfo[gid] };
    }).sort((a, b) => b.fires - a.fires || b.total - a.total);
  }, [events, scores, mlbInfo]);

  // Filtered feed
  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (filter.decision !== "all" && e.gate_decision !== filter.decision) return false;
      if (filter.severity !== "all" && e.severity !== filter.severity) return false;
      if (filter.side !== "all" && e.side !== filter.side) return false;
      if (filter.closing === "yes" && !e.closing_attached_at) return false;
      if (filter.closing === "no" && e.closing_attached_at) return false;
      if (filter.search && !e.game_id?.toLowerCase().includes(filter.search.toLowerCase())) return false;
      return true;
    }).slice(0, 200);
  }, [events, filter]);


  const openGameEvents = openGameId ? events.filter(e => e.game_id === openGameId).slice().reverse() : [];
  const openGameScore = openGameId ? (scores[openGameId] ?? mlbInfo[openGameId]) : null;

  return (
    <div className="min-h-screen bg-background pb-12">
      <MobileHeader
        title="MLB Fair-Price"
        subtitle="v1 measurement"
        showBack
        backTo="/admin"
        showLogo={false}
        icon={<Flame className="w-5 h-5 text-primary" />}
      />
      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Engine scope note */}
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Tier-1 triggers (HR/K/BB) move <span className="font-mono">pre_state → post_state</span>; the wager is the
          game <span className="font-mono">LIVE_ML</span> moneyline, priced against a real <span className="font-mono">market_snapshot</span> row.
          Player props live in a separate <span className="font-mono">lag_edges</span> engine (latency tile below).
        </p>

        {/* Header strip */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div>
            {loading ? "Loading…" : `Auto-refresh every 15s · last ${lastRefresh ? lastRefresh.toLocaleTimeString() : "—"}`}
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        {/* 24h rollups */}
        <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
          <RollupTile label="Events (24h)" value={String(rollup24h.evals)} />
          <RollupTile label="Fires" value={String(rollup24h.fires)} hint={`sent ${pctRatio(rollup24h.sent, rollup24h.fires)}`} />
          <RollupTile label="Real book" value={pctRatio(rollup24h.real, rollup24h.fires)} hint={`${rollup24h.real}/${rollup24h.fires} fires`} />
          <RollupTile label="Hit rate" value={pctRatio(rollup24h.hits, rollup24h.resolved)} hint={`${rollup24h.resolved} resolved`} />
          <RollupTile label="Avg edge" value={pct(rollup24h.avgEdge, 2)} />
          <RollupTile label="Avg EV" value={pct(rollup24h.avgEv, 2)} />
          <RollupTile label="Avg CLV" value={pct(rollup24h.avgClv, 2)} hint={`${pctRatio(rollup24h.posClv, rollup24h.clvCount)} +CLV`} />
        </div>

        {/* Book latency / latency-arb evidence */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Book latency (24h) — how far behind the book was when we fired</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <RollupTile label="Fires w/ book ts" value={String(latencyStats.fireCount)} />
              <RollupTile label="Median lag" value={latencyStats.median != null ? `${latencyStats.median}ms` : "—"} />
              <RollupTile label="p90 lag" value={latencyStats.p90 != null ? `${latencyStats.p90}ms` : "—"} />
              <RollupTile label="book_reacted" value={String(latencyStats.bookReacted)} hint="book moved first" />
              <RollupTile label="stale_feed" value={String(latencyStats.staleFeed)} hint="our feed was stale" />
              <RollupTile label="no_book" value={String(latencyStats.noBook)} hint="no live_ml snapshot" />
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground mb-1">Fire lag distribution (feed_ts − book_last_move_ts)</div>
              <div className="space-y-1">
                {latencyStats.buckets.map(b => (
                  <div key={b.label} className="flex items-center gap-3 text-xs">
                    <div className="w-16 font-mono text-[10px] text-muted-foreground">{b.label}</div>
                    <div className="flex-1 relative h-5 bg-muted/30 rounded overflow-hidden">
                      <div className="absolute inset-y-0 left-0 bg-emerald-500/30" style={{ width: `${(b.n / latencyStats.bucketMax) * 100}%` }} />
                    </div>
                    <div className="w-10 text-right font-mono">{b.n}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground pt-2 border-t border-border">
              Sibling engine: <span className="font-mono">lag_edges</span> (player props) — {latencyStats.lagEdges24h} rows in 24h ·
              excess lag p50 <span className="font-mono">{latencyStats.lagP50 != null ? latencyStats.lagP50.toFixed(1) + "s" : "—"}</span> ·
              p90 <span className="font-mono">{latencyStats.lagP90 != null ? latencyStats.lagP90.toFixed(1) + "s" : "—"}</span>
            </div>
          </CardContent>
        </Card>

        {/* Per-book latency leaderboard */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Per-book latency leaderboard (24h)</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Higher median = book's published line is further behind the live event when we fire. These are the books most exposed to latency arb.
              Min 5 fires per book to rank; the rest are aggregated below.
            </p>
          </CardHeader>
          <CardContent>
            {perBookLatency.ranked.length === 0 && perBookLatency.lowVol.length === 0 ? (
              <p className="text-xs text-muted-foreground">No book-tagged fires in the last 24h.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Book</TableHead>
                    <TableHead className="text-right">Fires</TableHead>
                    <TableHead>Median lag</TableHead>
                    <TableHead className="text-right">p90</TableHead>
                    <TableHead className="text-right">Max</TableHead>
                    <TableHead className="text-right">book_reacted</TableHead>
                    <TableHead className="text-right">stale_feed</TableHead>
                    <TableHead className="text-right">Real-line %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {perBookLatency.ranked.map(r => {
                    const med = r.median ?? 0;
                    const tone = med >= 2000 ? "text-red-500" : med >= 1000 ? "text-amber-500" : "text-emerald-500";
                    const barPct = Math.min(100, Math.max(4, (med / perBookLatency.slowest) * 100));
                    return (
                      <TableRow key={r.book}>
                        <TableCell className="font-mono text-xs">{r.book}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{r.fires}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 relative h-3 bg-muted/30 rounded overflow-hidden min-w-[60px]">
                              <div className="absolute inset-y-0 left-0 bg-amber-500/40" style={{ width: `${barPct}%` }} />
                            </div>
                            <span className={`font-mono text-xs w-16 text-right ${tone}`}>{r.median != null ? `${r.median}ms` : "—"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{r.p90 != null ? `${r.p90}ms` : "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{r.max != null ? `${r.max}ms` : "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{r.reacted}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{r.stale}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{r.realPct != null ? `${(r.realPct * 100).toFixed(0)}%` : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                  {perBookLatency.lowVol.length > 0 && (
                    <TableRow className="text-muted-foreground">
                      <TableCell className="font-mono text-xs italic">(low-volume × {perBookLatency.lowVol.length})</TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {perBookLatency.lowVol.reduce((s, r) => s + r.fires, 0)}
                      </TableCell>
                      <TableCell colSpan={4} className="text-xs italic">
                        {perBookLatency.lowVol.map(r => r.book).join(", ")}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {perBookLatency.lowVol.reduce((s, r) => s + r.reacted, 0)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {perBookLatency.lowVol.reduce((s, r) => s + r.stale, 0)}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Completeness panel */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4" /> Daily completeness (last 14d)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date (ET)</TableHead>
                  <TableHead className="text-right">Fires</TableHead>
                  <TableHead className="text-right">Outcome</TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                  <TableHead className="text-right">Both</TableHead>
                  <TableHead className="text-right">Outcome latency</TableHead>
                  <TableHead className="text-right">Closing latency</TableHead>
                  <TableHead className="text-right">% complete</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {completeness.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No completeness data yet.</TableCell></TableRow>
                )}
                {completeness.map(row => {
                  const completePct = row.fires ? (row.fires_complete / row.fires) : 1;
                  const lowQuality = row.fires > 0 && completePct < 0.9;
                  return (
                    <TableRow key={row.day_et} className={lowQuality ? "bg-amber-500/5" : ""}>
                      <TableCell className="font-mono text-xs">{row.day_et}</TableCell>
                      <TableCell className="text-right">{row.fires}</TableCell>
                      <TableCell className="text-right">{row.fires_with_outcome}</TableCell>
                      <TableCell className="text-right">{row.fires_with_closing}</TableCell>
                      <TableCell className="text-right">{row.fires_complete}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtSec(row.avg_outcome_latency_sec)}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtSec(row.avg_closing_latency_sec)}</TableCell>
                      <TableCell className={`text-right font-mono text-xs ${lowQuality ? "text-amber-400" : ""}`}>
                        {row.fires ? (completePct * 100).toFixed(0) + "%" : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Live game strip */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Live games (last 24h activity)</CardTitle>
          </CardHeader>
          <CardContent>
            {gameTiles.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No game activity in the last 24h.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {gameTiles.map(tile => (
                  <button
                    key={tile.gameId}
                    onClick={() => setOpenGameId(tile.gameId)}
                    className="text-left rounded-lg border border-border bg-card hover:bg-muted/30 transition p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">
                          {tile.score ? `${tile.score.away_team} @ ${tile.score.home_team}` : tile.gameId}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">{tile.gameId}</div>
                      </div>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {tile.score?.game_status ?? "—"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <div className="font-mono">
                        {tile.score
                          ? `${tile.score.away_score ?? 0}–${tile.score.home_score ?? 0}${tile.score.period ? ` · ${tile.score.period}` : ""}${tile.score.clock ? ` ${tile.score.clock}` : ""}`
                          : "—"}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400">🔥 {tile.fires}</span>
                        <span className="text-muted-foreground">{tile.total} total</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>last {fmtTime(tile.last.created_at)}</span>
                      <span className="flex items-center gap-1">
                        {decisionBadge(tile.last.gate_decision)}
                        {tile.last.side && sideBadge(tile.last.side)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top skip reasons */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Top skip reasons (24h)</CardTitle>
          </CardHeader>
          <CardContent>
            {topSkipReasons.length === 0 ? (
              <p className="text-sm text-muted-foreground">No skips recorded.</p>
            ) : (
              <div className="space-y-1">
                {topSkipReasons.map(([reason, count]) => {
                  const max = topSkipReasons[0][1];
                  const w = (count / max) * 100;
                  return (
                    <div key={reason} className="flex items-center gap-3 text-xs">
                      <div className="flex-1 relative h-6 bg-muted/30 rounded overflow-hidden">
                        <div className="absolute inset-y-0 left-0 bg-primary/30" style={{ width: `${w}%` }} />
                        <div className="relative px-2 py-1 font-mono">{reason}</div>
                      </div>
                      <div className="w-12 text-right font-mono">{count}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Events feed */}
        {(() => {
          const DELAY_MS = 5000;
          const delayCatches = events
            .filter(e => e.feed_ts != null && e.book_last_move_ts != null && e.book_price != null && (e.feed_ts - e.book_last_move_ts) >= DELAY_MS)
            .map(e => ({ ev: e, lag: (e.feed_ts! - e.book_last_move_ts!) }))
            .sort((a, b) => b.lag - a.lag);
          const noBookCount = events.filter(e => e.skip_reason === "no_book_or_suspended" || e.book_id == null).length;
          const realLineFires = events.filter(e => e.gate_decision === "fire" && e.book_price != null).length;
          const maxLag = delayCatches[0]?.lag ?? 1;
          const allNoBook = events.length > 0 && events.every(e => e.book_id == null);

          return (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>Delay catches (≥ 5s book lag)</span>
                  <span className="text-xs text-muted-foreground font-normal">{delayCatches.length} caught · 24h</span>
                </CardTitle>
                <div className="flex flex-wrap gap-2 pt-2 text-[11px]">
                  <Badge variant="outline" className="bg-amber-500/10 border-amber-500/30 text-amber-400 font-mono">
                    Delay catches: {delayCatches.length}
                  </Badge>
                  <Badge variant="outline" className="bg-muted/40 font-mono text-muted-foreground">
                    No book / suspended: {noBookCount}
                  </Badge>
                  <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-mono">
                    Real-line fires: {realLineFires}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {allNoBook && (
                  <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                    <div className="font-semibold text-amber-300 mb-1">⚠ No book data in last 24h</div>
                    <p className="text-amber-200/80">
                      The fair-price engine logged {events.length} events but every one was{" "}
                      <span className="font-mono">no_book_or_suspended</span>. The book snapshot feed
                      isn't writing rows, so lag cannot be measured. Fix upstream scraper to unblock
                      this view.
                    </p>
                  </div>
                )}
                {delayCatches.length === 0 && !allNoBook ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No book reactions slower than 5s in the last 24h. Books are keeping up.
                  </p>
                ) : delayCatches.length > 0 && (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Time</TableHead>
                          <TableHead>Game</TableHead>
                          <TableHead>Event</TableHead>
                          <TableHead>Player</TableHead>
                          <TableHead>Side</TableHead>
                          <TableHead>Book</TableHead>
                          <TableHead className="text-right">Lag</TableHead>
                          <TableHead className="text-right">Edge</TableHead>
                          <TableHead>Decision</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {delayCatches.slice(0, 100).map(({ ev: e, lag }) => {
                          const sc = scores[e.game_id];
                          const trig = triggers[`${e.game_id}|${e.event_time}|${e.event_type}`];
                          const lagSec = (lag / 1000).toFixed(1);
                          const color = lag >= 10000 ? "text-red-400" : "text-amber-400";
                          const barColor = lag >= 10000 ? "bg-red-500/50" : "bg-amber-500/50";
                          const w = Math.max(8, (lag / maxLag) * 100);
                          return (
                            <TableRow key={e.id} className="text-xs">
                              <TableCell className="font-mono text-[11px] whitespace-nowrap">{fmtTime(e.created_at)}</TableCell>
                              <TableCell>
                                <button
                                  onClick={() => setOpenGameId(e.game_id)}
                                  className="text-primary hover:underline truncate max-w-[160px] inline-block align-middle"
                                >
                                  {sc ? `${sc.away_team}@${sc.home_team}` : e.game_id}
                                </button>
                              </TableCell>
                              <TableCell className="font-mono text-[10px] text-muted-foreground">{e.event_type ?? "—"}</TableCell>
                              <TableCell className="text-[11px]">
                                {trig?.player_name ? trig.player_name : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell>{sideBadge(e.side)}</TableCell>
                              <TableCell className="font-mono text-[11px]">{e.book_id ?? "—"}</TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <div className="relative h-4 w-24 bg-muted/30 rounded overflow-hidden">
                                    <div className={`absolute inset-y-0 left-0 ${barColor}`} style={{ width: `${w}%` }} />
                                  </div>
                                  <span className={`font-mono text-[11px] ${color}`}>{lagSec}s</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-mono">{pct(e.edge, 2)}</TableCell>
                              <TableCell>{decisionBadge(e.gate_decision)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* Raw events feed (collapsed by default) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>Raw events feed (last 24h, max 200) — debug</span>
              <span className="text-xs text-muted-foreground font-normal">{filteredEvents.length} shown</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground mb-3">
                Show raw event stream
              </summary>
            <div className="flex flex-wrap gap-2 pt-2">
              <FilterChip label="All" active={filter.decision === "all"} onClick={() => setFilter(f => ({ ...f, decision: "all" }))} />
              <FilterChip label="FIRE" active={filter.decision === "fire"} onClick={() => setFilter(f => ({ ...f, decision: "fire" }))} />
              <FilterChip label="SKIP" active={filter.decision === "skip"} onClick={() => setFilter(f => ({ ...f, decision: "skip" }))} />
              <div className="w-px bg-border mx-1" />
              <FilterChip label="Any sev" active={filter.severity === "all"} onClick={() => setFilter(f => ({ ...f, severity: "all" }))} />
              <FilterChip label="WARN" active={filter.severity === "WARN"} onClick={() => setFilter(f => ({ ...f, severity: "WARN" }))} />
              <FilterChip label="INFO" active={filter.severity === "INFO"} onClick={() => setFilter(f => ({ ...f, severity: "INFO" }))} />
              <div className="w-px bg-border mx-1" />
              <FilterChip label="Any side" active={filter.side === "all"} onClick={() => setFilter(f => ({ ...f, side: "all" }))} />
              <FilterChip label="HOME" active={filter.side === "HOME"} onClick={() => setFilter(f => ({ ...f, side: "HOME" }))} />
              <FilterChip label="AWAY" active={filter.side === "AWAY"} onClick={() => setFilter(f => ({ ...f, side: "AWAY" }))} />
              <div className="w-px bg-border mx-1" />
              <FilterChip label="Closing: any" active={filter.closing === "all"} onClick={() => setFilter(f => ({ ...f, closing: "all" }))} />
              <FilterChip label="Has closing" active={filter.closing === "yes"} onClick={() => setFilter(f => ({ ...f, closing: "yes" }))} />
              <FilterChip label="Missing closing" active={filter.closing === "no"} onClick={() => setFilter(f => ({ ...f, closing: "no" }))} />
              <div className="relative ml-auto">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                <Input
                  placeholder="Search game_id"
                  value={filter.search}
                  onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
                  className="h-7 pl-7 w-48 text-xs"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Game</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Player</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead className="text-right">Edge</TableHead>
                    <TableHead className="text-right">EV</TableHead>
                    <TableHead className="text-right">Book / Price</TableHead>
                    <TableHead className="text-right">Lag</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead>Sev</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Outcome</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEvents.map(e => {
                    const sc = scores[e.game_id];
                    const trig = triggers[`${e.game_id}|${e.event_time}|${e.event_type}`];
                    const lag = (e.feed_ts != null && e.book_last_move_ts != null)
                      ? (e.feed_ts - e.book_last_move_ts) : null;
                    const realBook = !!(e.book_id && e.book_price != null);
                    return (
                      <TableRow key={e.id} className="text-xs">
                        <TableCell className="font-mono text-[11px] whitespace-nowrap">{fmtTime(e.created_at)}</TableCell>
                        <TableCell>
                          <button
                            onClick={() => setOpenGameId(e.game_id)}
                            className="text-primary hover:underline truncate max-w-[180px] inline-block align-middle"
                          >
                            {sc ? `${sc.away_team}@${sc.home_team}` : e.game_id}
                          </button>
                        </TableCell>
                        <TableCell className="font-mono text-[10px] text-muted-foreground">{e.event_type ?? "—"}</TableCell>
                        <TableCell className="text-[11px]">
                          {trig?.player_name ? (
                            <span>
                              {trig.player_name}
                              {trig.team && <span className="text-muted-foreground font-mono ml-1">({trig.team})</span>}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>{sideBadge(e.side)}</TableCell>
                        <TableCell className="text-right font-mono">{pct(e.edge, 2)}</TableCell>
                        <TableCell className="text-right font-mono">{pct(e.ev_pct, 2)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {realBook ? (
                              <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[9px] font-mono px-1 py-0">REAL</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px] font-mono px-1 py-0 text-muted-foreground">NO BOOK</Badge>
                            )}
                            <span className="font-mono text-[11px]">{e.book_id ?? "—"}</span>
                            <span className="font-mono text-[11px] text-muted-foreground">{e.book_price ?? "—"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-[10px]">
                          {lag != null ? (
                            <span className={lag >= 0 ? "text-emerald-400" : "text-red-400"}>
                              {lag >= 0 ? "+" : ""}{lag}ms
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell>{decisionBadge(e.gate_decision)}</TableCell>
                        <TableCell>{sevBadge(e.severity)}</TableCell>
                        <TableCell className="text-muted-foreground font-mono text-[10px] truncate max-w-[140px]">{e.skip_reason ?? "—"}</TableCell>
                        <TableCell>{hitBadge(e.realized_hit, e.clv_pct)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredEvents.length === 0 && (
                    <TableRow><TableCell colSpan={13} className="text-center text-muted-foreground py-6">No events match the filters.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            </details>
          </CardContent>
        </Card>
      </main>

      {/* Game drawer */}
      <Sheet open={!!openGameId} onOpenChange={(o) => !o && setOpenGameId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center justify-between gap-2">
              <span>
                {openGameScore ? `${openGameScore.away_team} @ ${openGameScore.home_team}` : openGameId}
              </span>
              {openGameScore && (
                <Badge variant="outline" className="font-mono">
                  {openGameScore.away_score ?? 0}–{openGameScore.home_score ?? 0} · {openGameScore.game_status}
                  {openGameScore.period ? ` · ${openGameScore.period}` : ""}
                </Badge>
              )}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-6">
            {/* WP chart */}
            <div>
              <div className="text-xs text-muted-foreground mb-2">Win probability timeline</div>
              <div className="h-48 w-full">
                <ResponsiveContainer>
                  <LineChart data={openGameEvents.map(e => ({
                    t: new Date(e.created_at).getTime(),
                    wp_pre: e.wp_pre != null ? +(e.wp_pre * 100).toFixed(2) : null,
                    wp_post: e.wp_post != null ? +(e.wp_post * 100).toFixed(2) : null,
                    book: e.book_implied_devig != null ? +(e.book_implied_devig * 100).toFixed(2) : null,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="t" tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                    <Tooltip
                      labelFormatter={(v) => new Date(v as number).toLocaleTimeString()}
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 11 }}
                    />
                    <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" />
                    <Line type="monotone" dataKey="wp_pre" stroke="hsl(var(--muted-foreground))" dot={false} name="WP pre" />
                    <Line type="monotone" dataKey="wp_post" stroke="hsl(var(--primary))" dot={{ r: 2 }} name="WP post" />
                    <Line type="monotone" dataKey="book" stroke="#f59e0b" dot={false} strokeDasharray="4 2" name="Book devig" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Events table */}
            <div>
              <div className="text-xs text-muted-foreground mb-2">All events ({openGameEvents.length})</div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Trigger</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">WP pre→post</TableHead>
                      <TableHead className="text-right">Edge</TableHead>
                      <TableHead className="text-right">EV</TableHead>
                      <TableHead className="text-right">Book / Opp</TableHead>
                      <TableHead className="text-right">Lag</TableHead>
                      <TableHead>Decision</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Outcome / CLV</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openGameEvents.map(e => {
                      const trig = triggers[`${e.game_id}|${e.event_time}|${e.event_type}`];
                      const lag = (e.feed_ts != null && e.book_last_move_ts != null)
                        ? (e.feed_ts - e.book_last_move_ts) : null;
                      return (
                      <TableRow key={e.id} className="text-xs">
                        <TableCell className="font-mono text-[11px] whitespace-nowrap">{fmtTime(e.created_at)}</TableCell>
                        <TableCell className="text-[11px]">
                          <span className="font-mono text-muted-foreground">{e.event_type ?? "—"}</span>
                          {trig?.player_name && <span className="ml-1">{trig.player_name}</span>}
                          {trig?.team && <span className="font-mono text-muted-foreground ml-1">({trig.team})</span>}
                        </TableCell>
                        <TableCell>{sideBadge(e.side)}</TableCell>
                        <TableCell className="text-right font-mono">
                          {e.wp_pre != null ? (e.wp_pre * 100).toFixed(1) : "—"}→{e.wp_post != null ? (e.wp_post * 100).toFixed(1) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono">{pct(e.edge, 2)}</TableCell>
                        <TableCell className="text-right font-mono">{pct(e.ev_pct, 2)}</TableCell>
                        <TableCell className="text-right font-mono">
                          <span className="text-muted-foreground">{e.book_id ?? "—"} </span>
                          {e.book_price ?? "—"} / {e.opposite_book_price ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-[10px]">
                          {lag != null ? (
                            <span className={lag >= 0 ? "text-emerald-400" : "text-red-400"}>
                              {lag >= 0 ? "+" : ""}{lag}ms
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell>{decisionBadge(e.gate_decision)}</TableCell>
                        <TableCell className="text-muted-foreground font-mono text-[10px] truncate max-w-[120px]">{e.skip_reason ?? "—"}</TableCell>
                        <TableCell>{hitBadge(e.realized_hit, e.clv_pct)}</TableCell>
                      </TableRow>
                      );
                    })}
                    {openGameEvents.length === 0 && (
                      <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-6">No events for this game.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function RollupTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-bold mt-0.5">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] px-2 py-1 rounded border transition ${
        active ? "bg-primary/20 border-primary/40 text-primary" : "border-border text-muted-foreground hover:bg-muted/30"
      }`}
    >
      {label}
    </button>
  );
}