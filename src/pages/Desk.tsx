import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PASS_KEY } from "@/components/AdminGate";
import { MODEL_VERSION } from "@/utils/nbaProjection";
import "@/components/desk/desk-tokens.css";
import { Seo } from "@/components/seo/Seo";
import { useResearchData } from "@/hooks/useResearchData";
import { DeskTopBar } from "@/components/desk/DeskTopBar";
import { EdgeCards } from "@/components/desk/EdgeCards";
import { ResearchTerminal } from "@/components/desk/ResearchTerminal";
import { MathSlip } from "@/components/desk/MathSlip";

export default function Desk() {
  const { logs, loading, err, byPlayer, propLines, injuries, today, edges } = useResearchData();
  const [focus, setFocus] = useState<string | null>(null);
  const [record, setRecord] = useState<{ w: number; l: number; p: number; profit: number } | null>(null);

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
        const rows = ((data?.picks ?? []) as { model_version: string; status: string; odds: number | null }[]).filter((r) => r.model_version === MODEL_VERSION);
        let w = 0, l = 0, p = 0, profit = 0;
        for (const r of rows) {
          const o = r.odds ?? -110;
          if (r.status === "won") { w++; profit += o > 0 ? o / 100 : 100 / -o; }
          else if (r.status === "lost") { l++; profit -= 1; }
          else if (r.status === "push") p++;
        }
        setRecord({ w, l, p, profit });
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
        {record && (
          <p className="mb-2 font-mono text-xs text-muted-foreground">
            Pick record ({MODEL_VERSION}): {record.w}-{record.l}{record.p ? `-${record.p}` : ""} ·{" "}
            <span className={record.profit >= 0 ? "text-primary" : "text-destructive"}>
              {record.profit >= 0 ? "+" : ""}{record.profit.toFixed(2)} units
            </span>
            {record.w + record.l === 0 && " · first grades land after tonight's games"}
          </p>
        )}
        <EdgeCards edges={edges} onPick={setFocus} />

        <div className="mt-3 grid gap-3 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <ResearchTerminal
              byPlayer={byPlayer}
              propLines={propLines}
              injuries={injuries}
              loading={loading}
              err={err}
              focus={focus}
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
