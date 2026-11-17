/**
 * NBA totals and moneylines: last year's two methods, side by side.
 * Method A "Pace & Fatigue" and Method B "Sharp & Structure". Pure and display-only.
 */
export interface TeamGame { date: string; pts: number; oppPts: number; poss: number; minutes: number; home: boolean }
export interface Price { odds: number; book: string }
export interface GameInput {
  date: string; home: string; away: string; start?: string;
  homeGames: TeamGame[]; awayGames: TeamGame[];
  total: number | null; over: Price | null; under: Price | null;
  homeSpread: number | null; homeML: Price | null; awayML: Price | null;
  /** Fair (vig-free) chances from the sharpest source available. */
  sharp: { source: string; homeWin: number | null; over: number | null; total: number | null };
}
export interface Play { market: "total" | "moneyline"; pick: string; odds: number; book: string; chance: number | null; reason: string }
export interface MethodResult { plays: Play[]; notes: string[] }

export const implied = (o: number) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));
export const decimal = (o: number) => (o < 0 ? 1 + 100 / -o : 1 + o / 100);
export const noVig = (a: number, b: number) => { const x = implied(a), y = implied(b); return x / (x + y); };
const avg = (v: number[]) => (v.length ? v.reduce((s, n) => s + n, 0) / v.length : 0);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

/** Possessions per 48 minutes over the last 10 games. */
export function pace(games: TeamGame[]): number | null {
  const g = recent(games);
  if (g.length < 3) return null;
  return avg(g.map((x) => (x.poss * 240) / Math.max(240, x.minutes)));
}
const recent = (games: TeamGame[]) => [...games].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);

/** Schedule fatigue 0-100 from last year's engine (travel/altitude omitted: no data). */
export function fatigue(games: TeamGame[], today: string, playingHome: boolean): { score: number; why: string[] } {
  const past = games.map((g) => dayDiff(today, g.date)).filter((d) => d > 0);
  const why: string[] = []; let score = 0;
  const b2b = past.includes(1);
  if (b2b) { score += 22; why.push("back-to-back"); if (!playingHome) { score += 14; why.push("on the road"); } }
  if (past.filter((d) => d <= 3).length >= 2) { score += 12; why.push("3 games in 4 nights"); }
  if (past.filter((d) => d <= 5).length >= 3) { score += 18; why.push("4 games in 6 nights"); }
  return { score: Math.min(100, score), why };
}

/** Projected game total from both teams' pace and points per possession. */
export function modelTotal(g: GameInput): number | null {
  const h = recent(g.homeGames), a = recent(g.awayGames);
  const ph = pace(h), pa = pace(a);
  if (ph == null || pa == null) return null;
  const ppp = (x: TeamGame[], k: "pts" | "oppPts") => avg(x.map((y) => y[k] / Math.max(1, y.poss)));
  const poss = (ph + pa) / 2;
  const homePts = poss * (ppp(h, "pts") + ppp(a, "oppPts")) / 2;
  const awayPts = poss * (ppp(a, "pts") + ppp(h, "oppPts")) / 2;
  return homePts + awayPts;
}

