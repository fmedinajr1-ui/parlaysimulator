import { cn } from "@/lib/utils";
import { 
  CircleDot, Target, TrendingUp, TrendingDown, 
  Users, Dumbbell
} from "lucide-react";

interface SportPropIconProps {
  sport?: string;
  betType?: 'moneyline' | 'spread' | 'total' | 'player_prop' | 'other';
  className?: string;
  showLabel?: boolean;
}

const sportEmojis: Record<string, string> = {
  nba: '🏀',
  basketball: '🏀',
  nfl: '🏈',
  football: '🏈',
  nhl: '🏒',
  hockey: '🏒',
  mlb: '⚾',
  baseball: '⚾',
  soccer: '⚽',
  mls: '⚽',
  tennis: '🎾',
  golf: '⛳',
  ufc: '🥊',
  mma: '🥊',
  ncaab: '🏀',
  ncaaf: '🏈',
  college_basketball: '🏀',
  college_football: '🏈',
};

const betTypeConfig: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  player_prop: {
    icon: Users,
    label: 'Player Prop',
    color: 'text-neon-cyan'
  },
  moneyline: {
    icon: Target,
    label: 'ML',
    color: 'text-neon-green'
  },
  spread: {
    icon: TrendingUp,
    label: 'Spread',
    color: 'text-neon-purple'
  },
  total: {
    icon: TrendingDown,
    label: 'O/U',
    color: 'text-neon-yellow'
  },
  other: {
    icon: CircleDot,
    label: 'Other',
    color: 'text-muted-foreground'
  }
};

export function SportPropIcon({ sport, betType, className, showLabel = false }: SportPropIconProps) {
  const sportKey = sport?.toLowerCase() || '';
  const sportEmoji = sportEmojis[sportKey] || '🎯';
  const betConfig = betTypeConfig[betType || 'other'] || betTypeConfig.other;
  const BetIcon = betConfig.icon;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <span className="text-sm" role="img" aria-label={sport || 'sport'}>
        {sportEmoji}
      </span>
      <BetIcon className={cn("w-3 h-3", betConfig.color)} />
      {showLabel && (
        <span className={cn("text-[10px] uppercase font-medium", betConfig.color)}>
          {betConfig.label}
        </span>
      )}
    </div>
  );
}

export function getSportEmoji(sport?: string): string {
  const sportKey = sport?.toLowerCase() || '';
  return sportEmojis[sportKey] || '🎯';
}

export function getBetTypeLabel(betType?: string): string {
  const config = betTypeConfig[betType || 'other'] || betTypeConfig.other;
  return config.label;
}
