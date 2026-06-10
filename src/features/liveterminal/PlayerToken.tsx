import type { TerminalPlayer } from "./types";
import { STATE_COLOR, STATE_PULSE } from "./state/stateColors";

type Props = {
  player: TerminalPlayer;
  cx: number;
  cy: number;
  onHover?: (p: TerminalPlayer | null) => void;
};

export function PlayerToken({ player, cx, cy, onHover }: Props) {
  const stateColor = STATE_COLOR[player.state];
  const pulse = STATE_PULSE[player.state];
  return (
    <g
      transform={`translate(${cx} ${cy})`}
      className="cursor-pointer"
      onMouseEnter={() => onHover?.(player)}
      onMouseLeave={() => onHover?.(null)}
    >
      {/* state ring (outer) */}
      <circle
        r={18}
        fill="none"
        stroke={stateColor}
        strokeWidth={2}
        opacity={0.95}
        className={pulse ? "term-pulse" : undefined}
      />
      {/* team ring */}
      <circle r={15} fill="hsl(var(--term-bg))" stroke={player.teamColor} strokeWidth={2.5} />
      {/* headshot / initials */}
      {player.headshot ? (
        <image href={player.headshot} x={-13} y={-13} width={26} height={26} clipPath="circle(13px at 13px 13px)" />
      ) : (
        <text textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={700} fill="hsl(var(--term-text))">
          {player.initials}
        </text>
      )}
      {/* jersey number chip */}
      <g transform="translate(13 -13)">
        <circle r={7} fill={player.teamColor} />
        <text textAnchor="middle" dominantBaseline="central" fontSize={8} fontWeight={800} fill="#fff">
          {player.number}
        </text>
      </g>
      {/* position label */}
      <text y={28} textAnchor="middle" fontSize={8} fill="hsl(var(--term-muted))" letterSpacing="0.08em">
        {player.position.toUpperCase()}
      </text>
      {/* ball carrier marker */}
      {player.isBallCarrier && (
        <>
          <circle r={22} fill="none" stroke="hsl(var(--state-volatility))" strokeWidth={1.5} opacity={0.7} className="term-pulse" />
          <polygon points="0,-26 -4,-32 4,-32" fill="hsl(var(--state-volatility))" />
        </>
      )}
    </g>
  );
}