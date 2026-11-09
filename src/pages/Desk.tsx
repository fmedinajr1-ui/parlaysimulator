import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PASS_KEY } from "@/components/AdminGate";
import { MODEL_VERSION } from "@/utils/nbaProjection";
import "@/components/desk/desk-tokens.css";
import { Seo } from "@/components/seo/Seo";
import { useResearchData } from "@/hooks/useResearchData";
import { useRememberedDeskState } from "@/hooks/useRememberedDeskState";
import { DeskTopBar } from "@/components/desk/DeskTopBar";
import { EdgeCards } from "@/components/desk/EdgeCards";
import { GameCoverageBoard } from "@/components/desk/GameCoverage";
import { ResearchTerminal } from "@/components/desk/ResearchTerminal";
import { SeasonVenueBoard } from "@/components/desk/SeasonVenueBoard";
import { MinutesComparison } from "@/components/desk/MinutesComparison";
import { reviewDeskPicks } from "@/utils/deskReview";
import { BOT_STRATEGY_VERSION, buildBotStrategy } from "@/utils/botStrategy";
import { BotStrategyPanel } from "@/components/desk/BotStrategyPanel";
import { Button } from "@/components/ui/button";
import { Bot, CheckCheck, ShieldAlert, LayoutGrid, Users, Search, ChartNoAxesCombined, ChevronDown } from "lucide-react";

