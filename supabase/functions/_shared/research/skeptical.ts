import { statValue, type GameLog, type StatKey } from "./math.ts";

export function skepticalHistory(games: GameLog[], today: string, stat: StatKey, side: "over" | "under", line: number) {
  const history = [...new Map(games.filter(g => g.game_date < today && Number(g.minutes_played) > 0)
    .sort((a, b) => b.game_date.localeCompare(a.game_date)).map(g => [g.game_date, g])).values()]
    .slice(0, 10).map(g => ({ game_date: g.game_date, value: statValue(g, stat) }));
  return { history_l10: history, games_l10: history.length,
    hits_l10: history.filter(g => side === "over" ? g.value > line : g.value < line).length };
}

export interface SkepticalResult {
  game_date: string; player_name: string; stat: string; side: string; model_version: string;
  status: string;
}
export function skepticalAccuracy(rows: SkepticalResult[]) {
  const unique = [...new Map(rows.map(r => [`${r.game_date}|${r.player_name}|${r.stat}|${r.side}|${r.model_version}`, r])).values()];
  const count = (status: string) => unique.filter(r => r.status === status).length;
  const won = count("won"), lost = count("lost");
  return { total: unique.length, won, lost, push: count("push"), voided: count("void"), open: count("open"),
    accuracy: won + lost ? won / (won + lost) : null };
}

export function verifiedSkepticalMarket(
  pick: { game_date: string; player_name: string; stat: string; line: number }, today: string, team: string | undefined,
  events: { date: string; status?: { type?: { state?: string } }; competitions?: { competitors?: { team?: { displayName?: string } }[] }[] }[],
  lines: { player_name: string; stat: string; line: number | string; event_label: string; over_price: number | null; under_price: number | null }[],
  now: number,
) {
  if (pick.game_date !== today || !team) return null;
  const event = events.find(e => e.status?.type?.state === "pre" && new Date(e.date).getTime() > now
    && e.competitions?.[0]?.competitors?.some(c => c.team?.displayName === team));
  if (!event) return null;
  const names = event.competitions?.[0]?.competitors?.map(c => c.team?.displayName) ?? [];
  const market = lines.find(l => l.player_name.toLowerCase() === pick.player_name.toLowerCase() && l.stat === pick.stat
    && Number(l.line) === pick.line && l.event_label.split(" @ ").length === 2
    && l.event_label.split(" @ ").every(t => names.includes(t)));
  return market ? { starts_at: event.date, event_label: market.event_label } : null;
}