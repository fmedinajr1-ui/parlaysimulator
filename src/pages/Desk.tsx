import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PASS_KEY } from "@/components/AdminGate";
import { MODEL_VERSION } from "@/utils/nbaProjection";
import "@/components/desk/desk-tokens.css";
import { Seo } from "@/components/seo/Seo";
import { useResearchData } from "@/hooks/useResearchData";
import { DeskTopBar } from "@/components/desk/DeskTopBar";
import { EdgeCards } from "@/components/desk/EdgeCards";
import { GameCoverageBoard } from "@/components/desk/GameCoverage";
import { ResearchTerminal } from "@/components/desk/ResearchTerminal";
import { SeasonVenueBoard } from "@/components/desk/SeasonVenueBoard";
import { MathSlip } from "@/components/desk/MathSlip";
import { MinutesComparison } from "@/components/desk/MinutesComparison";

export default function Desk() {
  const { logs, loading, err, byPlayer, propLines, injuries, today, edges, v6Edges, boardEdges, gameCoverage, trendFor } = useResearchData();
  const [focus, setFocus] = useState<string | null>(null);
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
  }, [loading, edges, today]);

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
        edges={edges}
      />

      <main className="mx-auto max-w-[1500px] px-3 pb-16 pt-3 sm:px-4 sm:pt-4">
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
        <EdgeCards edges={edges} onPick={setFocus} />
        <GameCoverageBoard games={gameCoverage} onPick={setFocus} />
        <div className="mt-3">
          <SeasonVenueBoard byPlayer={byPlayer} propLines={propLines} onPick={setFocus} />
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <ResearchTerminal
              byPlayer={byPlayer}
              propLines={propLines}
              injuries={injuries}
              loading={loading}
              err={err}
              focus={focus}
              trendFor={trendFor}
            />
          </div>
          <div className="lg:col-span-4">
            <MathSlip today={today} />
          </div>
        </div>

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--desk-line))] pt-4">
          <p className="desk-mono text-[11px] text-[hsl(var(--desk-muted))]">
            Box score math only · no black-box model · every number traces back to a played game
          </p>
          <div className="flex flex-wrap gap-2">
            <a href="/grade" className="desk-tab">Grade a slip</a>
            <a href="/landing" className="desk-tab">Parlay Farm offers</a>
            <a href="/blog" className="desk-tab">Blog</a>
          </div>
        </footer>
      </main>
    </div>
  );
}
