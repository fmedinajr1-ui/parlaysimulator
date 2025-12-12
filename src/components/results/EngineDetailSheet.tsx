import { MobileDetailDrawer } from "@/components/ui/mobile-detail-drawer";
import { EngineSignal } from "@/types/parlay";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { 
  TrendingUp, Target, Percent, Flame, Zap, Activity, Star,
  CheckCircle2, XCircle, Circle, HelpCircle 
} from "lucide-react";

interface EngineDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  signal: EngineSignal | null;
}

const ENGINE_CONFIG: Record<string, { 
  icon: typeof TrendingUp; 
  colorClass: string; 
  label: string;
  description: string;
}> = {
  sharp: { 
    icon: TrendingUp, 
    colorClass: 'text-blue-400', 
    label: 'Sharp Money',
    description: 'Tracks where professional bettors are placing their money based on line movements and betting patterns.'
  },
  pvs: { 
    icon: Target, 
    colorClass: 'text-purple-400', 
    label: 'PVS Score',
    description: 'Player Value Score analyzes matchups, recent performance, and statistical projections.'
  },
  hitrate: { 
    icon: Percent, 
    colorClass: 'text-cyan-400', 
    label: 'Hit Rate',
    description: 'Historical success rate of similar props based on player patterns and game context.'
  },
  juiced: { 
    icon: Flame, 
    colorClass: 'text-yellow-400', 
    label: 'Juiced Props',
    description: 'Identifies heavily juiced lines where books are taking strong positions.'
  },
  godmode: { 
    icon: Zap, 
    colorClass: 'text-orange-400', 
    label: 'God Mode',
    description: 'Advanced upset detection and trap game identification system.'
  },
  fatigue: { 
    icon: Activity, 
    colorClass: 'text-red-400', 
    label: 'Fatigue',
    description: 'Analyzes team rest, travel, and schedule density impact on performance.'
  },
  bestbets: { 
    icon: Star, 
    colorClass: 'text-green-400', 
    label: 'Best Bets',
    description: 'Top consensus picks based on multi-engine agreement and historical accuracy.'
  }
};

const getStatusIcon = (status: EngineSignal['status']) => {
  switch (status) {
    case 'agree':
      return <CheckCircle2 className="h-6 w-6 text-neon-green" />;
    case 'disagree':
      return <XCircle className="h-6 w-6 text-neon-red" />;
    case 'neutral':
      return <Circle className="h-6 w-6 text-muted-foreground" />;
    case 'no_data':
      return <HelpCircle className="h-6 w-6 text-muted-foreground/50" />;
  }
};

const getStatusLabel = (status: EngineSignal['status']) => {
  switch (status) {
    case 'agree': return 'AGREES';
    case 'disagree': return 'DISAGREES';
    case 'neutral': return 'NEUTRAL';
    case 'no_data': return 'NO DATA';
  }
};

const getStatusBadgeClass = (status: EngineSignal['status']) => {
  switch (status) {
    case 'agree':
      return 'bg-neon-green/20 text-neon-green border-neon-green/30';
    case 'disagree':
      return 'bg-neon-red/20 text-neon-red border-neon-red/30';
    case 'neutral':
      return 'bg-muted/30 text-muted-foreground border-muted-foreground/20';
    case 'no_data':
      return 'bg-muted/10 text-muted-foreground/50 border-muted-foreground/10';
  }
};

const formatScore = (engine: string, score: number | null): string => {
  if (score === null) return 'N/A';
  
  switch (engine) {
    case 'sharp':
    case 'hitrate':
    case 'fatigue':
      return `${Math.round(score)}%`;
    case 'pvs':
      return score >= 80 ? 'S Tier' : score >= 65 ? 'A Tier' : score >= 50 ? 'B Tier' : score >= 35 ? 'C Tier' : 'D Tier';
    case 'godmode':
      return score >= 70 ? 'Strong Bet' : score >= 40 ? 'Watch' : 'Avoid';
    case 'juiced':
      return score > 0 ? 'Over Juiced' : score < 0 ? 'Under Juiced' : 'Even';
    case 'bestbets':
      return score > 0 ? 'Top Pick' : 'Not Selected';
    default:
      return String(score);
  }
};

export function EngineDetailSheet({ open, onOpenChange, signal }: EngineDetailSheetProps) {
  if (!signal) return null;

  const config = ENGINE_CONFIG[signal.engine.toLowerCase()] || {
    icon: Circle,
    colorClass: 'text-muted-foreground',
    label: signal.engine,
    description: 'Engine analysis data'
  };
  
  const IconComponent = config.icon;

  return (
    <MobileDetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={config.label}
      description="Engine Analysis"
      icon={<IconComponent className={cn("h-5 w-5", config.colorClass)} />}
      iconColorClass={config.colorClass.replace('text-', 'bg-') + '/20'}
    >
      <div className="space-y-4">
        {/* Status Section */}
        <div className={cn(
          "p-4 rounded-lg border flex items-center justify-between",
          signal.status === 'agree' ? "bg-neon-green/5 border-neon-green/20" :
          signal.status === 'disagree' ? "bg-neon-red/5 border-neon-red/20" :
          "bg-muted/20 border-border/50"
        )}>
          <div className="flex items-center gap-3">
            {getStatusIcon(signal.status)}
            <div>
              <div className="text-xs text-muted-foreground">Status</div>
              <div className="font-semibold">{getStatusLabel(signal.status)}</div>
            </div>
          </div>
          <Badge className={cn("text-sm", getStatusBadgeClass(signal.status))}>
            {formatScore(signal.engine.toLowerCase(), signal.score)}
          </Badge>
        </div>

        {/* Confidence */}
        {signal.confidence && (
          <div className="p-4 rounded-lg bg-card border border-border/50">
            <div className="text-xs text-muted-foreground mb-2">Confidence Level</div>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className={cn(
                    "h-full rounded-full transition-all",
                    signal.confidence >= 70 ? "bg-neon-green" :
                    signal.confidence >= 40 ? "bg-neon-yellow" :
                    "bg-neon-red"
                  )}
                  style={{ width: `${signal.confidence}%` }}
                />
              </div>
              <span className="font-mono font-bold text-sm">{signal.confidence}%</span>
            </div>
          </div>
        )}

        {/* Reason */}
        <div className="p-4 rounded-lg bg-card border border-border/50">
          <div className="text-xs text-muted-foreground mb-2">Analysis</div>
          <p className="text-sm text-foreground leading-relaxed">
            {signal.reason || config.description}
          </p>
        </div>

        {/* Engine Description */}
        <div className="p-3 rounded-lg bg-muted/30">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-semibold">About {config.label}:</span> {config.description}
          </p>
        </div>
      </div>
    </MobileDetailDrawer>
  );
}
