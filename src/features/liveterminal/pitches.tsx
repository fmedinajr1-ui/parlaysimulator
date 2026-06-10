// SVG pitch backgrounds — all draw inside a 1000x600 viewBox.

const STROKE = "hsl(var(--term-grid))";
const FILL = "hsl(var(--term-bg))";
const LINE = "hsl(var(--term-muted))";

export const PITCH_W = 1000;
export const PITCH_H = 600;

export function BasketballPitch() {
  return (
    <g>
      <rect x={0} y={0} width={PITCH_W} height={PITCH_H} fill={FILL} />
      <rect x={20} y={20} width={PITCH_W - 40} height={PITCH_H - 40} fill="none" stroke={LINE} strokeWidth={1.5} />
      <line x1={PITCH_W / 2} y1={20} x2={PITCH_W / 2} y2={PITCH_H - 20} stroke={LINE} strokeWidth={1.5} />
      <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={60} fill="none" stroke={LINE} strokeWidth={1.5} />
      {/* paint */}
      <rect x={20} y={PITCH_H / 2 - 90} width={150} height={180} fill="none" stroke={LINE} strokeWidth={1.5} />
      <rect x={PITCH_W - 170} y={PITCH_H / 2 - 90} width={150} height={180} fill="none" stroke={LINE} strokeWidth={1.5} />
      {/* hoops */}
      <circle cx={60} cy={PITCH_H / 2} r={8} fill="none" stroke={LINE} strokeWidth={1.5} />
      <circle cx={PITCH_W - 60} cy={PITCH_H / 2} r={8} fill="none" stroke={LINE} strokeWidth={1.5} />
      {/* 3pt arcs */}
      <path d={`M 20 ${PITCH_H / 2 - 220} A 240 240 0 0 1 20 ${PITCH_H / 2 + 220}`} fill="none" stroke={LINE} strokeWidth={1.5} />
      <path
        d={`M ${PITCH_W - 20} ${PITCH_H / 2 - 220} A 240 240 0 0 0 ${PITCH_W - 20} ${PITCH_H / 2 + 220}`}
        fill="none"
        stroke={LINE}
        strokeWidth={1.5}
      />
      <GridOverlay />
    </g>
  );
}

export function FootballPitch() {
  return (
    <g>
      <rect x={0} y={0} width={PITCH_W} height={PITCH_H} fill={FILL} />
      <rect x={20} y={20} width={PITCH_W - 40} height={PITCH_H - 40} fill="none" stroke={LINE} strokeWidth={1.5} />
      {/* endzones */}
      <rect x={20} y={20} width={80} height={PITCH_H - 40} fill="hsl(var(--term-grid))" opacity={0.5} />
      <rect x={PITCH_W - 100} y={20} width={80} height={PITCH_H - 40} fill="hsl(var(--term-grid))" opacity={0.5} />
      {/* yard lines every 10 */}
      {Array.from({ length: 9 }).map((_, i) => {
        const x = 100 + ((PITCH_W - 200) * (i + 1)) / 10;
        return <line key={i} x1={x} y1={20} x2={x} y2={PITCH_H - 20} stroke={LINE} strokeWidth={1} opacity={0.6} />;
      })}
      {/* hashes */}
      {Array.from({ length: 19 }).map((_, i) => {
        const x = 100 + ((PITCH_W - 200) * (i + 1)) / 20;
        return (
          <g key={i} opacity={0.4}>
            <line x1={x} y1={PITCH_H / 2 - 6} x2={x} y2={PITCH_H / 2 + 6} stroke={LINE} />
          </g>
        );
      })}
      <GridOverlay />
    </g>
  );
}

export function BaseballDiamond() {
  const cx = PITCH_W / 2;
  const cy = PITCH_H * 0.78;
  const size = 220;
  return (
    <g>
      <rect x={0} y={0} width={PITCH_W} height={PITCH_H} fill={FILL} />
      {/* outfield arc */}
      <path d={`M 80 ${cy} A 420 420 0 0 1 ${PITCH_W - 80} ${cy}`} fill="hsl(var(--term-grid))" opacity={0.4} stroke={LINE} strokeWidth={1.5} />
      {/* infield diamond */}
      <polygon
        points={`${cx},${cy} ${cx + size / 2},${cy - size / 2} ${cx},${cy - size} ${cx - size / 2},${cy - size / 2}`}
        fill="none"
        stroke={LINE}
        strokeWidth={1.5}
      />
      {/* bases */}
      {[
        [cx, cy],
        [cx + size / 2, cy - size / 2],
        [cx, cy - size],
        [cx - size / 2, cy - size / 2],
      ].map(([x, y], i) => (
        <rect key={i} x={x - 5} y={y - 5} width={10} height={10} fill={LINE} transform={`rotate(45 ${x} ${y})`} />
      ))}
      {/* mound */}
      <circle cx={cx} cy={cy - size / 2} r={14} fill="none" stroke={LINE} strokeWidth={1.5} />
      <GridOverlay />
    </g>
  );
}

