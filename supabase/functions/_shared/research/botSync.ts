import { buildBotStrategy, BOT_STRATEGY_VERSION } from "./botStrategy.ts";
import { MODEL_VERSION } from "./nbaProjection.ts";
import { researchAccuracy, type ResearchPick } from "./accuracyResearch.ts";

export interface ShelfPosition extends ResearchPick { odds: number | null; projection: number; trend: string; event_label: string; starts_at: string }

/** Only verified immutable pregame shelf rows can fund new simulated positions. */
export function botTargetsFromShelf(rows: ShelfPosition[], today: string, now: number, lines: {player_name: string; stat: string; line: number; over_price: number | null; under_price: number | null}[]) {
  const eligible = rows.filter(r => r.game_date === today && r.model_version === MODEL_VERSION && new Date(r.starts_at).getTime() > now
    && lines.some(l => l.player_name.toLowerCase() === r.player_name.toLowerCase() && l.stat === r.stat && Number(l.line) === Number(r.line)
      && (r.side === "over" ? l.over_price : l.under_price) === r.odds));
  return buildBotStrategy(eligible.flatMap(r => r.odds == null || (r.side !== "over" && r.side !== "under") ? [] : [{
    player: r.player_name, stat: r.stat, side: r.side, line: Number(r.line), odds: r.odds,
    median: Number(r.projection), hitRate: Number(r.win_prob), hitsL10: r.hits_l10, gamesL10: r.games_l10,
    trend: r.trend, tonight: r.event_label,
    ev: Number(r.win_prob) * (r.odds > 0 ? r.odds / 100 : 100 / -r.odds) - (1 - Number(r.win_prob)),
  }])).map(({pick, warnings, riskScore, stakeUnits, rank}) => ({
    game_date: today, player_name: pick.player, stat: pick.stat, side: pick.side, line: pick.line, odds: pick.odds,
    projection: pick.median, win_prob: pick.hitRate, model_version: MODEL_VERSION, strategy_version: BOT_STRATEGY_VERSION,
    warnings, warning_count: warnings.length, risk_score: riskScore, stake_units: stakeUnits, rank,
  }));
}

// Existing positions are immutable; later desk visits never add extra daily exposure.
export async function syncBotFromShelf(sb: any, today: string, now = Date.now()) {
  const {data: existing, error: existingError} = await sb.from("research_bot_picks").select("id").eq("game_date", today).eq("strategy_version", BOT_STRATEGY_VERSION);
  if (existingError) throw existingError;
  if (existing?.length) return { logged: 0, preserved: existing.length };
  const [{data: shelf, error}, {data: lines, error: lineError}] = await Promise.all([
    sb.from("research_skeptical_picks").select("*").eq("game_date", today).eq("model_version", MODEL_VERSION),
    sb.from("research_prop_lines").select("player_name,stat,line,over_price,under_price").eq("game_date", today).limit(10000),
  ]);
  if (error || lineError) throw error ?? lineError;
  const picks = botTargetsFromShelf(shelf ?? [], today, now, lines ?? []);
  if (picks.length) {
    const {error: saveError} = await sb.from("research_bot_picks").upsert(picks, {onConflict: "game_date,player_name,stat,side,strategy_version", ignoreDuplicates: true});
    if (saveError) throw saveError;
  }
  return {logged: picks.length};
}

/** Same grading run, but distinct provenance and full-shelf versus subset denominators. */
export async function botResearchReport(sb: any) {
  const [{data: picks, error}, {data: reviews, error: reviewError}] = await Promise.all([
    sb.from("research_skeptical_picks").select("*").eq("model_version", MODEL_VERSION).limit(10000),
    sb.from("research_skeptical_reviews").select("*").eq("model_version", MODEL_VERSION).limit(10000),
  ]);
  if (error || reviewError) throw error ?? reviewError;
  const brief = (rows: ResearchPick[], kind: "pregame" | "review") => {
    const r = researchAccuracy(rows, kind);
    return {total:r.total, decided:r.n, won:r.won, lost:r.lost, actual:r.actual, predicted:r.predicted, retrospective:r.retrospective, groups:r.groups, proposals:r.proposals};
  };
  return {pregame:brief(picks ?? [], "pregame"), retrospective:brief(reviews ?? [], "review"), calibrationApplied:false};
}