export default function Desk() {
  const { logs, loading, err, byPlayer, propLines, injuries, today, edges, allEdges, v6Edges, boardEdges, gameCoverage, trendFor } = useResearchData();
  const [focus, setFocus] = useRememberedDeskState<string | null>("focus", null);
  const [savedView, setView] = useRememberedDeskState<"picks" | "games" | "research" | "results">("view", "picks");
  const view = ["picks", "games", "research", "results"].includes(savedView) ? savedView : "picks";
  const [flaggedOpen, setFlaggedOpen] = useRememberedDeskState("skeptical-open", false);
  const [reviewed, setReviewed] = useRememberedDeskState("reviewed", false);
  const audit = useMemo(() => reviewDeskPicks(allEdges), [allEdges]);
  const botPositions = useMemo(() => buildBotStrategy(audit.flagged), [audit.flagged]);
  const reviewPlayer = (player: string) => { setFocus(player); setView("research"); };
  const [records, setRecords] = useState<{ v: string; w: number; l: number; p: number; open: number; profit: number }[] | null>(null);

  // Record tonight's picks (first snapshot of the day is kept) and load the graded record.
  useEffect(() => {
    if (loading) return;
    const passcode = localStorage.getItem(PASS_KEY) ?? "";
    const picks = edges.slice(0, 50).map((e, i) => ({
      game_date: today, player_name: e.player, stat: e.stat, side: e.side, line: e.line, odds: e.odds ?? null,
      projection: e.median, win_prob: e.hitRate, ev: e.ev, opponent: e.tonight, this_season: e.thisSeason,
      reasons: e.reasons ?? [], rank: i + 1, model_version: MODEL_VERSION,
    }));
    (async () => {
      try {
        if (picks.length) await supabase.functions.invoke("desk-bets", { body: { action: "log_picks", passcode, picks } });
        const botPicks = botPositions.map(({ pick: e, warnings, riskScore, stakeUnits, rank }) => ({
          game_date: today, player_name: e.player, stat: e.stat, side: e.side, line: e.line, odds: e.odds,
          projection: e.median, win_prob: e.hitRate, ev: e.ev, opponent: e.tonight, model_version: MODEL_VERSION,
          strategy_version: BOT_STRATEGY_VERSION, rank, warning_count: warnings.length, warnings, risk_score: riskScore, stake_units: stakeUnits,
        }));
        if (botPicks.length) await supabase.functions.invoke("desk-bets", { body: { action: "log_bot_picks", passcode, picks: botPicks } });
        const { data } = await supabase.functions.invoke("desk-bets", { body: { action: "pick_record", passcode } });
        const rows = (data?.picks ?? []) as { model_version: string; status: string; odds: number | null }[];
        const by = new Map<string, { v: string; w: number; l: number; p: number; open: number; profit: number }>();
        for (const r of rows) {
          if (r.model_version === "v4-margin") continue; // broken first v4 snapshot, excluded
          const s = by.get(r.model_version) ?? { v: r.model_version, w: 0, l: 0, p: 0, open: 0, profit: 0 };
          const o = r.odds ?? -110;
          if (r.status === "won") { s.w++; s.profit += o > 0 ? o / 100 : 100 / -o; }
          else if (r.status === "lost") { s.l++; s.profit -= 1; }
          else if (r.status === "push") s.p++;
          else if (r.status === "open") s.open++;
          by.set(r.model_version, s);
        }
        setRecords([...by.values()].sort((a, b) => a.v.localeCompare(b.v)));
      } catch { /* logging is best-effort */ }
    })();
  }, [loading, edges, botPositions, today]);

  return (
    <div className="desk-theme desk-grid-bg">
      <Seo
        title="ParlayFarm Research Desk — NBA L5/L10 splits, live lines & daily edges"
        description="A clean NBA research desk: L5 and L10 medians, floors, ceilings and hit rates from 29,000+ box scores, live sportsbook prop lines, injury flags and an AI analyst."
        canonical="https://parlayfarm.com/"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "ParlayFarm Research Desk",
          applicationCategory: "SportsApplication",
          operatingSystem: "Web",
          url: "https://parlayfarm.com/",
        }}
      />

      <DeskTopBar
        logs={logs.length}
        players={byPlayer.size}
        lines={propLines.size}
        injuries={injuries.size}
        latest={logs[0]?.game_date ?? null}
        edges={audit.clear.slice(0, 4)}
      />

      <main className="mx-auto max-w-[1500px] px-3 pb-16 pt-3 sm:px-4 sm:pt-4">
        <section className="flex flex-col justify-between gap-5 border-b border-border py-5 sm:flex-row sm:items-center">
          <div>
            <div className="mb-2 flex items-center gap-2 font-mono text-xs text-primary"><Bot size={16} /> DESK OVERSIGHT</div>
            <h1 className="desk-display text-2xl font-semibold sm:text-3xl">Tonight’s decision desk</h1>
            <p className="mt-2 text-sm text-muted-foreground">{today} · {loading ? "Loading tonight’s data…" : `${audit.total} qualifying props · ${gameCoverage.length} games`}</p>
          </div>
          <Button variant="outline" className="rounded-md" disabled={loading} onClick={() => { setReviewed(true); setView("picks"); }}><CheckCheck /> Review tonight</Button>
        </section>
        <div className="grid grid-cols-3 divide-x divide-border border-b border-border py-4">
          <div className="pr-2"><div className="desk-label">No flags</div><div className="mt-1 font-mono text-2xl text-primary">{loading ? "—" : audit.clear.length}</div></div>
          <div className="px-3"><div className="desk-label">Skeptical</div><div className="mt-1 font-mono text-2xl text-destructive">{loading ? "—" : audit.flagged.length}</div></div>
          <div className="pl-3"><div className="desk-label">Lines today</div><div className="mt-1 font-mono text-2xl">{loading ? "—" : propLines.size}</div></div>
        </div>
        <nav aria-label="Desk views" className="my-4 grid grid-cols-4 gap-1 sm:flex sm:gap-2">
          <Button variant={view === "picks" ? "secondary" : "ghost"} className="rounded-md px-2" onClick={() => setView("picks")}><LayoutGrid className="hidden sm:block" />Picks</Button>
          <Button variant={view === "games" ? "secondary" : "ghost"} className="rounded-md px-2" onClick={() => setView("games")}><Users className="hidden sm:block" />Games</Button>
          <Button variant={view === "research" ? "secondary" : "ghost"} className="rounded-md px-2" onClick={() => setView("research")}><Search className="hidden sm:block" />Research</Button>
          <Button variant={view === "results" ? "secondary" : "ghost"} className="rounded-md px-2" onClick={() => setView("results")}><ChartNoAxesCombined className="hidden sm:block" />Results</Button>
        </nav>
        {view === "picks" && <>
          {reviewed && <div role="status" className="mb-4 border-l-2 border-primary bg-secondary px-3 py-3 text-sm">Review complete: {audit.clear.length} without disagreement flags, {audit.flagged.length} skeptical. No pick is guaranteed.</div>}
          {err && <p role="alert" className="mb-3 text-sm text-destructive">{err}</p>}
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-lg font-semibold">Main recommendations</h2><span className="text-xs text-muted-foreground">{MODEL_VERSION} · Up to 4 without review flags</span></div>
          {loading ? <p className="py-6 text-sm text-muted-foreground">Reviewing tonight’s props…</p> : <EdgeCards edges={audit.clear.slice(0, 4)} onPick={reviewPlayer} />}
          <section className="mt-5 border-y border-border py-3">
            <Button variant="ghost" className="h-auto w-full justify-between whitespace-normal rounded-md py-3 text-left" aria-expanded={flaggedOpen} onClick={() => setFlaggedOpen(!flaggedOpen)}><span className="flex items-center gap-2"><ShieldAlert className="text-destructive" />Skeptical plays · {audit.flagged.length}</span><ChevronDown className={flaggedOpen ? "rotate-180" : ""} /></Button>
            {flaggedOpen && <div className="pt-3"><EdgeCards edges={audit.flagged} onPick={reviewPlayer} skeptical showSlip={false} /></div>}
          </section>
        </>}
        {view === "results" && <>
        <BotStrategyPanel positions={botPositions} today={today} />
        <MinutesComparison board={boardEdges} v5={edges} v6={v6Edges} byPlayer={byPlayer} today={today} />
        {records && records.length > 0 && (
          <div className="mb-2 overflow-x-auto rounded-md border border-border font-mono text-xs">
            <table className="w-full">
              <thead className="text-muted-foreground"><tr>
                <th className="px-2 py-1 text-left">Model</th><th className="px-2 py-1 text-right">W-L-P</th>
                <th className="px-2 py-1 text-right">Win %</th><th className="px-2 py-1 text-right">Units</th><th className="px-2 py-1 text-right">Open</th>
              </tr></thead>
              <tbody>{records.map((r) => (
                <tr key={r.v} className={r.v === MODEL_VERSION ? "text-foreground" : "text-muted-foreground"}>
                  <td className="px-2 py-1">{r.v}{r.v === MODEL_VERSION ? " (current)" : ""}</td>
                  <td className="px-2 py-1 text-right">{r.w}-{r.l}-{r.p}</td>
                  <td className="px-2 py-1 text-right">{r.w + r.l ? Math.round((100 * r.w) / (r.w + r.l)) + "%" : "—"}</td>
                  <td className={`px-2 py-1 text-right ${r.profit >= 0 ? "text-primary" : "text-destructive"}`}>{r.profit >= 0 ? "+" : ""}{r.profit.toFixed(2)}</td>
                  <td className="px-2 py-1 text-right">{r.open}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Model records retain all originally logged picks, including flagged ones.</p>
        </>}
        {view === "games" && <>
        <GameCoverageBoard games={gameCoverage} onPick={reviewPlayer} />
        <div className="mt-3">
          <SeasonVenueBoard byPlayer={byPlayer} propLines={propLines} today={today} onPick={reviewPlayer} />
        </div>
        </>}

        {view === "research" && <div className="mt-3">
            <ResearchTerminal
              byPlayer={byPlayer}
              propLines={propLines}
              injuries={injuries}
              loading={loading}
              err={err}
              focus={focus}
              today={today}
              trendFor={trendFor}
            />
        </div>}

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--desk-line))] pt-4">
          <p className="desk-mono text-[11px] text-[hsl(var(--desk-muted))]">
            Review flags are cautions, not guarantees · Daily update 8 AM ET
          </p>
          <div className="flex flex-wrap gap-2">
            <a href="/grade" className="desk-tab">Grade a slip</a>
          </div>
        </footer>
      </main>
    </div>
  );
}
