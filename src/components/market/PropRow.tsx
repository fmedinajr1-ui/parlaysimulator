import { cn } from "@/lib/utils";
import { HeatBadge, HeatLevel } from "./HeatBadge";
import { Clock, Crown, Star, Shield, Crosshair, Users } from "lucide-react";

interface PropRowProps {
  playerName: string;
  propType: string;
  line: number;
  side: 'over' | 'under';
  engineScore: number;
  marketScore: number;
  heatScore: number;
  heatLevel: HeatLevel;
  playerRole: string;
  gameScript: string;
  hoursToTip: number;
  onClick?: () => void;
}

const ROLE_ICONS: Record<string, React.ElementType> = {
  'BALL_DOMINANT_STAR': Crown,
  'STAR': Star,
  'WING': Crosshair,
  'BIG': Shield,
  'SECONDARY_GUARD': Users,
};

const ROLE_LABELS: Record<string, string> = {
  'BALL_DOMINANT_STAR': 'Ball-Dom',
  'STAR': 'Star',
  'WING': 'Wing',
  'BIG': 'Big',
  'SECONDARY_GUARD': 'Guard',
};

function formatPropType(propType: string): string {
  return propType
    .replace(/_/g, ' ')
    .replace(/player /i, '')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function formatHoursToTip(hours: number): string {
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins}m`;
  }
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}

export function PropRow({
  playerName,
  propType,
  line,
  side,
  engineScore,
  marketScore,
  heatScore,
  heatLevel,
  playerRole,
  gameScript,
  hoursToTip,
  onClick,
}: PropRowProps) {
  const RoleIcon = ROLE_ICONS[playerRole] || Star;
  const roleLabel = ROLE_LABELS[playerRole] || playerRole;
  
  return (
    <div 
      onClick={onClick}
      className={cn(
        "p-3 rounded-lg border border-border/50 bg-card/50",
        "hover:bg-accent/50 hover:border-primary/30 transition-all cursor-pointer",
        "active:scale-[0.99]"
      )}
    >
      {/* Top Row: Heat + Player + Scores */}
      <div className="flex items-center gap-3">
        <HeatBadge level={heatLevel} />
        
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground truncate">
            {playerName}
          </div>
          <div className="text-sm text-muted-foreground">
            {formatPropType(propType)} <span className={side === 'over' ? 'text-green-400' : 'text-red-400'}>
              {side === 'over' ? 'O' : 'U'}
            </span> {line}
          </div>
        </div>
        
        <div className="flex items-center gap-4 text-right shrink-0">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Engine</div>
            <div className="font-mono font-semibold text-foreground">{engineScore.toFixed(1)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Market</div>
            <div className="font-mono font-semibold text-foreground">{marketScore}</div>
          </div>
        </div>
      </div>
      
      {/* Bottom Row: Role + Script + Time */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RoleIcon className="w-3.5 h-3.5 text-primary" />
          <span>{roleLabel}</span>
          <span className="text-border">•</span>
          <span>{gameScript}</span>
        </div>
        
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span>{formatHoursToTip(hoursToTip)}</span>
        </div>
      </div>
    </div>
  );
}
