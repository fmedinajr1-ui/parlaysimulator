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
  const [propLines, setPropLines] = useState<Map<string, number>>(new Map());
  const [injuries, setInjuries] = useState<Map<string, string>>(new Map());
  const [explain, setExplain] = useState<Record<string, { busy?: boolean; text?: string; error?: string }>>({});
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

  useEffect(() => {
    fetchAll().then(setLogs).catch((e) => setErr(String(e?.message ?? e))).finally(() => setLoading(false));
    (async () => {
      try {
        const [{ data: pl }, { data: inj }] = await Promise.all([
          supabase.from("research_prop_lines" as never).select("player_name,stat,line,book").eq("game_date", today).limit(5000),
          supabase.from("nba_injury_reports").select("player_name,status").eq("game_date", today).limit(1000),
        ]);
        const m = new Map<string, number>();
        for (const r of (pl ?? []) as { player_name: string; stat: string; line: number; book: string }[]) {
          const k = `${r.player_name.toLowerCase()}|${r.stat}`;
          if (!m.has(k) || r.book === "fanduel") m.set(k, Number(r.line));
        }
        setPropLines(m);
        setInjuries(new Map((inj ?? []).map((i) => [String(i.player_name).toLowerCase(), String(i.status)])));
      } catch (e) {
        console.error("research extras failed", e);
      }
    })();
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

  const lineFor = (player: string): number | undefined => {
    if (line) return Number(line);
    return propLines.get(`${player.toLowerCase()}|${stat}`);
  };

  const runExplain = async (player: string, ln?: number) => {
    setExplain((s) => ({ ...s, [player]: { busy: true } }));
    try {
      const text = await callResearchAi({ mode: "explain", player, stat, line: ln ?? null });
      setExplain((s) => ({ ...s, [player]: { text } }));
    } catch (e) {
      setExplain((s) => ({ ...s, [player]: { error: (e as Error).message } }));
    }
  };

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const res = [];
    for (const [name, games] of byPlayer) {
      if (term && !name.toLowerCase().includes(term) && !games.some((g) => g.opponent?.toLowerCase().includes(term))) continue;
      const ln = line ? Number(line) : propLines.get(`${name.toLowerCase()}|${stat}`);
      const s = summarizePlayer(games, stat, ln);
      if (s && s.l10.games >= 3) res.push(s);
    }
    return res.sort((a, b) => b.l10.median - a.l10.median).slice(0, 100);
  }, [byPlayer, q, stat, line, propLines]);

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8 font-mono">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ParlayFarm Research 2026–27</h1>
          <p className="text-sm text-muted-foreground">Box score math · live lines & injuries · AI analyst</p>
        </div>
        <div className="flex gap-6 text-sm">
          <div><div className="text-muted-foreground">Game logs</div><div className="text-xl text-primary">{logs.length.toLocaleString()}</div></div>
          <div><div className="text-muted-foreground">Players</div><div className="text-xl text-primary">{byPlayer.size.toLocaleString()}</div></div>
          <div><div className="text-muted-foreground">Latest</div><div className="text-xl text-primary">{logs[0]?.game_date ?? "—"}</div></div>
          <div><div className="text-muted-foreground">Lines today</div><div className="text-xl text-primary">{propLines.size}</div></div>
        </div>
      </header>

      <ResearchAiPanel today={today} />

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
                {["Player", "Last", "Today's line", "L5 Med", "L10 Med", "Floor", "Ceiling", "Hit L5", "Hit L10", "Trend"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.player}>
                  <tr key={r.player} className="border-t border-border hover:bg-muted/50 cursor-pointer" onClick={() => setOpen(open === r.player ? null : r.player)}>
                    <td className="px-3 py-2 font-semibold">
                      {r.player}
                      {injuries.get(r.player.toLowerCase()) && (
                        <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-xs text-destructive">{injuries.get(r.player.toLowerCase())}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{r.lastDate} vs {r.lastOpponent ?? "?"}</td>
                    <td className="px-3 py-2">{lineFor(r.player) ?? "—"}</td>
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
                        <div className="mt-3">
                          <Button size="sm" variant="outline" disabled={explain[r.player]?.busy}
                            onClick={(e) => { e.stopPropagation(); runExplain(r.player, lineFor(r.player)); }}>
                            {explain[r.player]?.busy ? "Thinking…" : "Explain this edge (AI)"}
                          </Button>
                          {explain[r.player]?.text && <div className="mt-2 rounded border border-border p-3"><Prose text={explain[r.player]!.text!} /></div>}
                          {explain[r.player]?.error && <p className="mt-2 text-sm text-destructive">{explain[r.player]!.error}</p>}
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