export function HockeyRink() {
  return (
    <g>
      <rect x={0} y={0} width={PITCH_W} height={PITCH_H} fill={FILL} />
      <rect x={40} y={40} width={PITCH_W - 80} height={PITCH_H - 80} rx={60} ry={60} fill="none" stroke={LINE} strokeWidth={1.5} />
      <line x1={PITCH_W / 2} y1={40} x2={PITCH_W / 2} y2={PITCH_H - 40} stroke="hsl(var(--state-under))" strokeWidth={1.5} opacity={0.7} />
      <line x1={PITCH_W / 3} y1={40} x2={PITCH_W / 3} y2={PITCH_H - 40} stroke="hsl(var(--state-sharp))" strokeWidth={1.5} opacity={0.7} />
      <line x1={(PITCH_W / 3) * 2} y1={40} x2={(PITCH_W / 3) * 2} y2={PITCH_H - 40} stroke="hsl(var(--state-sharp))" strokeWidth={1.5} opacity={0.7} />
      <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={40} fill="none" stroke={LINE} strokeWidth={1.5} />
      {/* creases */}
      <path d={`M 60 ${PITCH_H / 2 - 30} A 30 30 0 0 1 60 ${PITCH_H / 2 + 30}`} fill="none" stroke={LINE} strokeWidth={1.5} />
      <path d={`M ${PITCH_W - 60} ${PITCH_H / 2 - 30} A 30 30 0 0 0 ${PITCH_W - 60} ${PITCH_H / 2 + 30}`} fill="none" stroke={LINE} strokeWidth={1.5} />
      <GridOverlay />
    </g>
  );
}

export function SoccerPitch() {
  return (
    <g>
      <rect x={0} y={0} width={PITCH_W} height={PITCH_H} fill={FILL} />
      <rect x={20} y={20} width={PITCH_W - 40} height={PITCH_H - 40} fill="none" stroke={LINE} strokeWidth={1.5} />
      <line x1={PITCH_W / 2} y1={20} x2={PITCH_W / 2} y2={PITCH_H - 20} stroke={LINE} strokeWidth={1.5} />
      <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={60} fill="none" stroke={LINE} strokeWidth={1.5} />
      <rect x={20} y={PITCH_H / 2 - 130} width={120} height={260} fill="none" stroke={LINE} strokeWidth={1.5} />
      <rect x={PITCH_W - 140} y={PITCH_H / 2 - 130} width={120} height={260} fill="none" stroke={LINE} strokeWidth={1.5} />
      <rect x={20} y={PITCH_H / 2 - 60} width={50} height={120} fill="none" stroke={LINE} strokeWidth={1.5} />
      <rect x={PITCH_W - 70} y={PITCH_H / 2 - 60} width={50} height={120} fill="none" stroke={LINE} strokeWidth={1.5} />
      <GridOverlay />
    </g>
  );
}

function GridOverlay() {
  // subtle Bloomberg-grid feel
  return (
    <g opacity={0.08}>
      {Array.from({ length: 20 }).map((_, i) => (
        <line key={`gv-${i}`} x1={(PITCH_W / 20) * i} y1={0} x2={(PITCH_W / 20) * i} y2={PITCH_H} stroke={STROKE} />
      ))}
      {Array.from({ length: 12 }).map((_, i) => (
        <line key={`gh-${i}`} x1={0} y1={(PITCH_H / 12) * i} x2={PITCH_W} y2={(PITCH_H / 12) * i} stroke={STROKE} />
      ))}
    </g>
  );
}

export function pitchFor(sport: string) {
  const s = sport.toUpperCase();
  if (s === "NBA" || s === "WNBA" || s === "NCAAB") return <BasketballPitch />;
  if (s === "NFL" || s === "NCAAF") return <FootballPitch />;
  if (s === "MLB") return <BaseballDiamond />;
  if (s === "NHL") return <HockeyRink />;
  return <SoccerPitch />;
}