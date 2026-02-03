import { cn } from "@/lib/utils";
import type { ShotChartAnalysis, ZoneMatchup, ZoneType } from "@/types/sweetSpot";
import { ZONE_NAMES } from "@/hooks/useShotChartAnalysis";

interface ShotChartMatchupProps {
  analysis: ShotChartAnalysis;
  compact?: boolean;
}

// Get color class based on matchup grade
function getZoneColor(grade?: 'advantage' | 'neutral' | 'disadvantage'): string {
  switch (grade) {
    case 'advantage':
      return 'fill-primary/40 stroke-primary';
    case 'disadvantage':
      return 'fill-destructive/40 stroke-destructive';
    case 'neutral':
    default:
      return 'fill-warning/30 stroke-warning';
  }
}

// Get text color based on matchup grade
function getTextColor(grade?: 'advantage' | 'neutral' | 'disadvantage'): string {
  switch (grade) {
    case 'advantage':
      return 'fill-primary';
    case 'disadvantage':
      return 'fill-destructive';
    default:
      return 'fill-warning';
  }
}

// Zone positions for SVG half-court
const ZONE_POSITIONS: Record<ZoneType, { x: number; y: number; labelX: number; labelY: number }> = {
  restricted_area: { x: 200, y: 60, labelX: 200, labelY: 75 },
  paint: { x: 200, y: 140, labelX: 200, labelY: 155 },
  mid_range: { x: 200, y: 230, labelX: 200, labelY: 245 },
  corner_3: { x: 50, y: 80, labelX: 50, labelY: 95 },
  above_break_3: { x: 200, y: 330, labelX: 200, labelY: 345 },
};

export function ShotChartMatchup({ analysis, compact = false }: ShotChartMatchupProps) {
  const getZoneMatchup = (zone: ZoneType): ZoneMatchup | undefined => {
    return analysis.zones.find(z => z.zone === zone);
  };

  if (compact) {
    // Compact inline display
    return (
      <div className="flex flex-wrap gap-1.5">
        {analysis.zones.map(zone => (
          <div
            key={zone.zone}
            className={cn(
              "px-1.5 py-0.5 rounded text-[10px] font-medium",
              zone.matchupGrade === 'advantage' && "bg-primary/20 text-primary",
              zone.matchupGrade === 'disadvantage' && "bg-destructive/20 text-destructive",
              zone.matchupGrade === 'neutral' && "bg-warning/20 text-warning",
            )}
            title={`${ZONE_NAMES[zone.zone]}: ${Math.round(zone.playerFrequency * 100)}% of shots`}
          >
            {zone.zone === 'restricted_area' && '🎯'}
            {zone.zone === 'paint' && '🎨'}
            {zone.zone === 'mid_range' && '📍'}
            {zone.zone === 'corner_3' && '📐'}
            {zone.zone === 'above_break_3' && '🏀'}
            {Math.round(zone.playerFrequency * 100)}%
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="relative w-full max-w-[180px]">
      {/* Half Court SVG */}
      <svg viewBox="0 0 400 380" className="w-full h-auto">
        {/* Court background */}
        <rect x="0" y="0" width="400" height="380" className="fill-background stroke-border" strokeWidth="2" />
        
        {/* Above Break 3 (top arc area) */}
        <path
          d={`M 20 350 
              L 20 140 
              Q 20 40, 200 40 
              Q 380 40, 380 140 
              L 380 350 
              L 320 350
              L 320 140
              Q 320 100, 200 100
              Q 80 100, 80 140
              L 80 350
              Z`}
          className={cn("transition-colors", getZoneColor(getZoneMatchup('above_break_3')?.matchupGrade))}
          strokeWidth="1"
        />
        
        {/* Left Corner 3 */}
        <rect
          x="20" y="140" width="60" height="210"
          className={cn("transition-colors", getZoneColor(getZoneMatchup('corner_3')?.matchupGrade))}
          strokeWidth="1"
        />
        
        {/* Right Corner 3 */}
        <rect
          x="320" y="140" width="60" height="210"
          className={cn("transition-colors", getZoneColor(getZoneMatchup('corner_3')?.matchupGrade))}
          strokeWidth="1"
        />
        
        {/* Mid-Range area */}
        <path
          d={`M 80 350 
              L 80 140 
              Q 80 100, 200 100 
              Q 320 100, 320 140 
              L 320 350 
              L 260 350
              L 260 220
              Q 260 160, 200 160
              Q 140 160, 140 220
              L 140 350
              Z`}
          className={cn("transition-colors", getZoneColor(getZoneMatchup('mid_range')?.matchupGrade))}
          strokeWidth="1"
        />
        
        {/* Paint (non-RA) */}
        <rect
          x="140" y="220" width="120" height="130"
          className={cn("transition-colors", getZoneColor(getZoneMatchup('paint')?.matchupGrade))}
          strokeWidth="1"
        />
        
        {/* Restricted Area (semi-circle at basket) */}
        <path
          d={`M 140 350 
              L 140 330 
              Q 140 280, 200 280 
              Q 260 280, 260 330 
              L 260 350 
              Z`}
          className={cn("transition-colors", getZoneColor(getZoneMatchup('restricted_area')?.matchupGrade))}
          strokeWidth="1"
        />
        
        {/* Basket/Rim */}
        <circle cx="200" cy="355" r="8" className="fill-none stroke-foreground" strokeWidth="2" />
        
        {/* Zone frequency labels */}
        {analysis.zones.map(zone => {
          const pos = ZONE_POSITIONS[zone.zone];
          // Adjust position for corner_3 (show both corners)
          if (zone.zone === 'corner_3') {
            return (
              <g key={zone.zone}>
                <text
                  x={50}
                  y={250}
                  textAnchor="middle"
                  className={cn("text-[11px] font-bold", getTextColor(zone.matchupGrade))}
                >
                  {Math.round(zone.playerFrequency * 100)}%
                </text>
                <text
                  x={350}
                  y={250}
                  textAnchor="middle"
                  className={cn("text-[11px] font-bold", getTextColor(zone.matchupGrade))}
                >
                  {Math.round(zone.playerFrequency * 100)}%
                </text>
              </g>
            );
          }
          
          // Adjust Y positions for better visibility
          const adjustedY = zone.zone === 'restricted_area' ? 320 :
                           zone.zone === 'paint' ? 280 :
                           zone.zone === 'mid_range' ? 190 :
                           zone.zone === 'above_break_3' ? 70 : pos.labelY;
          
          return (
            <text
              key={zone.zone}
              x={pos.labelX}
              y={adjustedY}
              textAnchor="middle"
              className={cn("text-[11px] font-bold", getTextColor(zone.matchupGrade))}
            >
              {Math.round(zone.playerFrequency * 100)}%
            </text>
          );
        })}
      </svg>
      
      {/* Legend */}
      <div className="flex justify-center gap-3 text-[10px] mt-1">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-primary"></span>
          <span className="text-muted-foreground">Adv</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-warning"></span>
          <span className="text-muted-foreground">Neu</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-destructive"></span>
          <span className="text-muted-foreground">Dis</span>
        </span>
      </div>
    </div>
  );
}
