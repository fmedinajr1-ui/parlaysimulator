import { useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runCalibrationExperiment, type CalibrationMetrics } from "@/utils/calibrationExperiment";
import type { ResearchPick } from "@/utils/accuracyResearch";

const pct = (value: number | null) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
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
  const [submitted, setSubmitted] = useState<{ winChanceWeight: number; l10Weight: number; cutoff: number } | null>(null);
  const result = useMemo(() => submitted ? runCalibrationExperiment(picks, kind, submitted) : null, [picks, kind, submitted]);
  const invalidWeights = winWeight + l10Weight <= 0;

  return <section aria-label="Win chance and L10 calibration experiment" className="mt-5 border-y border-border py-4">
    <div className="flex items-start gap-2">
      <FlaskConical size={17} className="mt-0.5 shrink-0 text-primary" />
      <div>
        <h4 className="text-sm font-semibold">Calibration experiment</h4>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Blend the saved skeptical win chance with its real L10 record. Nothing here changes live picks or saved probabilities.</p>
      </div>
    </div>
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
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button size="sm" variant="outline" disabled={!picks.length || invalidWeights} onClick={() => setSubmitted({ winChanceWeight: winWeight, l10Weight, cutoff: cutoff / 100 })}>Run experiment</Button>
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
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Overall historical wins do not change; only probability fit and the group clearing the cutoff change. This is an in-sample comparison, not proof of future accuracy. {result.retrospective ? "After-game captures are exploratory and cannot validate pregame calibration." : "Confirm any candidate on later unseen pregame slates before applying it."}</p>
    </div>}
  </section>;
}
