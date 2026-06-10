import { useMemo, useState } from "react";
import { PropQuote } from "../types";

const BOOK_LABEL: Record<string, string> = {
  fanduel: "FanDuel",
  draftkings: "DraftKings",
  betmgm: "BetMGM",
  williamhill_us: "Caesars",
  betrivers: "BetRivers",
  espnbet: "ESPN BET",
  pinnacle: "Pinnacle",
};

const PROP_LABEL: Record<string, string> = {
  player_points: "Points",
  player_rebounds: "Rebounds",
  player_assists: "Assists",
  player_threes: "3-Pointers",
  player_pass_yds: "Pass Yds",
  player_rush_yds: "Rush Yds",
  player_receptions: "Receptions",
  player_anytime_td: "Anytime TD",
  batter_hits: "Hits",
  batter_total_bases: "Total Bases",
  batter_home_runs: "Home Run",
  pitcher_strikeouts: "Strikeouts",
  player_shots_on_goal: "Shots On Goal",
  player_goals: "Goals",
  player_shots_on_target: "Shots On Target",
  player_shots: "Shots",
  player_goal_scorer_anytime: "Anytime Scorer",
};

function fmtOdds(n: number | null): string {
  if (n == null) return "—";
  return n > 0 ? `+${n}` : `${n}`;
}

export function PropBookGrid({ quotes }: { quotes: PropQuote[] }) {
  const [filter, setFilter] = useState("");

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const map = new Map<string, PropQuote[]>();
    for (const q of quotes) {
      if (f && !q.player_name.toLowerCase().includes(f) && !q.prop_type.toLowerCase().includes(f)) {
        continue;
      }
      const key = `${q.player_name}|${q.prop_type}|${q.line ?? "ML"}`;
      const arr = map.get(key) ?? [];
      arr.push(q);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [quotes, filter]);

  if (!quotes.length) {
    return (
      <div className="p-4 text-sm text-slate-400">
        No live prop quotes yet. They populate once the multi-book sync runs for this game.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search player or market..."
        className="w-full bg-slate-900 border border-slate-800 text-white text-sm rounded-md px-3 py-2 focus:outline-none focus:border-slate-600"
      />
      <div className="flex flex-col gap-2 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
        {groups.map(([key, rows]) => {
          const sample = rows[0];
          const bestOver = rows.reduce<PropQuote | null>(
            (b, r) => (r.over_price != null && (b == null || r.over_price > (b.over_price ?? -9999)) ? r : b),
            null,
          );
          const bestUnder = rows.reduce<PropQuote | null>(
            (b, r) =>
              r.under_price != null && (b == null || r.under_price > (b.under_price ?? -9999)) ? r : b,
            null,
          );
          return (
            <div key={key} className="rounded-md border border-slate-800 bg-slate-900/60">
              <div className="px-3 py-2 flex items-center justify-between">
                <div className="text-white text-sm font-semibold">
                  {sample.player_name}
                  <span className="ml-2 text-xs text-slate-400 font-normal">
                    {PROP_LABEL[sample.prop_type] ?? sample.prop_type}
                    {sample.line != null ? ` · ${sample.line}` : ""}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-3 pb-2 text-xs text-slate-300">
                <span className="text-slate-500 uppercase tracking-wide">Book</span>
                <span className="text-slate-500 uppercase tracking-wide text-right">Over</span>
                <span className="text-slate-500 uppercase tracking-wide text-right">Under</span>
                {rows
                  .sort((a, b) => a.bookmaker.localeCompare(b.bookmaker))
                  .map((r) => (
                    <div key={r.bookmaker} className="contents">
                      <span className="py-0.5">{BOOK_LABEL[r.bookmaker] ?? r.bookmaker}</span>
                      <span
                        className={`py-0.5 text-right tabular-nums ${
                          bestOver && r.bookmaker === bestOver.bookmaker
                            ? "text-emerald-400 font-semibold"
                            : ""
                        }`}
                      >
                        {fmtOdds(r.over_price)}
                      </span>
                      <span
                        className={`py-0.5 text-right tabular-nums ${
                          bestUnder && r.bookmaker === bestUnder.bookmaker
                            ? "text-emerald-400 font-semibold"
                            : ""
                        }`}
                      >
                        {fmtOdds(r.under_price)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}