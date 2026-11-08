// deno-lint-ignore-file no-explicit-any
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

async function getJson(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

export async function gradeMinutes(sb: any, today: string, fetchJson: (url: string) => Promise<any> = getJson) {
  const { data: rows, error } = await sb.from("research_minutes_log").select("id,player_name,game_date,team").eq("status", "open").lt("game_date", today).limit(5000);
  if (error) throw error;
  const boards = new Map<string, any>();
  const summaries = new Map<string, any>();
  let graded = 0;
  for (const row of rows ?? []) {
    const { data: game, error: readError } = await sb.from("nba_player_game_logs").select("minutes_played").eq("game_date", row.game_date).ilike("player_name", row.player_name).maybeSingle();
    if (readError) throw readError;
    const minutes = Number(game?.minutes_played);
    const expired = Date.parse(`${today}T12:00:00Z`) - Date.parse(`${row.game_date}T12:00:00Z`) > 3 * 86400000;
    let missingConfirmed = expired;
    if (!game && !expired && row.team) {
      try {
        if (!boards.has(row.game_date)) boards.set(row.game_date, await fetchJson(`${ESPN}/scoreboard?dates=${row.game_date.replace(/-/g, "")}`));
        const board = boards.get(row.game_date);
        const final = (board?.events ?? []).find((event: any) => event.status?.type?.completed &&
          (event.competitions?.[0]?.competitors ?? []).some((c: any) => c.team?.displayName === row.team));
        if (final) {
          if (!summaries.has(final.id)) summaries.set(final.id, await fetchJson(`${ESPN}/summary?event=${final.id}`));
          const athletes = (summaries.get(final.id)?.boxscore?.players ?? [])
            .flatMap((team: any) => team.statistics?.[0]?.athletes ?? []);
          if (athletes.length) {
            const athlete = athletes.find((a: any) => String(a.athlete?.displayName).toLowerCase() === String(row.player_name).toLowerCase());
            // A played athlete with missing DB stats waits for ingestion; absent/DNP athletes do not hold the slate open.
            missingConfirmed = !athlete || !!athlete.didNotPlay || !athlete.stats?.length;
          }
        }
      } catch { /* A feed failure must not turn a played forecast into a DNP. */ }
    }
    if (!game && !missingConfirmed) continue;
    const { error: updateError } = await sb.from("research_minutes_log").update({ actual_minutes: game ? minutes : null,
      status: minutes > 0 ? "graded" : "excluded", settled_at: new Date().toISOString() }).eq("id", row.id);
    if (updateError) throw updateError;
    graded++;
  }
  return { graded };
}
