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

export const TOTAL_SHRINK = 0.5;
export const MIN_TOTAL_CHANCE = 0.55;
const anyB2B = (a: { why: string[] }, b: { why: string[] }) => a.why.includes("back-to-back") || b.why.includes("back-to-back");
/** Standard normal CDF (Abramowitz-Stegun). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x >= 0 ? 1 - q : q;
}
/** Game-to-game swing of both teams' recent game totals, floored at 12 points. */
export function totalSpread(g: GameInput): number {
  const t = [...recent(g.homeGames), ...recent(g.awayGames)].map((x) => x.pts + x.oppPts);
  if (t.length < 4) return 18;
  const m = avg(t);
  return Math.max(12, Math.sqrt(avg(t.map((v) => (v - m) ** 2))));
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
    // Real win chance: shrink the projection halfway to the line (pace models overreach),
    // turn the gap into a chance with the teams' own game-to-game total swings,
    // then blend 50/50 with the no-vig book price. Pick only with a real chance and profit.
    const sd = totalSpread(g);
    const proj = g.total + TOTAL_SHRINK * (total - g.total);
    const pModel = normCdf((proj - g.total) / sd);
    const pOver = 0.5 * pModel + 0.5 * noVig(g.over.odds, g.under.odds);
    const evO = pOver * decimal(g.over.odds) - 1, evU = (1 - pOver) * decimal(g.under.odds) - 1;
    const over = evO > evU, p = over ? pOver : 1 - pOver, ev = over ? evO : evU;
    const tired = Math.max(fh.score, fa.score) >= 25;
    notes.push(`Total chance ${(pOver * 100).toFixed(0)}% Over (swing ±${sd.toFixed(0)} pts)`);
    if (over && (combined < 102 || anyB2B(fh, fa))) notes.push("Over skipped: needs fast pace and nobody on a back-to-back");
    else if (p < MIN_TOTAL_CHANCE || ev < MIN_EV) notes.push(`No total play: best side ${(p * 100).toFixed(0)}%, needs ${MIN_TOTAL_CHANCE * 100}% and +${MIN_EV * 100}% profit`);
    else plays.push({ market: "total", pick: `${over ? "Over" : "Under"} ${g.total}`, ...(over ? g.over : g.under), chance: p, reason: `Model ${proj.toFixed(1)} vs line ${g.total} · ${(p * 100).toFixed(0)}% · +${(ev * 100).toFixed(1)}% profit${!over && tired ? ", tired legs" : ""}` });
  }
  const diff = fa.score - fh.score;
  if (Math.abs(diff) >= 15 && g.homeML && g.awayML) {
    const homeRested = diff > 0;
    const price = homeRested ? g.homeML : g.awayML;
    const team = homeRested ? g.home : g.away;
    const market = homeRested ? noVig(g.homeML.odds, g.awayML.odds) : noVig(g.awayML.odds, g.homeML.odds);
    const p = Math.min(0.97, market + Math.min(0.05, Math.abs(diff) / 600));
    const ev = p * decimal(price.odds) - 1;
    if (implied(price.odds) > 0.8) notes.push(`${team} is rested but priced over 80%, juice trap, skipped`);
    else if (ev < MIN_EV) notes.push(`${team} rest edge too small for the price (${(p * 100).toFixed(0)}%)`);
    else plays.push({ market: "moneyline", pick: `${team} ML`, ...price, chance: p, reason: `${Math.abs(diff)}-point fatigue edge · ${(p * 100).toFixed(0)}% vs book ${(implied(price.odds) * 100).toFixed(0)}%` });
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
