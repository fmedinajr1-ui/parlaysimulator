import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { summarizePlayer, statValue, type GameLog, type StatKey } from "@/utils/nbaBoxScoreMath";

const STATS: { key: StatKey; label: string }[] = [
  { key: "points", label: "Points" },
  { key: "rebounds", label: "Rebounds" },
  { key: "assists", label: "Assists" },
  { key: "threes_made", label: "3-Pointers" },
  { key: "pra", label: "Pts+Reb+Ast" },
];

const COLS = "player_name,game_date,opponent,minutes_played,points,rebounds,assists,threes_made";

async function fetchAll(): Promise<GameLog[]> {
  const out: GameLog[] = [];
  for (let from = 0; from < 60000; from += 1000) {
    const { data, error } = await supabase
      .from("nba_player_game_logs")
      .select(COLS)
      .order("game_date", { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as GameLog[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function Research() {
  const [logs, setLogs] = useState<GameLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [stat, setStat] = useState<StatKey>("points");
  const [line, setLine] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetchAll().then(setLogs).catch((e) => setErr(String(e?.message ?? e))).finally(() => setLoading(false));
  }, []);

  const byPlayer = useMemo(() => {
    const m = new Map<string, GameLog[]>();
    for (const g of logs) {
      const arr = m.get(g.player_name) ?? [];
      arr.push(g);
      m.set(g.player_name, arr);
    }
    return m;
  }, [logs]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const ln = line ? Number(line) : undefined;
    const res = [];
    for (const [name, games] of byPlayer) {
      if (term && !name.toLowerCase().includes(term) && !games.some((g) => g.opponent?.toLowerCase().includes(term))) continue;
      const s = summarizePlayer(games, stat, ln);
      if (s && s.l10.games >= 3) res.push(s);
    }
    return res.sort((a, b) => b.l10.median - a.l10.median).slice(0, 100);
  }, [byPlayer, q, stat, line]);

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8 font-mono">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ParlayFarm Research 2026–27</h1>
          <p className="text-sm text-muted-foreground">Box score math only · no AI</p>
        </div>
        <div className="flex gap-6 text-sm">
          <div><div className="text-muted-foreground">Game logs</div><div className="text-xl text-primary">{logs.length.toLocaleString()}</div></div>
          <div><div className="text-muted-foreground">Players</div><div className="text-xl text-primary">{byPlayer.size.toLocaleString()}</div></div>
          <div><div className="text-muted-foreground">Latest</div><div className="text-xl text-primary">{logs[0]?.game_date ?? "—"}</div></div>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 mb-4">
        <Input placeholder="Search player or opponent…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Input placeholder="Prop line (optional)" type="number" step="0.5" value={line} onChange={(e) => setLine(e.target.value)} className="w-44" />
        {STATS.map((s) => (
          <Button key={s.key} size="sm" variant={stat === s.key ? "default" : "outline"} onClick={() => setStat(s.key)}>{s.label}</Button>
        ))}
      </div>

      {loading && <p className="text-muted-foreground">Loading game logs…</p>}
      {err && <p className="text-destructive">Couldn't load data: {err}</p>}

      {!loading && !err && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                {["Player", "Last", "L5 Med", "L10 Med", "Floor", "Ceiling", "Hit L5", "Hit L10", "Trend"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.player}>
                  <tr key={r.player} className="border-t border-border hover:bg-muted/50 cursor-pointer" onClick={() => setOpen(open === r.player ? null : r.player)}>
                    <td className="px-3 py-2 font-semibold">{r.player}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.lastDate} vs {r.lastOpponent ?? "?"}</td>
                    <td className="px-3 py-2">{fmt(r.l5.median)}</td>
                    <td className="px-3 py-2 text-primary font-semibold">{fmt(r.l10.median)}</td>
                    <td className="px-3 py-2">{fmt(r.l10.floor)}</td>
                    <td className="px-3 py-2">{fmt(r.l10.ceiling)}</td>
                    <td className="px-3 py-2">{pct(r.l5.hitRate)}</td>
                    <td className="px-3 py-2">{pct(r.l10.hitRate)}</td>
                    <td className={`px-3 py-2 ${r.trend === "hot" ? "text-primary" : r.trend === "cold" ? "text-destructive" : "text-muted-foreground"}`}>
                      {r.trend === "hot" ? "▲ Hot" : r.trend === "cold" ? "▼ Cold" : "— Flat"}
                    </td>
                  </tr>
                  {open === r.player && (
                    <tr key={r.player + "-d"} className="bg-muted/30">
                      <td colSpan={9} className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          {(byPlayer.get(r.player) ?? [])
                            .filter((g) => (Number(g.minutes_played) || 0) > 0)
                            .sort((a, b) => b.game_date.localeCompare(a.game_date))
                            .slice(0, 10)
                            .map((g) => {
                              const v = statValue(g, stat);
                              const ln = line ? Number(line) : r.l10.median;
                              return (
                                <div key={g.game_date} className={`rounded border px-2 py-1 text-xs ${v > ln ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
                                  {g.game_date.slice(5)} {g.opponent ?? ""} · <b>{v}</b> · {Math.round(Number(g.minutes_played))}m
                                </div>
                              );
                            })}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!rows.length && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">No players match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
