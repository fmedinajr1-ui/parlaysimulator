import { cn } from "@/lib/utils";
import { HeatBadge, HeatLevel } from "./HeatBadge";
import { Clock, Crown, Star, Shield, Crosshair, Users, Zap, AlertTriangle, CheckCircle, XCircle, Minus } from "lucide-react";
import { PlayerReliabilityBadge } from "@/components/props/PlayerReliabilityBadge";

interface SharpAlertData {
  level: string;
  movementPts: number;
  direction: string;
  isTrap: boolean;
}

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
  sharpAlert?: SharpAlertData;
  outcome?: 'pending' | 'hit' | 'miss' | 'push' | null;
  actualValue?: number | null;
  onClick?: () => void;
  playerHitRate?: number | null;
  playerReliabilityTier?: string | null;
  reliabilityModifier?: number | null;
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
  sharpAlert,
  outcome,
  actualValue,
  onClick,
  playerHitRate,
  playerReliabilityTier,
  reliabilityModifier,
}: PropRowProps) {
  const RoleIcon = ROLE_ICONS[playerRole] || Star;
  const roleLabel = ROLE_LABELS[playerRole] || playerRole;
  const bookLabel = bookmaker ? BOOKMAKER_LABELS[bookmaker.toLowerCase()] || bookmaker.toUpperCase().slice(0, 3) : null;
  
  // Sharp alert styling
  const hasSharpAlert = !!sharpAlert;
  const isTrap = sharpAlert?.isTrap;
  
  return (
    <div 
      onClick={onClick}
      className={cn(
        "p-3 rounded-lg border border-border/50 bg-card/50",
        "hover:bg-accent/50 hover:border-primary/30 transition-all cursor-pointer",
        "active:scale-[0.99]",
        hasSharpAlert && !isTrap && "border-red-500/50 bg-red-500/5",
        isTrap && "border-yellow-500/50 bg-yellow-500/5"
      )}
    >
      {/* Top Row: Heat + Player + Scores + Sharp Alert + Outcome */}
      <div className="flex items-center gap-3">
        <HeatBadge level={heatLevel} />
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground truncate">
              {playerName}
            </span>
            <PlayerReliabilityBadge 
              tier={playerReliabilityTier}
              hitRate={playerHitRate}
              modifier={reliabilityModifier}
            />
            {/* Outcome Badge */}
            {outcome === 'hit' && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/30">
                <CheckCircle className="w-3 h-3" />
                <span>WON</span>
                {actualValue !== null && actualValue !== undefined && (
                  <span className="opacity-80">({actualValue})</span>
                )}
              </div>
            )}
            {outcome === 'miss' && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 text-xs font-bold border border-red-500/30">
                <XCircle className="w-3 h-3" />
                <span>LOST</span>
                {actualValue !== null && actualValue !== undefined && (
                  <span className="opacity-80">({actualValue})</span>
                )}
              </div>
            )}
            {outcome === 'push' && (
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold border border-amber-500/30">
                <Minus className="w-3 h-3" />
                <span>PUSH</span>
                {actualValue !== null && actualValue !== undefined && (
                  <span className="opacity-80">({actualValue})</span>
                )}
              </div>
            )}
            {/* Sharp Alert Badge */}
            {hasSharpAlert && !outcome && (
              <div className={cn(
                "flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold animate-pulse",
                isTrap 
                  ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30" 
                  : "bg-red-500/20 text-red-400 border border-red-500/30"
              )}>
                {isTrap ? (
                  <>
                    <AlertTriangle className="w-3 h-3" />
                    <span>TRAP</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3 h-3" />
                    <span>SHARP</span>
                  </>
                )}
                {sharpAlert && sharpAlert.movementPts > 0 && (
                  <span className="opacity-80">
                    {sharpAlert.direction === 'shortened' ? '↓' : '↑'}
                    {Math.round(sharpAlert.movementPts)}
                  </span>
                )}
              </div>
            )}
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
