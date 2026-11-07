// deno-lint-ignore-file no-explicit-any
export async function gradeMinutes(sb: any, today: string) {
  const { data: rows, error } = await sb.from("research_minutes_log").select("id,player_name,game_date").eq("status", "open").lt("game_date", today).limit(5000);
  if (error) throw error;
  let graded = 0;
  for (const row of rows ?? []) {
    const { data: game, error: readError } = await sb.from("nba_player_game_logs").select("minutes_played").eq("game_date", row.game_date).ilike("player_name", row.player_name).maybeSingle();
    if (readError) throw readError;
    const minutes = Number(game?.minutes_played);
    const expired = Date.parse(`${today}T12:00:00Z`) - Date.parse(`${row.game_date}T12:00:00Z`) > 3 * 86400000;
    if (!game && !expired) continue;
    const { error: updateError } = await sb.from("research_minutes_log").update({ actual_minutes: game ? minutes : null,
      status: minutes > 0 ? "graded" : "excluded", settled_at: new Date().toISOString() }).eq("id", row.id);
    if (updateError) throw updateError;
    graded++;
  }
  return { graded };
}