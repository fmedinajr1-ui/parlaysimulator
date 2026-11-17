import { useMemo } from "react";
import { auditSlip } from "@/utils/slipMonteCarlo";
import type { SlipLeg } from "@/utils/betSlip";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const odds = (o: number) => (o > 0 ? `+${o}` : `${o}`);

export function MonteCarloSlipAudit({ legs }: { legs: SlipLeg[] }) {
  const a = useMemo(() => auditSlip(legs), [legs]);
  const rows: [string, string][] = [
    ["Simulated (10,000 runs)", `${pct(a.simProb)} · fair ${odds(a.fairOdds)}`],
    ["Simple multiply", pct(a.naiveProb)],
    ["Book implied", pct(a.bookProb)],
    ["Same-game effect", `${a.correlationImpact >= 0 ? "+" : ""}${(a.correlationImpact * 100).toFixed(0)}%`],
    ["Expected value", `${a.ev >= 0 ? "+" : ""}${(a.ev * 100).toFixed(1)}%`],
  ];
  return (
    <div className="space-y-1 rounded-md border border-[hsl(var(--desk-line))] p-3">
      <div className="desk-label">Monte Carlo check</div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between text-xs"><span className="text-[hsl(var(--desk-muted))]">{k}</span><span className="desk-mono">{v}</span></div>
      ))}
      {!a.usedModel && <p className="text-xs text-[hsl(var(--desk-muted))]">No model chance on these legs — using book prices.</p>}
      {a.warning && <p className="rounded-md border border-[hsl(var(--desk-amber))] p-2 text-xs text-[hsl(var(--desk-amber))]">{a.warning}</p>}
    </div>
  );
}
