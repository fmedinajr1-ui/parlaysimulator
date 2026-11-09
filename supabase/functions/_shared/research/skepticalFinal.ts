import { gradeResearchPick } from "./grading.ts";

/** Require a final game and an explicit athlete box-score row. Never infer a DNP from absence. */
export function skepticalFinal(pick: {player_name: string; stat: string; side: string; line: number}, summary: any) {
  if (!summary.header?.competitions?.[0]?.status?.type?.completed) return null;
  for (const team of summary.boxscore?.players ?? []) {
    const stats = team.statistics?.[0];
    if (!stats) continue;
    const athlete = (stats.athletes ?? []).find((a: any) => a.athlete?.displayName?.toLowerCase() === pick.player_name.toLowerCase());
    if (!athlete) continue;
    const raw = (key: string) => athlete.stats?.[stats.keys.indexOf(key)];
    const num = (key: string) => {
      const value = raw(key);
      return value == null || value === "" ? null : Number(value);
    };
    const minutes = num("minutes");
    if (athlete.didNotPlay) return {status:"void",result_value:null};
    const threes = raw("threePointFieldGoalsMade-threePointFieldGoalsAttempted");
    const game = {minutes_played:minutes,points:num("points"),rebounds:num("rebounds"),assists:num("assists"),threes_made:threes == null ? null : Number(String(threes).split("-")[0])};
    const needed = pick.stat === "pra" ? [game.points,game.rebounds,game.assists] : [game[pick.stat as keyof typeof game]];
    if (minutes == null || needed.some(v=>v == null || !Number.isFinite(v))) return null;
    return gradeResearchPick(pick,game);
  }
  return null;
}