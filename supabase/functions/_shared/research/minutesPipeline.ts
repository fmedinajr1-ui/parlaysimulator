// deno-lint-ignore-file no-explicit-any
import { projectMinutes, type MinutesGame } from "./projectedMinutes.ts";
import { MINUTES_FORECAST_VERSION } from "./minutesValidation.ts";

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const lower = (s: string) => s.trim().toLowerCase();

export interface ForecastInput {
  today: string;
  preTeams: Set<string>;
  lines: { player_name: string }[];
  roster: { player_name: string; team: string }[];
  injuries: { player_name: string; status: string }[];
  logs: (MinutesGame & { player_name: string })[];
}

/** Builds only prospective, pregame forecasts from players who have a posted line. */
export function buildMinutesForecasts(input: ForecastInput) {
  const rosterByName = new Map(input.roster.map((r) => [lower(r.player_name), r]));
  const linedNames = new Set(input.lines.map((l) => lower(l.player_name)));
  const gamesByPlayer = new Map<string, ForecastInput["logs"]>();
  for (const g of input.logs) {
    const key = lower(g.player_name);
    gamesByPlayer.set(key, [...(gamesByPlayer.get(key) ?? []), g]);
  }
  const seasonStart = `${Number(input.today.slice(0, 4)) - (Number(input.today.slice(5, 7)) >= 10 ? 0 : 1)}-10-01`;
  const outByTeam = new Map<string, number>();
  for (const injury of input.injuries) {
    if (!/out/i.test(injury.status)) continue;
    const player = rosterByName.get(lower(injury.player_name));
    if (!player) continue;
    const season = (gamesByPlayer.get(lower(player.player_name)) ?? [])
      .filter((g) => g.game_date >= seasonStart && g.game_date < input.today && Number(g.minutes_played) > 0);
    if (!season.length) continue;
    const average = season.reduce((n, g) => n + Number(g.minutes_played), 0) / season.length;
    outByTeam.set(player.team, (outByTeam.get(player.team) ?? 0) + average);
  }
  const forecasts = [];
  for (const key of linedNames) {
    const player = rosterByName.get(key);
    if (!player || !input.preTeams.has(player.team)) continue;
    const projected = projectMinutes(gamesByPlayer.get(key) ?? [], input.today, outByTeam.get(player.team) ?? 0);
    if (!projected) continue;
    forecasts.push({
      game_date: input.today,
      player_name: player.player_name,
      team: player.team,
      projected_minutes: projected.minutes,
      baseline_minutes: projected.l10,
      forecast_version: MINUTES_FORECAST_VERSION,
    });
  }
  return forecasts.sort((a, b) => a.player_name.localeCompare(b.player_name));
}

async function getJson(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}

/** Runs inside research-daily; no additional schedule or paid API call. */
export async function snapshotMinutes(sb: any, today: string, fetchJson: (url: string) => Promise<any> = getJson) {
  const board = await fetchJson(`${ESPN}/scoreboard?dates=${today.replace(/-/g, "")}`);
  const preTeams = new Set<string>();
  for (const event of board.events ?? []) {
    if (event.status?.type?.state !== "pre" || !(new Date(event.date).getTime() > Date.now())) continue;
    for (const competitor of event.competitions?.[0]?.competitors ?? []) preTeams.add(competitor.team?.displayName);
  }
  const [lineResult, rosterResult, injuryResult] = await Promise.all([
    sb.from("research_prop_lines").select("player_name").eq("game_date", today).limit(5000),
    sb.from("research_player_teams").select("player_name,team").limit(2000),
    sb.from("nba_injury_reports").select("player_name,status").eq("game_date", today).limit(1000),
  ]);
  for (const result of [lineResult, rosterResult, injuryResult]) if (result.error) throw result.error;

  const sinceDate = new Date(`${today}T12:00:00Z`); sinceDate.setUTCDate(sinceDate.getUTCDate() - 120);
  const since = sinceDate.toISOString().slice(0, 10);
  const logs: ForecastInput["logs"] = [];
  for (let from = 0; from < 40000; from += 1000) {
    const { data, error } = await sb.from("nba_player_game_logs").select("player_name,game_date,minutes_played")
      .gte("game_date", since).lt("game_date", today).order("game_date", { ascending: false }).order("player_name").order("id").range(from, from + 999);
    if (error) throw error;
    logs.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const forecasts = buildMinutesForecasts({ today, preTeams, lines: lineResult.data ?? [], roster: rosterResult.data ?? [], injuries: injuryResult.data ?? [], logs });
  if (!forecasts.length) return { logged: 0, pregameTeams: preTeams.size };
  const { error } = await sb.from("research_minutes_log").upsert(forecasts, { onConflict: "game_date,player_name,forecast_version", ignoreDuplicates: true });
  if (error) throw error;
  return { logged: forecasts.length, pregameTeams: preTeams.size };
}
