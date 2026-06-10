import type { LiveGameState } from "@/features/live3d/types";
import { buildMockTerminal } from "./state/mockFeed";
import { STATE_COLOR, STATE_LABEL } from "./state/stateColors";
import type { PlayerState } from "./types";
import type { PropEdgeRow } from "./hooks/useTerminalFeed";

export function TerminalPanels({
  state,
  playerStates,
  edgeRows,
  signalCount,
  hasProjections,
  pbpAvailable,
}: {
  state: LiveGameState;
  playerStates: Record<string, PlayerState>;
  edgeRows: PropEdgeRow[];
  signalCount: number;
  hasProjections: boolean;
  pbpAvailable: boolean;
}) {
  const { players, nextPlays } = buildMockTerminal(state, { playerStates, edgeRows });
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
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      <Panel title="Next likely play">
        <ul className="space-y-1.5">
          {nextPlays.map((np) => (
            <li key={np.label} className="flex items-center gap-2">
              <div className="flex-1 text-xs text-[hsl(var(--term-text))]">{np.label}</div>
              <div className="w-20 h-1.5 bg-[hsl(var(--term-grid))] rounded-full overflow-hidden">
                <div className="h-full bg-[hsl(var(--state-sharp))]" style={{ width: `${Math.round(np.probability * 100)}%` }} />
              </div>
              <div className="w-9 text-right text-[11px] font-mono text-[hsl(var(--term-text))] term-tabular">
                {Math.round(np.probability * 100)}%
              </div>
            </li>
          ))}
        </ul>
      </Panel>

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