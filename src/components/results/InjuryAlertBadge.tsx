import { AlertTriangle, AlertCircle, Info, UserX } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface InjuryAlert {
  player: string;
  team: string;
  status: 'OUT' | 'DOUBTFUL' | 'QUESTIONABLE' | 'PROBABLE' | 'DAY-TO-DAY';
  injuryType: string;
  injuryDetails: string;
  impactLevel: 'critical' | 'high' | 'medium' | 'low';
}

interface InjuryAlertBadgeProps {
  injury: InjuryAlert;
  compact?: boolean;
}

const statusColors = {
  OUT: { bg: 'bg-neon-red/20', text: 'text-neon-red', border: 'border-neon-red/30' },
  DOUBTFUL: { bg: 'bg-neon-orange/20', text: 'text-neon-orange', border: 'border-neon-orange/30' },
  QUESTIONABLE: { bg: 'bg-neon-yellow/20', text: 'text-neon-yellow', border: 'border-neon-yellow/30' },
  PROBABLE: { bg: 'bg-neon-green/20', text: 'text-neon-green', border: 'border-neon-green/30' },
  'DAY-TO-DAY': { bg: 'bg-neon-purple/20', text: 'text-neon-purple', border: 'border-neon-purple/30' },
};

const impactIcons = {
  critical: UserX,
  high: AlertTriangle,
  medium: AlertCircle,
  low: Info,
};

export function InjuryAlertBadge({ injury, compact = false }: InjuryAlertBadgeProps) {
  const colors = statusColors[injury.status] || statusColors.QUESTIONABLE;
  const Icon = impactIcons[injury.impactLevel] || AlertCircle;

  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text} border ${colors.border} cursor-help`}>
              <Icon className="w-3 h-3" />
              <span>{injury.status}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <div className="space-y-1">
              <p className="font-semibold">{injury.player}</p>
              <p className="text-xs text-muted-foreground">{injury.team}</p>
              <p className="text-xs">
                <span className="font-medium">{injury.injuryType}:</span> {injury.injuryDetails}
              </p>
              <p className={`text-xs font-medium ${colors.text}`}>
                Impact: {injury.impactLevel.toUpperCase()}
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className={`rounded-lg p-3 ${colors.bg} border ${colors.border}`}>
      <div className="flex items-start gap-2">
        <Icon className={`w-5 h-5 ${colors.text} shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{injury.player}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} border ${colors.border}`}>
              {injury.status}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{injury.team}</p>
          <p className="text-sm text-foreground mt-1">
            <span className="font-medium">{injury.injuryType}:</span> {injury.injuryDetails}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-muted-foreground">Impact:</span>
            <span className={`text-xs font-semibold ${colors.text} uppercase`}>
              {injury.impactLevel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface InjuryAlertsListProps {
  injuries: InjuryAlert[];
  title?: string;
}

export function InjuryAlertsList({ injuries, title = "Injury Alerts" }: InjuryAlertsListProps) {
  if (!injuries || injuries.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        <AlertTriangle className="w-3 h-3 text-neon-orange" />
        {title}
      </p>
      <div className="space-y-2">
        {injuries.map((injury, idx) => (
          <InjuryAlertBadge key={`${injury.player}-${idx}`} injury={injury} />
        ))}
      </div>
    </div>
  );
}
