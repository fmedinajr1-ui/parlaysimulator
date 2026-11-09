export interface ResearchGameResult {
  minutes_played: number | string;
  points: number | string;
  rebounds: number | string;
  assists: number | string;
  threes_made: number | string;
}

/** One grading rule for real bets, model picks and Oversight Bot positions. */
export function gradeResearchPick(
  pick: { stat: string; side: "over" | "under"; line: number | string },
  game: ResearchGameResult,
): { status: "won" | "lost" | "push" | "void"; result_value: number } {
  const n = (v: number | string) => Number(v) || 0;
  const result_value = pick.stat === "pra"
    ? n(game.points) + n(game.rebounds) + n(game.assists)
    : n(game[pick.stat as keyof ResearchGameResult] ?? 0);
  const line = Number(pick.line);
  const status = !(n(game.minutes_played) > 0) ? "void"
    : result_value === line ? "push"
      : (pick.side === "over" ? result_value > line : result_value < line) ? "won" : "lost";
  return { status, result_value };
}
