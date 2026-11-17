// deno-lint-ignore-file no-explicit-any
import { noVig, decimal, paceFatigue, sharpStructure, type GameInput, type TeamGame } from "./gameModels.ts";

const etDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const METHODS = [["paceFatigue", "pace_fatigue"], ["sharpStructure", "sharp_structure"]] as const;

/** Tonight's totals and moneylines with both of last year's methods side by side. */
export async function gameBoard(sb: any, day: string) {
  const key = Deno.env.get("THE_ODDS_API_KEY");
  if (!key) return { error: "Odds key missing", games: [] };
  const res = await fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/odds?apiKey=${key}&regions=us,eu&markets=h2h,spreads,totals&bookmakers=pinnacle,fanduel,draftkings&oddsFormat=american`);
  if (!res.ok) return { error: `Odds service ${res.status}`, games: [] };
  const events = ((await res.json()) as any[]).filter((e) => etDay(new Date(e.commence_time)) === day);
  const { data: roster } = await sb.from("research_player_teams").select("player_name,team");
  const teamOf = new Map<string, string>((roster ?? []).map((r: any) => [r.player_name, r.team]));
  const logs: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("nba_player_game_logs").select("id,player_name,game_date,opponent,is_home,points,minutes_played,field_goals_attempted,free_throws_attempted,offensive_rebounds,turnovers")
      .gte("game_date", "2026-10-01").lt("game_date", day).order("game_date").order("player_name").order("id").range(from, from + 999);
    logs.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const agg = new Map<string, { team: string; date: string; opp: string; home: boolean; pts: number; poss: number; minutes: number }>();
  for (const l of logs) {
    const team = teamOf.get(l.player_name); if (!team) continue;
    const k = `${team}|${l.game_date}`;
    const a = agg.get(k) ?? { team, date: l.game_date, opp: l.opponent, home: !!l.is_home, pts: 0, poss: 0, minutes: 0 };
    a.pts += l.points ?? 0; a.minutes += l.minutes_played ?? 0;
    a.poss += (l.field_goals_attempted ?? 0) + 0.44 * (l.free_throws_attempted ?? 0) - (l.offensive_rebounds ?? 0) + (l.turnovers ?? 0);
    agg.set(k, a);
  }
  const byTeam = new Map<string, TeamGame[]>();
  for (const a of agg.values()) {
    const opp = agg.get(`${a.opp}|${a.date}`);
    if (!opp || a.minutes < 200) continue;
    const list = byTeam.get(a.team) ?? [];
    list.push({ date: a.date, pts: a.pts, oppPts: opp.pts, poss: (a.poss + opp.poss) / 2, minutes: a.minutes, home: a.home });
    byTeam.set(a.team, list);
  }
  const alias = (n: string) => (n === "Los Angeles Clippers" ? "LA Clippers" : n);
  const games = events.map((e) => {
    const rec = (e.bookmakers ?? []).filter((bk: any) => bk.key !== "pinnacle");
    const pin = (e.bookmakers ?? []).find((bk: any) => bk.key === "pinnacle");
    const mk = (bk: any, m: string) => bk?.markets?.find((x: any) => x.key === m)?.outcomes ?? [];
    const best = (m: string, name: string, point?: number) => {
      let out: { odds: number; book: string } | null = null;
      for (const bk of rec) for (const o of mk(bk, m)) if (o.name === name && (point == null || o.point === point) && (!out || o.price > out.odds)) out = { odds: o.price, book: bk.title };
      return out;
    };
    const totals = rec.flatMap((bk: any) => mk(bk, "totals").filter((o: any) => o.name === "Over").map((o: any) => o.point));
    const total = totals.length ? totals.sort((a: number, b: number) => a - b)[Math.floor(totals.length / 2)] : null;
    const spread = rec.flatMap((bk: any) => mk(bk, "spreads").filter((o: any) => o.name === e.home_team).map((o: any) => o.point))[0] ?? null;
    // Sharp fair price: Pinnacle, otherwise the average no-vig of the US books.
    const fair = (bks: any[]) => {
      const hw: number[] = [], ov: number[] = []; let tot: number | null = null;
      for (const bk of bks) {
        const h = mk(bk, "h2h"); const hh = h.find((o: any) => o.name === e.home_team), aa = h.find((o: any) => o.name === e.away_team);
        if (hh && aa) hw.push(noVig(hh.price, aa.price));
        const t = mk(bk, "totals"); const o = t.find((x: any) => x.name === "Over"), u = t.find((x: any) => x.name === "Under");
        if (o && u && (total == null || o.point === total || pin === bk)) { ov.push(noVig(o.price, u.price)); tot = o.point; }
      }
      const m = (v: number[]) => (v.length ? v.reduce((s, n) => s + n, 0) / v.length : null);
      return { homeWin: m(hw), over: m(ov), total: tot };
    };
    const sharp = pin ? { source: "Pinnacle", ...fair([pin]) } : { source: "US book average (no Pinnacle)", ...fair(rec) };
    const g: GameInput = {
      date: day, home: e.home_team, away: e.away_team, start: e.commence_time,
      homeGames: byTeam.get(alias(e.home_team)) ?? [], awayGames: byTeam.get(alias(e.away_team)) ?? [],
      total, over: total == null ? null : best("totals", "Over", total), under: total == null ? null : best("totals", "Under", total),
      homeSpread: spread, homeML: best("h2h", e.home_team), awayML: best("h2h", e.away_team), sharp,
    };
    return { home: g.home, away: g.away, start: g.start, total, homeSpread: spread, homeML: g.homeML, awayML: g.awayML, paceFatigue: paceFatigue(g), sharpStructure: sharpStructure(g) };
  });
  return { day, games };
}


/** Saves each method's plays for games not started yet; the first snapshot per game/method/market is kept. */
export async function saveGamePlays(sb: any, day: string, games: any[]) {
  const now = Date.now();
  const rows: any[] = [];
  for (const g of games ?? []) {
    if (g.start && Date.parse(g.start) <= now) continue;
    for (const [k, method] of METHODS) for (const p of g[k]?.plays ?? []) {
      rows.push({ game_date: day, home: g.home, away: g.away, start_time: g.start ?? null, method, market: p.market, pick: p.pick, odds: p.odds, book: p.book, chance: p.chance, reason: p.reason });
    }
  }
  if (!rows.length) return { saved: 0 };
  const { error } = await sb.from("research_game_plays").upsert(rows, { onConflict: "game_date,home,away,method,market", ignoreDuplicates: true });
  if (error) throw error;
  return { saved: rows.length };
}

/** Pure: grade one play from final scores. 1-unit stake. */
export function gradeGamePlay(p: { market: string; pick: string; odds: number; home: string; away: string }, homeScore: number, awayScore: number) {
  let status: "won" | "lost" | "push";
  if (p.market === "total") {
    const [side, num] = p.pick.split(" "); const line = Number(num); const t = homeScore + awayScore;
    status = t === line ? "push" : (side === "Over" ? t > line : t < line) ? "won" : "lost";
  } else {
    const team = p.pick.replace(/ ML$/, "");
    const homeWon = homeScore > awayScore;
    status = (team === p.home) === homeWon ? "won" : "lost";
  }
  const profit = status === "won" ? decimal(p.odds) - 1 : status === "lost" ? -1 : 0;
  return { status, profit_units: Math.round(profit * 1000) / 1000 };
}

const nick = (n: string) => n.split(" ").pop()!.toLowerCase();

/** Grades open game plays from ESPN final scores; voids after 3 days with no final. */
export async function gradeGamePlays(sb: any, today: string) {
  const { data: open, error } = await sb.from("research_game_plays").select("*").eq("status", "open").lt("game_date", today).limit(1000);
  if (error) throw error;
  const byDay = new Map<string, any[]>();
  for (const p of open ?? []) byDay.set(p.game_date, [...(byDay.get(p.game_date) ?? []), p]);
  let graded = 0, waiting = 0;
  const cutoff = etDay(new Date(Date.now() - 3 * 86400000));
  for (const [day, plays] of byDay) {
    const r = await fetch(`${ESPN}/scoreboard?dates=${day.replaceAll("-", "")}`);
    const events = r.ok ? ((await r.json()).events ?? []) : [];
    const finals = new Map<string, { home: number; away: number }>();
    for (const ev of events) {
      if (!ev.status?.type?.completed) continue;
      const c = ev.competitions?.[0]?.competitors ?? [];
      const h = c.find((x: any) => x.homeAway === "home"), a = c.find((x: any) => x.homeAway === "away");
      if (h && a) finals.set(`${nick(h.team.displayName)}|${nick(a.team.displayName)}`, { home: Number(h.score), away: Number(a.score) });
    }
    for (const p of plays) {
      const f = finals.get(`${nick(p.home)}|${nick(p.away)}`);
      if (!f) {
        if (day < cutoff) { await sb.from("research_game_plays").update({ status: "void", settled_at: new Date().toISOString() }).eq("id", p.id); graded++; }
        else waiting++;
        continue;
      }
      const g = gradeGamePlay(p, f.home, f.away);
      await sb.from("research_game_plays").update({ ...g, home_score: f.home, away_score: f.away, settled_at: new Date().toISOString() }).eq("id", p.id);
      graded++;
    }
  }
  return { graded, waiting };
}

/** Running record per method and market, plus recent settled plays. */
export async function gameRecord(sb: any) {
  const { data } = await sb.from("research_game_plays").select("game_date,home,away,method,market,pick,odds,status,home_score,away_score,profit_units")
    .order("game_date", { ascending: false }).limit(2000);
  const rows = data ?? [];
  const summary: Record<string, any> = {};
  for (const [, method] of METHODS) for (const market of ["all", "total", "moneyline"]) {
    const s = rows.filter((r: any) => r.method === method && (market === "all" || r.market === market));
    const won = s.filter((r: any) => r.status === "won").length, lost = s.filter((r: any) => r.status === "lost").length;
    const push = s.filter((r: any) => r.status === "push").length, open = s.filter((r: any) => r.status === "open").length;
    const units = s.reduce((t: number, r: any) => t + Number(r.profit_units ?? 0), 0);
    summary[`${method}:${market}`] = { won, lost, push, open, units: Math.round(units * 100) / 100 };
  }
  return { summary, recent: rows.filter((r: any) => r.status !== "open").slice(0, 30) };
}
