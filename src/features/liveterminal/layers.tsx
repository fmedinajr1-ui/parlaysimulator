import type { TerminalPlayer, Trajectory } from "./types";

export function TrailLayer({ players, w, h }: { players: TerminalPlayer[]; w: number; h: number }) {
  return (
    <g>
      {players.map((p) => {
        const pts = p.trail
          .map((t) => `${(t.x * w).toFixed(1)},${(t.y * h).toFixed(1)}`)
          .concat(`${(p.x * w).toFixed(1)},${(p.y * h).toFixed(1)}`)
          .join(" ");
        return (
          <polyline
            key={`trail-${p.id}`}
            points={pts}
            fill="none"
            stroke={p.teamColor}
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.35}
          />
        );
      })}
    </g>
  );
}

export function GhostLayer({ players, w, h }: { players: TerminalPlayer[]; w: number; h: number }) {
  return (
    <g>
      {players.map((p) =>
        p.ghost ? (
          <g key={`ghost-${p.id}`} transform={`translate(${p.ghost.x * w} ${p.ghost.y * h})`}>
            <circle
              r={14}
              fill="none"
              stroke={p.teamColor}
              strokeDasharray="3 3"
              strokeWidth={1.2}
              opacity={0.45}
              className="term-ghost-spin"
            />
            <line
              x1={(p.x - p.ghost.x) * w}
              y1={(p.y - p.ghost.y) * h}
              x2={0}
              y2={0}
              stroke={p.teamColor}
              strokeWidth={1}
              strokeDasharray="2 3"
              opacity={0.4}
            />
          </g>
        ) : null,
      )}
    </g>
  );
}

export function TrajectoryLayer({
  trajectories,
  w,
  h,
}: {
  trajectories: Trajectory[];
  w: number;
  h: number;
}) {
  return (
    <g>
      <defs>
        <marker id="term-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="hsl(var(--term-text))" opacity={0.8} />
        </marker>
      </defs>
      {trajectories.map((t, i) => {
        const x1 = t.from.x * w;
        const y1 = t.from.y * h;
        const x2 = t.to.x * w;
        const y2 = t.to.y * h;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2 - (t.kind === "shot" ? 60 : 20);
        const stroke =
          t.color ?? (t.kind === "shot" ? "hsl(var(--state-volatility))" : t.kind === "route" ? "hsl(var(--state-sharp))" : "hsl(var(--term-text))");
        return (
          <path
            key={`traj-${i}`}
            d={`M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`}
            fill="none"
            stroke={stroke}
            strokeWidth={1.6}
            strokeDasharray="4 4"
            opacity={0.75}
            markerEnd="url(#term-arrow)"
            className="term-draw"
          />
        );
      })}
    </g>
  );
}