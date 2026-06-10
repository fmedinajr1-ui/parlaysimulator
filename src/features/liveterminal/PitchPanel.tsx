import { useState } from "react";
import type { LiveGameState } from "@/features/live3d/types";
import { buildMockTerminal } from "./state/mockFeed";
import { PITCH_H, PITCH_W, pitchFor } from "./pitches";
import { GhostLayer, TrailLayer, TrajectoryLayer } from "./layers";
import { PlayerToken } from "./PlayerToken";
import type { TerminalPlayer } from "./types";

export function PitchPanel({ state }: { state: LiveGameState }) {
  const { players, trajectories } = buildMockTerminal(state);
  const [hover, setHover] = useState<TerminalPlayer | null>(null);

  return (
    <div className="relative w-full h-full rounded-lg overflow-hidden border border-[hsl(var(--term-grid))] bg-[hsl(var(--term-bg))]">
      <svg viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} preserveAspectRatio="xMidYMid meet" className="w-full h-full">
        {pitchFor(state.sport)}
        <TrailLayer players={players} w={PITCH_W} h={PITCH_H} />
        <TrajectoryLayer trajectories={trajectories} w={PITCH_W} h={PITCH_H} />
        <GhostLayer players={players} w={PITCH_W} h={PITCH_H} />
        {players.map((p) => (
          <PlayerToken key={p.id} player={p} cx={p.x * PITCH_W} cy={p.y * PITCH_H} onHover={setHover} />
        ))}
      </svg>

      {/* corner labels */}
      <div className="absolute top-2 left-3 text-[10px] uppercase tracking-[0.2em] text-[hsl(var(--term-muted))]">
        {state.away_team}
      </div>
      <div className="absolute top-2 right-3 text-[10px] uppercase tracking-[0.2em] text-[hsl(var(--term-muted))]">
        {state.home_team}
      </div>
      <div className="absolute bottom-2 left-3 text-[10px] uppercase tracking-[0.2em] text-[hsl(var(--term-muted))]">
        Live · {state.sport} · {state.period ?? "—"} {state.clock ?? ""}
      </div>

      {/* hover card */}
      {hover && (
        <div className="absolute bottom-2 right-3 min-w-[220px] rounded-md border border-[hsl(var(--term-grid))] bg-black/80 backdrop-blur px-3 py-2 text-xs font-mono text-[hsl(var(--term-text))] term-tabular">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold">#{hover.number} {hover.position}</span>
            <span className="text-[hsl(var(--term-muted))] uppercase text-[10px] tracking-widest">{hover.state.replace("_", " ")}</span>
          </div>
          {hover.edge && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              <span className="text-[hsl(var(--term-muted))]">Prop</span>
              <span className="text-right">{hover.edge.propType}</span>
              <span className="text-[hsl(var(--term-muted))]">Line</span>
              <span className="text-right">{hover.edge.line}</span>
              <span className="text-[hsl(var(--term-muted))]">Proj</span>
              <span className="text-right">{hover.edge.projection}</span>
              <span className="text-[hsl(var(--term-muted))]">Edge</span>
              <span
                className="text-right font-semibold"
                style={{ color: hover.edge.edgePct >= 0 ? "hsl(var(--state-over))" : "hsl(var(--state-under))" }}
              >
                {hover.edge.edgePct >= 0 ? "+" : ""}
                {hover.edge.edgePct}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}