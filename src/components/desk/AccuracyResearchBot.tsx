import {useMemo,useState} from "react";
import {Bot,FlaskConical} from "lucide-react";
import {Button} from "@/components/ui/button";
import {researchAccuracy,researchLabel,type ResearchPick} from "@/utils/accuracyResearch";
const pct=(n:number|null)=>n==null ? "—" : `${(100*n).toFixed(1)}%`;
export function AccuracyResearchBot({picks,kind}:{picks:ResearchPick[];kind:"pregame"|"review"}) {
 const [ran,setRan]=useState(false);
 const report=useMemo(()=>researchAccuracy(picks,kind),[picks,kind]);
 return <section aria-label="Accuracy research bot" className="my-4 border-y border-border py-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-semibold"><Bot size={18} className="text-primary"/>Accuracy research bot</h3><Button size="sm" variant="outline" disabled={!report.n} onClick={()=>setRan(true)}><FlaskConical size={16}/>Research results</Button></div>
  {ran && <>
   <p role="status" className="mt-3 text-sm">{report.n} decided props · {report.slates} slate{report.slates===1 ? "" : "s"} · {report.playerGames} player-games · {report.excluded} excluded</p>
   <p className="mt-2 text-xs text-muted-foreground">{report.retrospective ? "After-game exploratory research. Captured probabilities are not verified pregame forecasts; these results cannot validate new weights." : "Pregame evidence only. Validate candidate weights on later, unseen slates before changing picks."} Multiple props from the same player share risk.</p>
   <div className="my-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
    {[["Win rate",pct(report.actual)],["Average forecast",pct(report.predicted)],["Forecast gap",report.actual!=null && report.predicted!=null ? `${((report.predicted-report.actual)*100).toFixed(1)} points` : "—"],[report.retrospective ? "Exploratory error" : "Forecast error",report.brier?.toFixed(3) ?? "—"]].map(([label,value])=><div key={label}><div className="desk-label">{label}</div><p className="mt-1 font-mono text-lg">{value}</p></div>)}
   </div>
   <h4 className="mt-4 text-sm font-semibold">What survived skepticism?</h4>
   <div className="mt-2 overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-muted-foreground"><th className="py-2 text-left">Group</th><th className="p-2 text-right">W–L</th><th className="p-2 text-right">Actual</th><th className="p-2 text-right">Forecast</th></tr></thead><tbody>{report.groups.map(g=><tr key={g.label} className="border-t border-border"><td className="py-2">{g.label}</td><td className="p-2 text-right font-mono">{g.won}–{g.lost}</td><td className="p-2 text-right font-mono">{pct(g.actual)}</td><td className="p-2 text-right font-mono">{pct(g.predicted)}</td></tr>)}</tbody></table></div>
   <p className="mt-2 text-xs text-muted-foreground">Warning groups overlap; their counts must not be added together. Outcomes show association, not causation.</p>
   <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">Probability reliability</summary><div className="mt-2 space-y-2">{report.buckets.map(b=><p key={b.label} className="text-xs">{b.label}: {b.won}/{b.n} won · Actual {pct(b.actual)} · Forecast {pct(b.predicted)}</p>)}</div></details>
   <h4 className="mt-4 text-sm font-semibold">Calibration research queue · Not applied</h4><ul className="mt-2 space-y-2 text-xs text-muted-foreground">{report.proposals.map(p=><li key={p}>{p}</li>)}</ul>
   <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">Review the {report.wins.length} skeptical wins</summary><div className="mt-2 divide-y divide-border">{report.wins.map(({pick,margin,explanation})=><article key={pick.id} className="py-3"><h5 className="text-sm font-semibold">{pick.player_name} · {pick.side} {pick.line} {researchLabel(pick.stat)}</h5><p className="mt-1 text-xs">Won by {margin.toFixed(1)} · Historical hit {pick.hits_l10}/{pick.games_l10}</p><p className="mt-1 text-xs text-muted-foreground">{explanation}</p><p className="mt-1 text-xs text-destructive">{pick.warnings.join(" ")}</p></article>)}</div></details>
  </>}
 </section>;
}