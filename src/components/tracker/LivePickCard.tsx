import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Zap, 
  Target, 
  TrendingUp, 
  Brain, 
  AlertCircle, 
  Activity,
  CheckCircle2,
  XCircle,
  Clock
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { abbreviateTeamsInDescription, getTeamAbbreviation, extractMatchupFromDescription } from '@/lib/team-abbreviations';

interface TrackerPick {
  id: string;
  engine_name: string;
  sport: string;
  pick_description: string;
  player_name?: string;
  team_name?: string;
  prop_type?: string;
  line?: number;
  side?: string;
  odds?: number;
  confidence?: number;
  confidence_level?: string;
  signals?: any[];
  status: string;
  event_id?: string;
  game_time?: string;
  created_at: string;
}

const ENGINE_CONFIG: Record<string, { icon: typeof Zap; color: string; bg: string }> = {
  'Sharp Money': { icon: Zap, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  'Sharp': { icon: Zap, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  'God Mode': { icon: Brain, color: 'text-purple-500', bg: 'bg-purple-500/10' },
  'Juiced Props': { icon: Target, color: 'text-orange-500', bg: 'bg-orange-500/10' },
  'Juiced': { icon: Target, color: 'text-orange-500', bg: 'bg-orange-500/10' },
  'HitRate': { icon: TrendingUp, color: 'text-green-500', bg: 'bg-green-500/10' },
  'AI Parlay': { icon: Brain, color: 'text-cyan-500', bg: 'bg-cyan-500/10' },
  'Fatigue Edge': { icon: AlertCircle, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
  'Fatigue': { icon: AlertCircle, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
  'FanDuel Trap': { icon: Target, color: 'text-red-500', bg: 'bg-red-500/10' },
  'FanDuel': { icon: Target, color: 'text-red-500', bg: 'bg-red-500/10' },
  'Unified Props': { icon: Activity, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
  'Unified': { icon: Activity, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
};

const STATUS_CONFIG = {
  won: { icon: CheckCircle2, color: 'text-green-500', bg: 'bg-green-500/20', label: 'WON' },
  lost: { icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/20', label: 'LOST' },
  pending: { icon: Clock, color: 'text-yellow-500', bg: 'bg-yellow-500/20', label: 'LIVE' },
  push: { icon: Activity, color: 'text-muted-foreground', bg: 'bg-muted/20', label: 'PUSH' },
};

export function LivePickCard({ pick }: { pick: TrackerPick }) {
  const engineConfig = ENGINE_CONFIG[pick.engine_name] || ENGINE_CONFIG['Unified'];
  const statusConfig = STATUS_CONFIG[pick.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending;
  
  const Icon = engineConfig.icon;
  const StatusIcon = statusConfig.icon;

  const formatOdds = (odds?: number) => {
    if (!odds) return '';
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  const timeAgo = formatDistanceToNow(new Date(pick.created_at), { addSuffix: true });

  // Get abbreviated description and team
  const abbreviatedDescription = abbreviateTeamsInDescription(pick.pick_description, pick.sport);
  const teamAbbrev = pick.team_name ? getTeamAbbreviation(pick.team_name, pick.sport) : null;
  const matchupInfo = extractMatchupFromDescription(pick.pick_description, pick.sport);

  return (
    <Card className={`${engineConfig.bg} border-l-4 hover:bg-accent/50 transition-colors`} 
          style={{ borderLeftColor: `hsl(var(--${engineConfig.color.replace('text-', '')}))` }}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* Engine & Sport */}
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`h-4 w-4 ${engineConfig.color}`} />
              <span className={`text-xs font-medium ${engineConfig.color}`}>
                {pick.engine_name}
              </span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                {pick.sport}
              </Badge>
              {teamAbbrev && (
                <span className="text-[10px] font-medium text-foreground/70">
                  {teamAbbrev}
                </span>
              )}
              {matchupInfo && !teamAbbrev && (
                <span className="text-[10px] font-medium text-foreground/70">
                  {matchupInfo.matchup}
                </span>
              )}
            </div>

            {/* Pick Description */}
            <p className="text-sm font-medium line-clamp-2 mb-1">
              {abbreviatedDescription}
            </p>

            {/* Details Row */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {pick.odds && (
                <span className="font-mono">{formatOdds(pick.odds)}</span>
              )}
              {pick.confidence !== undefined && pick.confidence !== null && (
                <Badge 
                  variant="secondary" 
                  className={`text-[10px] ${
                    pick.confidence >= 70 ? 'bg-green-500/20 text-green-500' :
                    pick.confidence >= 50 ? 'bg-yellow-500/20 text-yellow-500' :
                    'bg-muted text-muted-foreground'
                  }`}
                >
                  {pick.confidence.toFixed(0)}%
                </Badge>
              )}
              <span>{timeAgo}</span>
            </div>
          </div>

          {/* Status Badge */}
          <Badge 
            className={`${statusConfig.bg} ${statusConfig.color} border-0 shrink-0`}
          >
            <StatusIcon className="h-3 w-3 mr-1" />
            {statusConfig.label}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
