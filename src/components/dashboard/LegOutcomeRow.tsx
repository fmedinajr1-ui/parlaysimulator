import { cn } from "@/lib/utils";
import { Check, X, Clock } from "lucide-react";

export interface LegData {
  player: string;
  prop: string;
  line: number;
  side: 'over' | 'under' | string;
  outcome?: 'hit' | 'miss' | 'push' | 'won' | 'lost' | 'pending' | null;
  actual_value?: number | null;
}

interface LegOutcomeRowProps {
  leg: LegData;
  isLastLeg?: boolean;
}

function formatPropType(prop: string): string {
  const map: Record<string, string> = {
    'player_points': 'PTS',
    'player_rebounds': 'REB',
    'player_assists': 'AST',
    'player_threes': '3PM',
    'player_steals': 'STL',
    'player_blocks': 'BLK',
    'player_turnovers': 'TO',
    'player_points_rebounds_assists': 'PRA',
    'player_points_rebounds': 'PR',
    'player_points_assists': 'PA',
    'player_rebounds_assists': 'RA',
    'player_double_double': 'DD',
  };
  return map[prop?.toLowerCase()] || prop?.replace('player_', '').toUpperCase().slice(0, 3) || 'PROP';
}

function normalizeOutcome(outcome: string | null | undefined): 'won' | 'lost' | 'push' | 'pending' {
  if (!outcome) return 'pending';
  const normalized = outcome.toLowerCase().trim();
  if (normalized === 'hit' || normalized === 'won') return 'won';
  if (normalized === 'miss' || normalized === 'lost') return 'lost';
  if (normalized === 'push') return 'push';
  return 'pending';
}

export function LegOutcomeRow({ leg, isLastLeg }: LegOutcomeRowProps) {
  const outcome = normalizeOutcome(leg.outcome);
  const sideLabel = leg.side?.toLowerCase() === 'over' ? 'O' : 'U';
  const hasActual = leg.actual_value !== null && leg.actual_value !== undefined;
  
  const config = {
    won: {
      icon: Check,
      iconClassName: 'text-green-500',
      bgClassName: 'bg-green-500/10',
      textClassName: 'text-green-500',
      label: 'HIT',
    },
    lost: {
      icon: X,
      iconClassName: 'text-red-500',
      bgClassName: 'bg-red-500/10',
      textClassName: 'text-red-500',
      label: 'MISS',
    },
    push: {
      icon: Check,
      iconClassName: 'text-yellow-500',
      bgClassName: 'bg-yellow-500/10',
      textClassName: 'text-yellow-500',
      label: 'PUSH',
    },
    pending: {
      icon: Clock,
      iconClassName: 'text-muted-foreground',
      bgClassName: 'bg-muted/30',
      textClassName: 'text-muted-foreground',
      label: 'PENDING',
    },
  };

  const { icon: Icon, iconClassName, bgClassName, textClassName, label } = config[outcome];

  return (
    <div 
      className={cn(
        "flex items-center justify-between py-2 px-3 rounded-lg transition-colors",
        bgClassName,
        !isLastLeg && "mb-1.5"
      )}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Icon className={cn("h-4 w-4 shrink-0", iconClassName)} />
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span className="font-medium text-sm truncate">{leg.player}</span>
          <span className="text-xs text-muted-foreground shrink-0">
            {formatPropType(leg.prop)} {sideLabel}{leg.line}
          </span>
        </div>
      </div>
      
      <div className="flex items-center gap-2 shrink-0">
        {hasActual && (
          <span className={cn("text-sm font-semibold", textClassName)}>
            → {leg.actual_value}
          </span>
        )}
        <span className={cn(
          "text-[10px] font-bold px-1.5 py-0.5 rounded",
          outcome === 'lost' && "bg-red-500/20 text-red-500",
          outcome === 'won' && "bg-green-500/20 text-green-500",
          outcome === 'push' && "bg-yellow-500/20 text-yellow-500",
          outcome === 'pending' && "bg-muted text-muted-foreground"
        )}>
          {label}
        </span>
      </div>
    </div>
  );
}
