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
  overPrice?: number | null;
  underPrice?: number | null;
  bookmaker?: string | null;
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

const BOOKMAKER_LABELS: Record<string, string> = {
  'fanduel': 'FD',
  'draftkings': 'DK',
  'betmgm': 'MGM',
  'caesars': 'CZR',
  'pointsbet': 'PB',
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

function formatOdds(price: number | null | undefined): string {
  if (price === null || price === undefined) return '-';
  return price > 0 ? `+${price}` : `${price}`;
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
  overPrice,
  underPrice,
  bookmaker,
  onClick,
}: PropRowProps) {
  const RoleIcon = ROLE_ICONS[playerRole] || Star;
  const roleLabel = ROLE_LABELS[playerRole] || playerRole;
  const bookLabel = bookmaker ? BOOKMAKER_LABELS[bookmaker.toLowerCase()] || bookmaker.toUpperCase().slice(0, 3) : null;
  
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
          <div className="text-sm text-muted-foreground flex items-center gap-1">
            {formatPropType(propType)} <span className={side === 'over' ? 'text-green-400' : 'text-red-400'}>
              {side === 'over' ? 'O' : 'U'}
            </span> {line}
            {/* Live Odds Display */}
            {(overPrice !== null || underPrice !== null) && (
              <span className="ml-2 font-mono text-xs">
                <span className="text-green-400">{formatOdds(overPrice)}</span>
                <span className="text-muted-foreground">/</span>
                <span className="text-red-400">{formatOdds(underPrice)}</span>
              </span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-4 text-right shrink-0">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Engine</div>
            <div className="font-mono font-semibold text-foreground">{engineScore.toFixed(1)}</div>
          </div>
          {bookLabel && (
            <div className="px-2 py-1 rounded bg-primary/10 text-primary text-xs font-semibold">
              {bookLabel}
            </div>
          )}
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
