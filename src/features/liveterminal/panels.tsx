import type { LiveGameState } from "@/features/live3d/types";
import { buildMockTerminal } from "./state/mockFeed";
import { STATE_COLOR, STATE_LABEL } from "./state/stateColors";
import type { PlayerState } from "./types";
import type { PropEdgeRow } from "./hooks/useTerminalFeed";
import type { NextPlayPrediction } from "./hooks/useNextPlayPredictions";
import type { PropQuote } from "@/features/live3d/types";
import { useEffect, useState } from "react";

export function TerminalPanels({
  state,
  playerStates,
  edgeRows,
  signalCount,
  hasProjections,
  pbpAvailable,
  nextPlayPredictions,
  nextPlayLastRun,
  quotes,
}: {
  state: LiveGameState;
  playerStates: Record<string, PlayerState>;
  edgeRows: PropEdgeRow[];
  signalCount: number;
  hasProjections: boolean;
  pbpAvailable: boolean;
  nextPlayPredictions: NextPlayPrediction[];
  nextPlayLastRun: number | null;
  quotes: PropQuote[];
}) {
  const { players } = buildMockTerminal(state, { playerStates, edgeRows });
  const ranked = [...players]
    .filter((p) => p.edge)
    .sort((a, b) => Math.abs(b.edge!.edgePct) - Math.abs(a.edge!.edgePct))
    .slice(0, 5);
  const involvement = [...players].sort((a, b) => (b.involvementPct ?? 0) - (a.involvementPct ?? 0)).slice(0, 6);
  const legendStates: PlayerState[] = ["over_pace", "under_pace", "usage_spike", "sharp_action", "volatility"];

  return (
    <>
    <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[hsl(var(--term-muted))]">
      <FeedChip on={edgeRows.length > 0} label={`Quotes · ${edgeRows.length}`} />
      <FeedChip on={signalCount > 0} label={`Signals · ${signalCount}`} />
      <FeedChip on={hasProjections} label="Projections" />
      <FeedChip on={pbpAvailable} label="Play-by-play" />
      <FeedChip on={nextPlayPredictions.length > 0} label={`AI Next Play · ${nextPlayPredictions.length}`} />
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      <NextPlayPanel predictions={nextPlayPredictions} lastRun={nextPlayLastRun} quotes={quotes} />

      <Panel title="Player involvement">
        <ul className="space-y-1.5">
          {involvement.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: p.teamColor }} />
              <div className="flex-1 text-xs">
                <span className="font-mono text-[hsl(var(--term-muted))] mr-1.5">#{p.number}</span>
                <span className="text-[hsl(var(--term-text))]">{p.position}</span>
              </div>
              <div className="w-24 h-1.5 bg-[hsl(var(--term-grid))] rounded-full overflow-hidden">
                <div className="h-full" style={{ width: `${p.involvementPct}%`, background: p.teamColor }} />
              </div>
              <div className="w-9 text-right text-[11px] font-mono text-[hsl(var(--term-text))] term-tabular">
                {p.involvementPct}%
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Top edges">
        <table className="w-full text-[11px] font-mono term-tabular">
          <thead>
            <tr className="text-[hsl(var(--term-muted))] uppercase tracking-wider text-[9px]">
              <th className="text-left font-normal pb-1">Player</th>
              <th className="text-right font-normal pb-1">Line</th>
              <th className="text-right font-normal pb-1">Proj</th>
              <th className="text-right font-normal pb-1">Edge</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p) => (
              <tr key={p.id} className="border-t border-[hsl(var(--term-grid))]">
                <td className="py-1 text-[hsl(var(--term-text))]">
                  <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle" style={{ background: p.teamColor }} />
                  #{p.number} · {p.edge!.propType}
                </td>
                <td className="text-right">{p.edge!.line}</td>
                <td className="text-right">{p.edge!.projection}</td>
                <td
                  className="text-right font-semibold"
                  style={{ color: p.edge!.edgePct >= 0 ? "hsl(var(--state-over))" : "hsl(var(--state-under))" }}
                >
                  {p.edge!.edgePct >= 0 ? "+" : ""}
                  {p.edge!.edgePct}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Player state legend">
        <ul className="space-y-1.5">
          {legendStates.map((s) => (
            <li key={s} className="flex items-center gap-2 text-xs text-[hsl(var(--term-text))]">
              <span className="inline-block w-3 h-3 rounded-full" style={{ background: STATE_COLOR[s] }} />
              <span>{STATE_LABEL[s]}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
    </>
  );
}

function NextPlayPanel({
  predictions,
  lastRun,
  quotes,
}: {
  predictions: NextPlayPrediction[];
  lastRun: number | null;
  quotes: PropQuote[];
}) {
  const REFRESH_MS = 20_000;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ago = lastRun ? Math.max(0, Math.floor((now - lastRun) / 1000)) : null;
  const nextIn = lastRun ? Math.max(0, Math.ceil((lastRun + REFRESH_MS - now) / 1000)) : null;

  // Build a quick lookup of freshest quotes for live revaluation
  const latestByKey = new Map<string, PropQuote>();
  const REF_PRIORITY = ["fanduel", "draftkings", "betmgm", "williamhill_us", "pinnacle"];
  for (const q of quotes) {
    if (q.line == null) continue;
    const k = `${q.player_name}|${q.prop_type}|${q.line}`;
    const cur = latestByKey.get(k);
    if (!cur) {
      latestByKey.set(k, q);
      continue;
    }
    // prefer newer fetched_at, tie-break by book priority
    const newer = new Date(q.fetched_at).getTime() > new Date(cur.fetched_at).getTime();
    const curRank = REF_PRIORITY.indexOf(cur.bookmaker);
    const newRank = REF_PRIORITY.indexOf(q.bookmaker);
    if (newer || (newRank !== -1 && (curRank === -1 || newRank < curRank))) {
      latestByKey.set(k, q);
    }
  }

  function americanToProb(p: number | null): number | null {
    if (p == null) return null;
    return p > 0 ? 100 / (p + 100) : -p / (-p + 100);
  }

  return (
    <div className="rounded-md border border-[hsl(var(--term-grid))] bg-[hsl(var(--term-bg))] p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-[0.18em] text-[hsl(var(--term-muted))]">
          AI · Next play props
        </div>
        {ago !== null && (
          <div className="text-[9px] uppercase tracking-widest text-[hsl(var(--term-muted))] font-mono flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[hsl(var(--state-over))] animate-pulse" />
            <span>Revalued {ago}s ago</span>
            {nextIn !== null && <span className="opacity-60">· next {nextIn}s</span>}
          </div>
        )}
      </div>
      {predictions.length === 0 ? (
        <div className="text-[11px] text-[hsl(var(--term-muted))] py-3 text-center">
          AI is watching the game… first picks land in ~15s.
        </div>
      ) : (
        <ul className="space-y-2">
          {predictions.map((p) => {
            // Revalue against the freshest quote we hold on the client
            const live = latestByKey.get(`${p.player_name}|${p.prop_type}|${p.line}`);
            const livePrice =
              live && (p.side === "Over" ? live.over_price : live.under_price);
            const price = livePrice ?? p.american_price;
            const implied = americanToProb(price ?? null);
            const liveEdge =
              implied != null ? +((p.prob_next_play - implied) * 100).toFixed(2) : (p.edge_pct ?? 0);
            const edge = liveEdge;
            const edgeColor = edge >= 0 ? "hsl(var(--state-over))" : "hsl(var(--state-under))";
            const priceAgeSec = live
              ? Math.max(0, Math.floor((now - new Date(live.fetched_at).getTime()) / 1000))
              : null;
            const book = live?.bookmaker ?? p.book;
            return (
              <li
                key={p.id}
                className="rounded border border-[hsl(var(--term-grid))] bg-[hsl(var(--term-bg))]/40 p-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-[hsl(var(--term-muted))] truncate font-mono">
                      {p.player_name}
                    </div>
                    <div className="text-xs text-[hsl(var(--term-text))] font-semibold leading-tight">
                      {p.prop_label} {p.side} {p.line}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono term-tabular text-[hsl(var(--term-text))]">
                      {Math.round(p.prob_next_play * 100)}%
                    </div>
                    <div
                      className="text-[10px] font-mono term-tabular"
                      style={{ color: edgeColor }}
                    >
                      {edge >= 0 ? "+" : ""}
                      {edge.toFixed(1)}%
                    </div>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-[hsl(var(--term-muted))] font-mono">
                  {book && <span className="uppercase">{book}</span>}
                  {price != null && (
                    <span>{price > 0 ? "+" : ""}{price}</span>
                  )}
                  {implied != null && (
                    <span className="opacity-70">· imp {(implied * 100).toFixed(1)}%</span>
                  )}
                  {priceAgeSec != null && (
                    <span className="ml-auto opacity-60">priced {priceAgeSec}s ago</span>
                  )}
                </div>
                {p.rationale && (
                  <div className="mt-1 text-[10px] italic text-[hsl(var(--term-muted))] leading-snug">
                    {p.rationale}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function FeedChip({ on, label }: { on: boolean; label: string }) {
  const color = on ? "hsl(var(--state-over))" : "hsl(var(--term-muted))";
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border"
      style={{ borderColor: `${color}55`, color }}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-[hsl(var(--term-grid))] bg-[hsl(var(--term-bg))] p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[hsl(var(--term-muted))] mb-2">{title}</div>
      {children}
    </div>
  );
}