/** Method A: pace and schedule fatigue. */
export function paceFatigue(g: GameInput): MethodResult {
  const notes: string[] = []; const plays: Play[] = [];
  const fh = fatigue(g.homeGames, g.date, true), fa = fatigue(g.awayGames, g.date, false);
  const raw = modelTotal(g);
  const ph = pace(g.homeGames), pa = pace(g.awayGames);
  if (raw == null || ph == null || pa == null) return { plays, notes: ["Not enough games this season yet."] };
  const total = raw - 0.06 * (fh.score + fa.score);
  const combined = (ph + pa) / 2;
  notes.push(`Pace ${combined.toFixed(1)} (${combined >= 102 ? "fast" : combined <= 98 ? "slow" : "neutral"}) · model total ${total.toFixed(1)}`);
  notes.push(`Fatigue: ${g.home} ${fh.score}${fh.why.length ? ` (${fh.why.join(", ")})` : ""}, ${g.away} ${fa.score}${fa.why.length ? ` (${fa.why.join(", ")})` : ""}`);
  if (g.total != null && g.over && g.under) {
    const gap = total - g.total;
    const anyB2B = fh.why.includes("back-to-back") || fa.why.includes("back-to-back");
    if (gap >= 3 && combined >= 102 && !anyB2B) plays.push({ market: "total", pick: `Over ${g.total}`, ...g.over, chance: null, reason: `Fast pace, nobody tired, model ${gap.toFixed(1)} over the line` });
    else if (-gap >= 3 || (Math.max(fh.score, fa.score) >= 25 && -gap >= 1)) plays.push({ market: "total", pick: `Under ${g.total}`, ...g.under, chance: null, reason: `Model ${(-gap).toFixed(1)} under the line${Math.max(fh.score, fa.score) >= 25 ? ", tired legs" : ""}` });
  }
  const diff = fa.score - fh.score;
  if (Math.abs(diff) >= 15 && g.homeML && g.awayML) {
    const homeRested = diff > 0;
    const price = homeRested ? g.homeML : g.awayML;
    const team = homeRested ? g.home : g.away;
    if (implied(price.odds) > 0.8) notes.push(`${team} is rested but priced over 80%, juice trap, skipped`);
    else plays.push({ market: "moneyline", pick: `${team} ML`, ...price, chance: null, reason: `${Math.abs(diff)}-point fatigue edge${Math.abs(diff) >= 30 ? " (strong)" : ""}` });
  }
  return { plays, notes };
}

export const HOME_ML_BOOST = 0.04;
export const UNDER_BOOST = 0.02;
export const FAT_SPREAD = 9.5;
export const MIN_EV = 0.02;

/** Method B: sharp fair price plus last year's structural nudges. */
export function sharpStructure(g: GameInput): MethodResult {
  const notes: string[] = []; const plays: Play[] = [];
  if (g.total != null && g.homeSpread != null) {
    const s = Math.abs(g.homeSpread), fav = g.homeSpread < 0 ? g.home : g.away, dog = fav === g.home ? g.away : g.home;
    notes.push(`Implied team totals: ${fav} ${(g.total / 2 + s / 2).toFixed(1)}, ${dog} ${(g.total / 2 - s / 2).toFixed(1)}`);
  }
  notes.push(`Fair price from ${g.sharp.source}`);
  const fat = g.homeSpread != null && Math.abs(g.homeSpread) >= FAT_SPREAD;
  if (fat) notes.push(`Spread ${Math.abs(g.homeSpread!)}+ is a fat spread, moneylines skipped`);
  if (g.sharp.homeWin != null && g.homeML && g.awayML && !fat) {
    const pHome = Math.min(0.97, g.sharp.homeWin + HOME_ML_BOOST);
    const evH = pHome * decimal(g.homeML.odds) - 1, evA = (1 - pHome) * decimal(g.awayML.odds) - 1;
    const best = evH >= evA ? { team: g.home, p: pHome, ev: evH, price: g.homeML } : { team: g.away, p: 1 - pHome, ev: evA, price: g.awayML };
    if (best.ev >= MIN_EV && implied(best.price.odds) <= 0.8) plays.push({ market: "moneyline", pick: `${best.team} ML`, ...best.price, chance: best.p, reason: `Fair ${(best.p * 100).toFixed(0)}% vs book ${(implied(best.price.odds) * 100).toFixed(0)}% · +${(best.ev * 100).toFixed(1)}% profit` });
  }
  if (g.sharp.over != null && g.total != null && g.over && g.under && (g.sharp.total == null || g.sharp.total === g.total)) {
    const pUnder = Math.min(0.97, 1 - g.sharp.over + UNDER_BOOST);
    const evO = (1 - pUnder) * decimal(g.over.odds) - 1, evU = pUnder * decimal(g.under.odds) - 1;
    const over = evO > evU;
    const ev = over ? evO : evU, p = over ? 1 - pUnder : pUnder, price = over ? g.over : g.under;
    if (ev >= MIN_EV) plays.push({ market: "total", pick: `${over ? "Over" : "Under"} ${g.total}`, ...price, chance: p, reason: `Fair ${(p * 100).toFixed(0)}% vs book ${(implied(price.odds) * 100).toFixed(0)}% · +${(ev * 100).toFixed(1)}% profit` });
  } else if (g.sharp.total != null && g.total != null && g.sharp.total !== g.total) notes.push(`Sharp total ${g.sharp.total} differs from ${g.total}; no fair price on this number`);
  return { plays, notes };
}
