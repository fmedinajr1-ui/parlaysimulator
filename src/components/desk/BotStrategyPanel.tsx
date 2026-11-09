import { useEffect, useMemo, useState } from "react";
import { Bot, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PASS_KEY } from "@/components/AdminGate";
import { BOT_STARTING_BANKROLL, BOT_STRATEGY_VERSION, summarizeBotProfit, type BotPosition, type BotResult } from "@/utils/botStrategy";

interface SavedBotPick extends BotResult {
  game_date: string;
  player_name: string;
  stat: string;
  side: "over" | "under";
  line: number;
  result_value: number | null;
}

const units = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}u`;

export function BotStrategyPanel({ positions, today }: { positions: BotPosition[]; today: string }) {
  const [saved, setSaved] = useState<SavedBotPick[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const passcode = localStorage.getItem(PASS_KEY) ?? "";
        const { data, error: requestError } = await supabase.functions.invoke("desk-bets", { body: { action: "bot_record", passcode } });
        if (requestError) throw requestError;
        if (alive) { setSaved(data?.picks ?? []); setError(false); }
      } catch { if (alive) setError(true); }
    })();
    return () => { alive = false; };
  }, [today]);
  const summary = useMemo(() => summarizeBotProfit(saved), [saved]);

  return <section aria-label="Oversight Bot strategy and profit" className="desk-panel-flat mb-4 p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Bot size={17} className="text-primary" /> Oversight Bot strategy</h2>
        <p className="mt-1 font-mono text-[10px] text-muted-foreground">{BOT_STRATEGY_VERSION} · SIMULATED UNITS · NO REAL WAGERS</p>
      </div>
      <span className="desk-chip">{summary.won}–{summary.lost}–{summary.push} · {summary.voided} void</span>
    </div>

    <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
      {[
        ["Bot bankroll", `${summary.bankroll.toFixed(2)}u`],
        ["Settled profit", units(summary.profit)],
        ["Settled ROI", summary.roi == null ? "—" : `${summary.roi >= 0 ? "+" : ""}${(summary.roi * 100).toFixed(1)}%`],
        ["Open risk", `${summary.exposure.toFixed(2)}u`],
      ].map(([label, value], i) => <div className="bg-card p-3" key={label}>
        <div className="desk-label">{label}</div>
        <div className={`mt-1 font-mono text-lg font-semibold ${i === 1 ? (summary.profit >= 0 ? "text-primary" : "text-destructive") : ""}`}>{value}</div>
      </div>)}
    </div>
    <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">Starts at {BOT_STARTING_BANKROLL}u. Profit uses settled positions only; open risk is separate. ROI uses settled stakes.</p>

    <div className="mt-4 border-t border-border pt-3">
      <h3 className="text-xs font-semibold">Tonight’s bot targets · {today}</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Top 3 skeptical plays by warning-adjusted expected profit. Base 0.75u; less for extra warnings, a 20-point model/hit-rate gap, or +150 odds. Daily cap 1.50u.</p>
      <div className="mt-2 space-y-2">
        {positions.map(({ pick, warnings, riskScore, stakeUnits, rank }) => {
          const result = saved.find((r) => r.game_date === today && r.player_name === pick.player && r.stat === pick.stat && r.side === pick.side && Number(r.line) === pick.line);
          return <div className="border border-border bg-card p-3" key={`${pick.player}|${pick.stat}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">#{rank} {pick.player}</p>
                <p className="mt-0.5 text-xs capitalize text-muted-foreground">{pick.side} {pick.line} {pick.stat.replace(/_/g, " ")} · {pick.odds > 0 ? "+" : ""}{pick.odds}</p>
              </div>
              <div className="shrink-0 text-right font-mono text-xs">
                <p className="font-semibold text-primary">{stakeUnits.toFixed(2)}u</p>
                <p className="mt-1 text-destructive">RISK {riskScore}/100</p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="desk-chip flex items-center gap-1 text-destructive"><ShieldAlert size={11} />{warnings.length} warning{warnings.length > 1 ? "s" : ""}</span>
              {result && <span className={`desk-chip ${result.status === "lost" ? "text-destructive" : result.status === "won" ? "text-primary" : ""}`}>
                {result.status.toUpperCase()}{result.result_value != null ? ` · ${result.result_value}` : ""}
              </span>}
            </div>
          </div>;
        })}
        {!positions.length && <p className="py-2 text-xs text-muted-foreground">No skeptical targets with verified odds tonight.</p>}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-destructive">Saved bot results are temporarily unavailable.</p>}
    </div>
  </section>;
}
