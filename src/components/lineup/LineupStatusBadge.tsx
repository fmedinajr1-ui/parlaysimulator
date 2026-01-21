import React from 'react';
import { Badge } from '@/components/ui/badge';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  XCircle,
  HelpCircle,
  AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LineupAlert } from '@/hooks/useLineupCheck';

interface LineupStatusBadgeProps {
  alert?: LineupAlert;
  compact?: boolean;
  className?: string;
}

const STATUS_CONFIG: Record<string, {
  icon: React.ElementType;
  label: string;
  variant: 'destructive' | 'warning' | 'success' | 'secondary' | 'outline';
  className: string;
}> = {
  OUT: {
    icon: XCircle,
    label: 'OUT',
    variant: 'destructive',
    className: 'bg-red-500/20 text-red-400 border-red-500/30',
  },
  DOUBTFUL: {
    icon: AlertTriangle,
    label: 'DOUBTFUL',
    variant: 'destructive',
    className: 'bg-red-500/15 text-red-400 border-red-500/30',
  },
  GTD: {
    icon: Clock,
    label: 'GTD',
    variant: 'warning',
    className: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  },
  QUESTIONABLE: {
    icon: AlertCircle,
    label: 'Q',
    variant: 'warning',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  PROBABLE: {
    icon: CheckCircle2,
    label: 'PROB',
    variant: 'secondary',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  STARTING: {
    icon: CheckCircle2,
    label: 'START',
    variant: 'success',
    className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  },
  UNKNOWN: {
    icon: HelpCircle,
    label: '?',
    variant: 'outline',
    className: 'bg-muted/50 text-muted-foreground border-border',
  },
};

export function LineupStatusBadge({ alert, compact = false, className }: LineupStatusBadgeProps) {
  if (!alert) return null;

  const config = STATUS_CONFIG[alert.status] || STATUS_CONFIG.UNKNOWN;
  const Icon = config.icon;

  if (compact) {
    return (
      <span 
        className={cn(
          'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold',
          config.className,
          className
        )}
        title={alert.message}
      >
        <Icon className="h-3 w-3" />
      </span>
    );
  }

  return (
    <Badge 
      variant="outline"
      className={cn(
        'gap-1 text-[10px] font-semibold px-1.5 py-0.5',
        config.className,
        className
      )}
      title={alert.message}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

interface LineupRiskSummaryProps {
  summary: {
    critical: number;
    high: number;
    hasRisks: boolean;
    allClear: boolean;
  };
  className?: string;
}

export function LineupRiskSummary({ summary, className }: LineupRiskSummaryProps) {
  if (summary.allClear) {
    return (
      <Badge 
        variant="outline"
        className={cn(
          'gap-1 text-xs bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
          className
        )}
      >
        <CheckCircle2 className="h-3 w-3" />
        All Clear
      </Badge>
    );
  }

  if (summary.critical > 0) {
    return (
      <Badge 
        variant="outline"
        className={cn(
          'gap-1 text-xs bg-red-500/20 text-red-400 border-red-500/30 animate-pulse',
          className
        )}
      >
        <XCircle className="h-3 w-3" />
        {summary.critical} OUT
      </Badge>
    );
  }

  if (summary.high > 0) {
    return (
      <Badge 
        variant="outline"
        className={cn(
          'gap-1 text-xs bg-amber-500/20 text-amber-400 border-amber-500/30',
          className
        )}
      >
        <AlertTriangle className="h-3 w-3" />
        {summary.high} GTD
      </Badge>
    );
  }

  return null;
}
