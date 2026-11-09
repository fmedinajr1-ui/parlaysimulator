import { gradeResearchPick } from "./grading.ts";

/** Box scores are imported only for final games. Missing players remain pending, never guessed void. */
export async function gradeSkepticalPicks(sb: any, today: string) {
  const { data: open, error } = await sb.from("research_skeptical_picks").select("*").eq("status", "open").lt("game_date", today).limit(10000);
  if (error) throw error;
  let graded = 0, waiting = 0;
  for (const pick of open ?? []) {
    const { data: game, error: readError } = await sb.from("nba_player_game_logs")
      .select("minutes_played,points,rebounds,assists,threes_made").ilike("player_name", pick.player_name).eq("game_date", pick.game_date).maybeSingle();
    if (readError) throw readError;
    if (!game) { waiting++; continue; }
    const result = gradeResearchPick(pick, game);
    const { error: writeError } = await sb.from("research_skeptical_picks")
      .update({ ...result, settled_at: new Date().toISOString() }).eq("id", pick.id).eq("status", "open");
    if (writeError) throw writeError;
    graded++;
  }
  return { graded, waiting };
}