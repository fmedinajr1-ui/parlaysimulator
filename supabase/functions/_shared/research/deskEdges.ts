import { projectProp, passesMarginGate, opponentFactors, type MissingMate, type Reason } from "./nbaProjection.ts";
import { restProfile, type RestProfile } from "./restProfile.ts";
import { opponentAllowances, productionContext, type ProductionContext } from "./projectionContext.ts";
import { summarizePlayer, type GameLog, type PlayerSummary, type StatKey } from "./math.ts";
const STAT_OPTIONS = ["points", "rebounds", "assists", "threes_made", "pra"].map(key => ({key: key as StatKey}));
export interface EdgePick {
  player: string;
  stat: StatKey;
  line: number;
  /** Adjusted projection (kept as `median` for older callers). */
  median: number;
  edge: number;
  side: "over" | "under";
  /** Chance the recommended side wins. */
  hitRate: number;
  /** Expected profit per $1 at the posted odds. */
  ev: number;
  odds: number;
  notes: string[];
  reasons: Reason[];
  trend: PlayerSummary["trend"];
  lastDate: string;
  lastOpponent: string | null;
  tonight: string | null;
  /** How many of the last 10 games were played this season. */
  thisSeason: number;
  hitsL10: number;
  gamesL10: number;
  /** True = player's team is home tonight, false = he is on the road, null = venue unknown. */
  home: boolean | null;
  /** Player's team, full name (e.g. "Utah Jazz"). */
  team: string | null;
  /** Passes every pick rule (EV, win %, margin gate). */
  qualifies?: boolean;
  /** Season minutes per game of same-team players ruled Out tonight. */
  mateMinutesOut?: number;
  /** Days off and the rest adjustment used tonight. */
  rest: RestProfile;
  production?: ProductionContext;
}

export interface EdgeInputs {
  byPlayer: Map<string, GameLog[]>;
  propLines: Map<string, number>;
  lineOdds: Map<string, { over: number | null; under: number | null }>;
  tonight: Map<string, string>;
  homeTonight: Map<string, boolean>;
  injuries: Map<string, string>;
  teamOf: Map<string, string>;
  positionOf?: Map<string, string | null>;
  today: string;
  seasonStart?: string;
  limit?: number;
  /** Keep every projected prop (projections board), flagging which ones qualify. */
  all?: boolean;
  projectedMinutesModel?: boolean;
}

const SKIP_STATUS = /out|doubtful|suspend/i;

/** Ranks every prop with a line tonight by expected profit; Overs and Unders compete on the same scale. */
export function computeEdges(i: EdgeInputs): EdgePick[] {
  const seasonStart = i.seasonStart ?? "2026-10-01";
  const all: GameLog[] = [];
  for (const g of i.byPlayer.values()) all.push(...g);
  const allowances = opponentAllowances(all, i.today, seasonStart);
  const oppCache = new Map<StatKey, Map<string, number>>();
  const opp = (stat: StatKey) => oppCache.get(stat) ?? oppCache.set(stat, opponentFactors(all, stat, seasonStart)).get(stat) ?? new Map<string, number>();
  // Teammates ruled out tonight, by team.
  const outByTeam = new Map<string, string[]>();
  for (const [name, status] of i.injuries) {
    if (!/out/i.test(status)) continue;
    const real = [...i.teamOf.keys()].find((n) => n.toLowerCase() === name);
    const team = real && i.teamOf.get(real);
    if (team) outByTeam.set(team, [...(outByTeam.get(team) ?? []), real]);
  }
  const out: EdgePick[] = [];
  for (const [name, games] of i.byPlayer) {
    const lower = name.toLowerCase();
    if (SKIP_STATUS.test(i.injuries.get(lower) ?? "")) continue;
    const team = i.teamOf.get(name);
    for (const { key } of STAT_OPTIONS) {
      const k = `${lower}|${key}`;
      const line = i.propLines.get(k);
      if (!line) continue;
      const odds = i.lineOdds.get(k);
      const oppName = i.tonight.get(lower);
      const production = productionContext(games, i.today, oppName ? allowances.get(oppName) : undefined);
      const mates = (team && outByTeam.get(team)) || [];
      // Only teammates who've actually played this season free up a role.
      const matesOut: MissingMate[] = [];
      for (const m of mates) {
        const g = (i.byPlayer.get(m) ?? []).filter((x) => x.game_date >= seasonStart && Number(x.minutes_played) > 0);
        const s = summarizePlayer(g, key);
        if (!s || !g.length) continue;
        const minutes = g.reduce((t, x) => t + Number(x.minutes_played), 0) / g.length;
        matesOut.push({ name: m, position: i.positionOf?.get(m) ?? null, stat: s.l10.median, minutes });
      }
      const p = projectProp(games, key, line, odds?.over ?? -110, odds?.under ?? -110, {
        seasonStart, today: i.today, home: i.homeTonight.get(lower) ?? null,
        oppFactor: (oppName && opp(key).get(oppName)) || 1, teammatesOut: matesOut,
        position: i.positionOf?.get(name) ?? null,
        projectedMinutesModel: i.projectedMinutesModel,
        production,
      });
      if (!p) continue;
      const qualifies = p.ev >= 0.03 && p.prob >= 0.55 && passesMarginGate(key, p.projection, line);
      if (!qualifies && !i.all) continue;
      const s = summarizePlayer(games, key, line);
      if (!s) continue;
      out.push({
        player: name, stat: key, line, median: p.projection, edge: Math.round((p.projection - line) * 10) / 10,
        side: p.side, hitRate: p.prob, ev: p.ev, odds: p.odds, notes: p.notes, reasons: p.reasons, trend: s.trend,
        lastDate: s.lastDate, lastOpponent: s.lastOpponent, tonight: oppName ?? null, thisSeason: p.thisSeason, hitsL10: p.hitsL10, gamesL10: p.gamesL10,
        home: i.homeTonight.get(lower) ?? null, team: team ?? null,
        qualifies, mateMinutesOut: matesOut.reduce((t, m) => t + m.minutes, 0),
        rest: restProfile(games, i.today),
        production,
      });
    }
  }
  return out.sort((a, b) => b.ev - a.ev).slice(0, i.limit ?? 4);
}

const norm = (n: string) => n.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z ]/g, "").trim();

/** Maps game-log names onto current roster names (e.g. "Herb Jones" -> "Herbert Jones"); null = not on a roster. */
export function rosterResolver(roster: string[]) {
  const exact = new Map(roster.map((r) => [norm(r), r]));
  const memo = new Map<string, string | null>();
  return (name: string): string | null => {
    if (memo.has(name)) return memo.get(name) ?? null;
    const n = norm(name);
    const [first, ...rest] = n.split(" ");
    const last = rest.join(" ");
    const hits = roster.filter((r) => {
      const [rf, ...rr] = norm(r).split(" ");
      return rr.join(" ") === last && first.length >= 3 && (rf.startsWith(first) || first.startsWith(rf));
    });
    const out = exact.get(n) ?? (hits.length === 1 ? hits[0] : null);
    memo.set(name, out);
    return out;
  };
}

export type RawLine = { player_name: string; stat: string; line: number; book: string; event_label: string | null; over_price: number | null; under_price: number | null };

/** Implied probability of American odds. */
export const implied = (o: number | null) => (o == null ? 0.5 : o < 0 ? -o / (-o + 100) : 100 / (o + 100));
/** How far a line is from a fair 50/50 main line (0 = perfectly balanced). */
export const juice = (r: RawLine) => Math.abs(implied(r.over_price) - implied(r.under_price));

