import { useState } from "react";
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
