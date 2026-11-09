export interface ResearchPick {
  id: string; game_date: string; player_name: string; stat: string; side: string; line: number;
  win_prob: number; hits_l10: number; games_l10: number; warnings: string[];
  status: string; result_value: number | null; model_version: string; odds?: number | null;
}
export const researchLabel = (stat: string) => stat === "pra" ? "Points + rebounds + assists" : stat === "threes_made" ? "Threes" : stat.charAt(0).toUpperCase() + stat.slice(1);

/** Observational diagnostics only: no weight updates, no causal claims, no mixed model versions. */
export function researchAccuracy(input: ResearchPick[], kind: "pregame" | "review") {
  const rows = [...new Map(input.map(r => [`${r.game_date}|${r.player_name}|${r.stat}|${r.side}|${r.model_version}`,r])).values()];
  const decided = rows.filter(r => (r.status === "won" || r.status === "lost") && Number.isFinite(r.win_prob) && r.win_prob >= 0 && r.win_prob <= 1 && r.result_value != null);
  const mean = (values: number[]) => values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
  const groups = new Map<string,ResearchPick[]>();
  for (const r of decided) {
    const labels = [researchLabel(r.stat), r.side === "over" ? "Over" : "Under"];
    if (r.warnings.some(w=>w.startsWith("Model says"))) labels.push("Model / L10 disagreement");
    if (r.warnings.some(w=>w.includes("cold right now"))) labels.push("Cold Over");
    if (r.warnings.some(w=>w.includes("hot right now"))) labels.push("Hot Under");
    if (r.warnings.length > 1) labels.push("Multiple warnings");
    for (const label of labels) groups.set(label,[...(groups.get(label) ?? []),r]);
  }
  const metrics = (picks: ResearchPick[]) => {
    const won = picks.filter(r=>r.status === "won").length;
    return { n:picks.length,won,lost:picks.length-won,actual:picks.length ? won/picks.length : null,
      predicted:mean(picks.map(r=>r.win_prob)), brier:mean(picks.map(r=>(r.win_prob-(r.status === "won" ? 1 : 0))**2)) };
  };
  const buckets = [0,0.5,0.6,0.7,0.8,0.9].map((lo,i,a)=>({label:`${Math.round(lo*100)}–${Math.round((a[i+1] ?? 1)*100)}%`,
    ...metrics(decided.filter(r=>r.win_prob>=lo && (i===a.length-1 ? r.win_prob<=1 : r.win_prob<(a[i+1] ?? 1))))})).filter(b=>b.n);
  const wins = decided.filter(r=>r.status === "won").map(r=>({pick:r,
    margin:r.side === "over" ? Number(r.result_value)-Number(r.line) : Number(r.line)-Number(r.result_value),
    history:r.games_l10 ? r.hits_l10/r.games_l10 : null,
    explanation:`${r.result_value} ${researchLabel(r.stat).toLowerCase()} ${r.side === "over" ? "exceeded" : "stayed below"} the ${r.line} line. This side previously hit ${r.hits_l10}/${r.games_l10}; the warning described conflicting evidence, not a certain loss.`,
  }));
  return {...metrics(decided),total:rows.length,excluded:rows.length-decided.length,slates:new Set(decided.map(r=>r.game_date)).size,
    playerGames:new Set(decided.map(r=>`${r.game_date}|${r.player_name}`)).size,
    retrospective:kind === "review",groups:[...groups].map(([label,picks])=>({label,...metrics(picks)})),buckets,wins,
    proposals:[
      "Compare model/L10 disagreement against trend-only warnings before changing either weight; a streak warning is not a hard veto.",
      "Test probability shrinkage toward the no-vig market on future pregame slates; use lower forecast error, not tonight’s winning names, to choose a candidate.",
      "Keep player-specific weight changes on hold: several props from one player are correlated, not independent evidence.",
      "Save projected minutes, shot volume, opponent allowances and injuries before tip-off, then compare them with final box scores to investigate mechanisms. These records alone do not prove why a player won.",
    ]};
}