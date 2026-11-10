import { useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runCalibrationExperiment, slateProfitTrend, type CalibrationMetrics } from "@/utils/calibrationExperiment";
import type { ResearchPick } from "@/utils/accuracyResearch";

const pct = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const money = (value: number) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const score = (value: number | null) => value == null ? "—" : value.toFixed(3);

function MetricRow({ label, metrics }: { label: string; metrics: CalibrationMetrics }) {
  return <tr className="border-t border-border">
    <th scope="row" className="py-2 pr-3 text-left font-medium">{label}</th>
    <td className="p-2 text-right font-mono">{pct(metrics.averageForecast)}</td>
    <td className="p-2 text-right font-mono">{score(metrics.brier)}</td>
    <td className="p-2 text-right font-mono">{metrics.calibrationGap == null ? "—" : `${metrics.calibrationGap >= 0 ? "+" : ""}${(metrics.calibrationGap * 100).toFixed(1)}`}</td>
    <td className="p-2 text-right font-mono">{metrics.qualifiedWon}–{metrics.qualifiedLost}</td>
    <td className="p-2 text-right font-mono">{pct(metrics.qualifiedAccuracy)}</td>
    <td className="p-2 text-right font-mono">{pct(metrics.coverage)}</td>
  </tr>;
}

export function CalibrationExperiment({ picks, kind }: { picks: ResearchPick[]; kind: "pregame" | "review" }) {
  const [winWeight, setWinWeight] = useState(75);
  const [l10Weight, setL10Weight] = useState(25);
  const [cutoff, setCutoff] = useState(60);
  const [stake, setStake] = useState(10);
  const [startBank, setStartBank] = useState(1000);
  const [submitted, setSubmitted] = useState<{ winChanceWeight: number; l10Weight: number; cutoff: number; stake: number; startingBankroll: number } | null>(null);
  const result = useMemo(() => submitted ? runCalibrationExperiment(picks, kind, submitted) : null, [picks, kind, submitted]);
  const trend = useMemo(() => slateProfitTrend(picks, { winChanceWeight: 65, l10Weight: 35, cutoff: 0.66, stake: 10 }), [picks]);
  const invalidWeights = winWeight + l10Weight <= 0;

  return <section aria-label="Win chance and L10 calibration experiment" className="mt-5 border-y border-border py-4">
    <div className="flex items-start gap-2">
      <FlaskConical size={17} className="mt-0.5 shrink-0 text-primary" />
      <div>
        <h4 className="text-sm font-semibold">Calibration experiment</h4>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Blend the saved skeptical win chance with its real L10 record. Nothing here changes live picks or saved probabilities.</p>
      </div>
    </div>
    {trend.length > 0 && <div className="mt-4">
      <h5 className="text-xs font-semibold">65/35 blend trend · ≥66% · $10/play</h5>
      <div className="mt-2 overflow-x-auto"><table aria-label="65/35 slate trend" className="w-full min-w-[420px] text-xs">
        <thead className="text-muted-foreground"><tr><th className="py-1 pr-3 text-left">Slate</th><th className="p-1 text-right">W–L</th><th className="p-1 text-right">Open</th><th className="p-1 text-right">Profit</th><th className="p-1 text-right">Running</th></tr></thead>
        <tbody>{trend.map(r => <tr key={r.game_date} className="border-t border-border">
          <td className="py-1 pr-3 font-mono">{r.game_date}</td><td className="p-1 text-right font-mono">{r.won}–{r.lost}</td><td className="p-1 text-right font-mono">{r.open}</td>
          <td className={`p-1 text-right font-mono ${r.profit >= 0 ? "text-primary" : "text-destructive"}`}>{r.profit >= 0 ? "+" : "−"}{money(Math.abs(r.profit))}</td>
          <td className={`p-1 text-right font-mono ${r.cumulative >= 0 ? "text-primary" : "text-destructive"}`}>{r.cumulative >= 0 ? "+" : "−"}{money(Math.abs(r.cumulative))}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="mt-1 text-xs text-muted-foreground">Fills in after each midnight update. Practice dollars only.</p>
    </div>}
    <div className="mt-4 grid gap-4 sm:grid-cols-3">
      <label className="text-xs">Win chance weight <output className="float-right font-mono">{winWeight}%</output>
        <input aria-label="Win chance weight" className="mt-2 w-full accent-primary" type="range" min="0" max="100" step="5" value={winWeight} onChange={event => setWinWeight(Number(event.target.value))} />
      </label>
      <label className="text-xs">L10 record weight <output className="float-right font-mono">{l10Weight}%</output>
        <input aria-label="L10 record weight" className="mt-2 w-full accent-primary" type="range" min="0" max="100" step="5" value={l10Weight} onChange={event => setL10Weight(Number(event.target.value))} />
      </label>
      <label className="text-xs">Confidence cutoff <output className="float-right font-mono">≥{cutoff}%</output>
        <input aria-label="Confidence cutoff" className="mt-2 w-full accent-primary" type="range" min="50" max="90" step="5" value={cutoff} onChange={event => setCutoff(Number(event.target.value))} />
      </label>
    </div>
    <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-sm">
      <label className="text-xs">Starting bankroll ($)
        <input aria-label="Starting bankroll" className="mt-1 w-full rounded border border-border bg-background p-2 font-mono" type="number" min="0" step="50" value={startBank} onChange={e => setStartBank(Math.max(0, Number(e.target.value) || 0))} />
      </label>
      <label className="text-xs">Stake per pick ($)
        <input aria-label="Stake per pick" className="mt-1 w-full rounded border border-border bg-background p-2 font-mono" type="number" min="1" step="1" value={stake} onChange={e => setStake(Math.max(1, Number(e.target.value) || 1))} />
      </label>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button size="sm" variant="outline" disabled={!picks.length || invalidWeights} onClick={() => setSubmitted({ winChanceWeight: winWeight, l10Weight, cutoff: cutoff / 100, stake, startingBankroll: startBank })}>Run experiment</Button>
      {invalidWeights && <p className="text-xs text-destructive">Give at least one input a weight above zero.</p>}
    </div>
    {result && <div className="mt-4">
      <p role="status" className="text-xs text-muted-foreground">{result.n} decided props · {result.slates} slate{result.slates === 1 ? "" : "s"} · {result.excluded} excluded · Normalized to {(result.weights.winChance * 100).toFixed(0)}% win chance / {(result.weights.l10 * 100).toFixed(0)}% L10</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[680px] text-xs">
          <thead className="text-muted-foreground"><tr>
            <th className="py-2 pr-3 text-left">Forecast</th><th className="p-2 text-right">Avg chance</th><th className="p-2 text-right">Brier ↓</th>
            <th className="p-2 text-right">Gap ±pts</th><th className="p-2 text-right">≥{Math.round(result.cutoff * 100)}% W–L</th>
            <th className="p-2 text-right">Cutoff accuracy</th><th className="p-2 text-right">Coverage</th>
          </tr></thead>
          <tbody><MetricRow label="Saved win chance" metrics={result.baseline} /><MetricRow label="Experiment" metrics={result.candidate} /></tbody>
        </table>
      </div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <p className="bg-secondary p-3">Brier error: <strong>{result.delta.brier == null ? "—" : `${result.delta.brier > 0 ? "+" : ""}${result.delta.brier.toFixed(3)}`}</strong> versus saved chance. Lower is better.</p>
        <p className="bg-secondary p-3">Cutoff accuracy: <strong>{pct(result.baseline.qualifiedAccuracy)} → {pct(result.candidate.qualifiedAccuracy)}</strong> · {result.baseline.qualified} → {result.candidate.qualified} picks.</p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
          <thead className="text-muted-foreground"><tr>
            <th className="py-2 pr-3 text-left">Bankroll (${result.stake}/pick)</th><th className="p-2 text-right">Bets</th><th className="p-2 text-right">Staked</th>
            <th className="p-2 text-right">Profit</th><th className="p-2 text-right">ROI</th><th className="p-2 text-right">Ending</th>
          </tr></thead>
          <tbody>{([["Saved win chance", result.bankroll.baseline], ["Experiment", result.bankroll.candidate]] as const).map(([label, b]) =>
            <tr key={label} className="border-t border-border">
              <th scope="row" className="py-2 pr-3 text-left font-medium">{label}</th>
              <td className="p-2 text-right font-mono">{b.bets}</td>
              <td className="p-2 text-right font-mono">{money(b.staked)}</td>
              <td className={`p-2 text-right font-mono ${b.profit >= 0 ? "text-primary" : "text-destructive"}`}>{b.profit >= 0 ? "+" : "−"}{money(Math.abs(b.profit))}</td>
              <td className="p-2 text-right font-mono">{pct(b.roi)}</td>
              <td className="p-2 text-right font-mono">{money(b.endingBankroll)}</td>
            </tr>)}</tbody>
        </table>
      </div>
      <p className="mt-2 bg-secondary p-3 text-xs">Bankroll change vs saved chance: <strong>{result.bankroll.profitChange >= 0 ? "+" : "−"}{money(Math.abs(result.bankroll.profitChange))}</strong>, starting from {money(result.startingBankroll)}.{result.bankroll.candidate.skippedNoOdds + result.bankroll.baseline.skippedNoOdds > 0 ? ` Picks without saved odds are skipped.` : ""} Paper backtest only — no real money moves.</p>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Overall historical wins do not change; only probability fit and the group clearing the cutoff change. This is an in-sample comparison, not proof of future accuracy. {result.retrospective ? "After-game captures are exploratory and cannot validate pregame calibration." : "Confirm any candidate on later unseen pregame slates before applying it."}</p>
    </div>}
  </section>;
}
