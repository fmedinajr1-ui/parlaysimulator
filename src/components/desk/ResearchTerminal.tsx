import { Fragment, useEffect, useMemo, useState } from "react";
import { STAT_OPTIONS } from "@/hooks/useResearchData";
import { GameLogStrip } from "@/components/desk/EdgeCards";
import { callResearchAi, Prose } from "@/components/research/ResearchAiPanel";
import { summarizePlayer, type GameLog, type StatKey } from "@/utils/nbaBoxScoreMath";

interface Props {
  byPlayer: Map<string, GameLog[]>;
  propLines: Map<string, number>;
  injuries: Map<string, string>;
  loading: boolean;
  err: string | null;
  focus: string | null;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
const pct = (n: number) => `${Math.round(n * 100)}%`;

const HEAD = ["Player", "Last", "Today's line", "L5 Med", "L10 Med", "Floor", "Ceiling", "Hit L5", "Hit L10", "Trend"];

export function ResearchTerminal({ byPlayer, propLines, injuries, loading, err, focus }: Props) {
  const [q, setQ] = useState("");
  const [stat, setStat] = useState<StatKey>("points");
  const [line, setLine] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [explain, setExplain] = useState<Record<string, { busy?: boolean; text?: string; error?: string }>>({});

  useEffect(() => {
    if (focus) {
      setQ(focus);
      setOpen(focus);
    }
  }, [focus]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const res = [];
    for (const [name, games] of byPlayer) {
      if (term && !name.toLowerCase().includes(term) && !games.some((g) => g.opponent?.toLowerCase().includes(term)))
        continue;
      const ln = line ? Number(line) : propLines.get(`${name.toLowerCase()}|${stat}`);
      const s = summarizePlayer(games, stat, ln);
      if (s && s.l10.games >= 3) res.push(s);
    }
    return res.sort((a, b) => b.l10.median - a.l10.median).slice(0, 100);
  }, [byPlayer, q, stat, line, propLines]);

  const runExplain = async (player: string, ln?: number) => {
    setExplain((s) => ({ ...s, [player]: { busy: true } }));
    try {
      const text = await callResearchAi({ mode: "explain", player, stat, line: ln ?? null });
      setExplain((s) => ({ ...s, [player]: { text } }));
    } catch (e) {
      setExplain((s) => ({ ...s, [player]: { error: (e as Error).message } }));
    }
  };

  return (
    <section className="desk-panel flex min-h-[420px] flex-col p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="desk-label">Research terminal</div>
          <h2 className="desk-display text-base font-semibold">L5 / L10 box score splits</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search player or opponent…"
            className="desk-input h-9 w-56 px-3"
          />
          <input
            value={line}
            onChange={(e) => setLine(e.target.value)}
            type="number"
            step="0.5"
            placeholder="Prop line"
            className="desk-input h-9 w-28 px-3"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {STAT_OPTIONS.map((s) => (
          <button
            key={s.key}
            className="desk-tab"
            data-active={stat === s.key}
            onClick={() => setStat(s.key)}
            title={s.label}
          >
            {s.short}
          </button>
        ))}
        {(line || q) && (
          <button
            className="desk-tab"
            onClick={() => {
              setLine("");
              setQ("");
            }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="desk-scroll mt-3 flex-1 overflow-auto rounded-lg border border-[hsl(var(--desk-line))]">
        {loading && <p className="desk-mono p-4 text-sm text-[hsl(var(--desk-muted))]">Loading game logs…</p>}
        {err && <p className="desk-mono p-4 text-sm text-[hsl(var(--desk-loss))]">Couldn't load data: {err}</p>}

        {!loading && !err && (
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[hsl(var(--desk-panel-2))]">
              <tr>
                {HEAD.map((h) => (
                  <th key={h} className="desk-label whitespace-nowrap px-3 py-2 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="desk-mono">
              {rows.map((r) => {
                const injury = injuries.get(r.player.toLowerCase());
                const ln = line ? Number(line) : propLines.get(`${r.player.toLowerCase()}|${stat}`);
                return (
                  <Fragment key={r.player}>
                    <tr
                      className="desk-row cursor-pointer border-t border-[hsl(var(--desk-line))]"
                      data-open={open === r.player}
                      onClick={() => setOpen(open === r.player ? null : r.player)}
                    >
                      <td className="px-3 py-2 font-semibold text-[hsl(var(--desk-text))]">
                        <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
                          {r.player}
                          {injury && (
                            <span className="desk-mono whitespace-nowrap rounded bg-[hsl(var(--desk-loss)/0.15)] px-1.5 py-0.5 text-[10px] text-[hsl(var(--desk-loss))]">
                              {injury}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-[hsl(var(--desk-muted))]">
                        {r.lastDate} vs {r.lastOpponent ?? "?"}
                      </td>
                      <td className={`px-3 py-2 ${ln ? "text-[hsl(var(--desk-indigo))]" : "text-[hsl(var(--desk-muted))]"}`}>{ln ?? "—"}</td>
                      <td className="px-3 py-2 text-[hsl(var(--desk-muted))]">{fmt(r.l5.median)}</td>
                      <td className="px-3 py-2 font-bold text-[hsl(var(--desk-amber))]">{fmt(r.l10.median)}</td>
                      <td className="px-3 py-2 text-[hsl(var(--desk-muted))]">{fmt(r.l10.floor)}</td>
                      <td className="px-3 py-2 text-[hsl(var(--desk-muted))]">{fmt(r.l10.ceiling)}</td>
                      <td className="px-3 py-2">{pct(r.l5.hitRate)}</td>
                      <td className="px-3 py-2">{pct(r.l10.hitRate)}</td>
                      <td
                        className={`px-3 py-2 font-semibold ${
                          r.trend === "hot"
                            ? "text-[hsl(var(--desk-win))]"
                            : r.trend === "cold"
                              ? "text-[hsl(var(--desk-loss))]"
                              : "text-[hsl(var(--desk-muted))]"
                        }`}
                      >
                        {r.trend === "hot" ? "▲ Hot" : r.trend === "cold" ? "▼ Cold" : "— Flat"}
                      </td>
                    </tr>

                    {open === r.player && (
                      <tr className="border-t border-[hsl(var(--desk-line))] bg-[hsl(var(--desk-panel)/0.7)]">
                        <td colSpan={HEAD.length} className="px-3 py-3">
                          <div className="desk-label mb-2">Last 10 · {STAT_OPTIONS.find((s) => s.key === stat)?.label}</div>
                          <GameLogStrip games={byPlayer.get(r.player) ?? []} stat={stat} line={ln ?? r.l10.median} />
                          <div className="mt-3 flex flex-wrap items-start gap-3">
                            <button
                              className="desk-btn"
                              disabled={explain[r.player]?.busy}
                              onClick={(e) => {
                                e.stopPropagation();
                                runExplain(r.player, ln);
                              }}
                            >
                              {explain[r.player]?.busy ? "Thinking…" : "Explain this edge (AI)"}
                            </button>
                            {explain[r.player]?.text && (
                              <div className="desk-panel-flat min-w-[260px] flex-1 p-3">
                                <Prose text={explain[r.player]!.text!} />
                              </div>
                            )}
                            {explain[r.player]?.error && (
                              <p className="desk-mono text-sm text-[hsl(var(--desk-loss))]">{explain[r.player]!.error}</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={HEAD.length} className="px-3 py-8 text-center text-[hsl(var(--desk-muted))]">
                    No players match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
