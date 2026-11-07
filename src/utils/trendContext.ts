import { statValue, type GameLog, type StatKey } from "./nbaBoxScoreMath";

/** One reason a hot/cold streak is likely to hold ("supports") or fade ("fragile"). */
export interface TrendFactor { key: string; label: string; tone: "supports" | "fragile" | "neutral"; why: string }

export interface TrendContext {
  trend: "hot" | "cold" | "flat";
  /** real = most factors back the streak; fragile = most say it fades; mixed otherwise. */
  verdict: "real" | "fragile" | "mixed" | "none";
  factors: TrendFactor[];
}

export interface TrendInputs {
  /** Opponent strength for this stat (1 = average, >1 gives up more). */
  oppFactor?: Map<string, number>;
  /** Dates (YYYY-MM-DD) in which a regular teammate sat out. */
  mateOutDates?: Set<string>;
  /** Those teammates are playing again tonight. */
  matesBackTonight?: boolean;
  today?: string;
  homeTonight?: boolean | null;
  lineTonight?: number;
  linePrev?: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (a: number, b: number) => (b ? (a - b) / b : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;
const dayGap = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

/**
 * Explains a hot/cold streak (last-5 median vs last-10 median, ±10%) with the
 * factors that decide whether it should carry into tonight. Pure; no network.
 */
export function trendContext(logs: GameLog[], stat: StatKey, i: TrendInputs = {}): TrendContext {
  const played = logs.filter((g) => Number(g.minutes_played) > 0).sort((a, b) => b.game_date.localeCompare(a.game_date));
  const l10 = played.slice(0, 10), l5 = l10.slice(0, 5);
  if (l10.length < 5) return { trend: "flat", verdict: "none", factors: [] };
  const med = (gs: GameLog[]) => { const s = gs.map((g) => statValue(g, stat)).sort((a, b) => a - b); const m = (s.length - 1) / 2; return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2; };
  const diff = pct(med(l5), med(l10));
  const trend = diff >= 0.1 ? "hot" : diff <= -0.1 ? "cold" : "flat";
  const dir = trend === "hot" ? 1 : trend === "cold" ? -1 : 0;
  const f: TrendFactor[] = [];
  // Agrees with streak direction = supports; opposes = fragile.
  const tone = (signed: number): TrendFactor["tone"] => (!dir || !signed ? "neutral" : Math.sign(signed) === dir ? "supports" : "fragile");

  // 1. Minutes
  const m5 = avg(l5.map((g) => Number(g.minutes_played))), m10 = avg(l10.map((g) => Number(g.minutes_played)));
  const mDiff = pct(m5, m10);
  const mSign = Math.abs(mDiff) >= 0.08 ? Math.sign(mDiff) : 0;
  f.push({ key: "minutes", label: "Minutes", tone: tone(mSign),
    why: mSign ? `${r1(m5)} min last 5 vs ${r1(m10)} last 10 — ${mSign > 0 ? "bigger" : "smaller"} role.` : `Steady ${r1(m5)} min — the streak isn't from more or less playing time.` });

  // 2. Shot volume vs shooting luck (scoring stats only)
  if (stat === "points" || stat === "threes_made" || stat === "pra") {
    const col = stat === "threes_made" ? "threes_attempted" : "field_goals_attempted";
    const a5 = l5.map((g) => Number(g[col])).filter(Number.isFinite), a10 = l10.map((g) => Number(g[col])).filter(Number.isFinite);
    if (a5.length >= 3 && a10.length >= 5) {
      const aDiff = pct(avg(a5), avg(a10));
      const aSign = Math.abs(aDiff) >= 0.1 ? Math.sign(aDiff) : 0;
      const name = stat === "threes_made" ? "3PT tries" : "shots";
      f.push({ key: "volume", label: "Shot volume", tone: dir && !aSign ? "fragile" : tone(aSign),
        why: aSign ? `${r1(avg(a5))} ${name}/game last 5 vs ${r1(avg(a10))} — real change in attempts.`
          : dir ? `Same ${r1(avg(a5))} ${name}/game — streak is ${dir > 0 ? "hot" : "cold"} shooting, which usually evens out.` : `Steady ${r1(avg(a5))} ${name}/game.` });
    }
  }

  // 3. Opponents faced
  if (i.oppFactor?.size) {
    const fs = l5.map((g) => (g.opponent && i.oppFactor!.get(g.opponent)) || 1);
    const o = avg(fs);
    const oSign = Math.abs(o - 1) >= 0.04 ? Math.sign(o - 1) : 0;
    // Soft schedule inflates a hot streak (fragile); tough schedule backs a hot one.
    f.push({ key: "opponents", label: "Opponents faced", tone: tone(-oSign),
      why: oSign ? `Last 5 came against ${oSign > 0 ? "soft" : "tough"} defenses (${o > 1 ? "+" : ""}${Math.round((o - 1) * 100)}% vs average).` : "Last 5 opponents were about average." });
  }

  // 4. Teammates out
  if (i.mateOutDates) {
    const n = l5.filter((g) => i.mateOutDates!.has(g.game_date)).length;
    if (n >= 2) {
      const back = i.matesBackTonight;
      f.push({ key: "teammates", label: "Teammates out", tone: back ? tone(-1) : tone(1),
        why: `A regular teammate missed ${n} of the last 5${back ? " but plays tonight — that extra role goes away." : " and is still out — the role should carry over."}` });
    } else f.push({ key: "teammates", label: "Teammates out", tone: "neutral", why: "Full rotation in most recent games." });
  }

  // 5. Rest
  if (i.today) {
    const gap = dayGap(l5[0].game_date, i.today);
    const b2b = gap === 1;
    f.push({ key: "rest", label: "Rest", tone: b2b ? tone(-1) : gap >= 3 ? tone(1) : "neutral",
      why: b2b ? "Back-to-back tonight — tired legs." : gap >= 3 ? `${gap - 1} days of rest.` : "Normal rest." });
  }

  // 6. Venue
  if (i.homeTonight != null) {
    const homeShare = l5.filter((g) => g.is_home).length / l5.length;
    const was = homeShare >= 0.6 ? "home" : homeShare <= 0.4 ? "road" : null;
    const now = i.homeTonight ? "home" : "road";
    const sign = was && was !== now ? (was === "home" ? -1 : 1) : 0;
    f.push({ key: "venue", label: "Venue", tone: tone(sign),
      why: was ? `Last 5 were mostly ${was} games; tonight is ${now}.` : `Mixed venues lately; tonight is ${now}.` });
  }

  // 7. Line movement
  if (i.lineTonight != null && i.linePrev != null) {
    const d = i.lineTonight - i.linePrev;
    // Book moving with the streak means the edge is priced in.
    const sign = Math.abs(d) >= 0.5 ? Math.sign(d) : 0;
    f.push({ key: "line", label: "Line move", tone: sign ? (Math.sign(sign) === dir ? "fragile" : "supports") : "neutral",
      why: sign ? `Line ${sign > 0 ? "up" : "down"} ${i.linePrev} → ${i.lineTonight}${dir && sign === dir ? " — book already priced in the streak." : "."}` : `Line steady at ${i.lineTonight}.` });
  }

  const s = f.filter((x) => x.tone === "supports").length, fr = f.filter((x) => x.tone === "fragile").length;
  const verdict = !dir ? "none" : s - fr >= 2 ? "real" : fr - s >= 2 ? "fragile" : "mixed";
  return { trend, verdict, factors: f };
}
