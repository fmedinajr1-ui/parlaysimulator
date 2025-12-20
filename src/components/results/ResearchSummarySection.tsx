import { cn } from "@/lib/utils";
import { ResearchSummary, ResearchSignal } from "@/types/parlay";
import { ResearchSignalBadge } from "./ResearchSignalBadge";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, XCircle, AlertTriangle, MinusCircle, 
  TrendingUp, TrendingDown, Minus
} from "lucide-react";

interface ResearchSummarySectionProps {
  summary: ResearchSummary;
  compact?: boolean;
}

const verdictConfig: Record<ResearchSummary['overallVerdict'], {
  icon: React.ElementType;
  label: string;
  color: string;
  bg: string;
}> = {
  STRONG_PICK: {
    icon: CheckCircle2,
    label: 'Strong Pick',
    color: 'text-neon-green',
    bg: 'bg-neon-green/15 border-neon-green/40'
  },
  LEAN_PICK: {
    icon: TrendingUp,
    label: 'Lean Pick',
    color: 'text-neon-cyan',
    bg: 'bg-neon-cyan/15 border-neon-cyan/40'
  },
  NEUTRAL: {
    icon: Minus,
    label: 'Neutral',
    color: 'text-muted-foreground',
    bg: 'bg-muted/30 border-border/40'
  },
  LEAN_FADE: {
    icon: TrendingDown,
    label: 'Lean Fade',
    color: 'text-neon-orange',
    bg: 'bg-neon-orange/15 border-neon-orange/40'
  },
  STRONG_FADE: {
    icon: XCircle,
    label: 'Strong Fade',
    color: 'text-neon-red',
    bg: 'bg-neon-red/15 border-neon-red/40'
  }
};

export function ResearchSummarySection({ summary, compact = false }: ResearchSummarySectionProps) {
  const verdict = verdictConfig[summary.overallVerdict];
  const VerdictIcon = verdict.icon;

  // Group signals by status
  const positiveSignals = summary.signals.filter(s => s.status === 'positive');
  const negativeSignals = summary.signals.filter(s => s.status === 'negative');
  const neutralSignals = summary.signals.filter(s => s.status === 'neutral');

  if (compact) {
    return (
      <div className={cn("p-3 rounded-lg border", verdict.bg)}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <VerdictIcon className={cn("w-5 h-5", verdict.color)} />
            <span className={cn("font-semibold text-sm", verdict.color)}>
              {verdict.label}
            </span>
          </div>
          <Badge variant="outline" className={cn("text-xs", verdict.color)}>
            {summary.strengthScore}/100
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{summary.verdictReason}</p>
        
        {/* Compact signal badges */}
        <div className="flex flex-wrap gap-1 mt-2">
          {summary.signals.slice(0, 4).map((signal, idx) => (
            <ResearchSignalBadge key={idx} signal={signal} compact />
          ))}
          {summary.signals.length > 4 && (
            <span className="text-xs text-muted-foreground px-2 py-0.5">
              +{summary.signals.length - 4} more
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("p-4 rounded-lg border", verdict.bg)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <VerdictIcon className={cn("w-6 h-6", verdict.color)} />
          <div>
            <h4 className={cn("font-bold", verdict.color)}>{verdict.label}</h4>
            <p className="text-xs text-muted-foreground">Research Summary</p>
          </div>
        </div>
        <div className="text-right">
          <span className={cn("text-xl font-bold", verdict.color)}>
            {summary.strengthScore}
          </span>
          <p className="text-[10px] text-muted-foreground uppercase">Strength</p>
        </div>
      </div>

      {/* Verdict reason */}
      <p className="text-sm text-foreground mb-4 p-2 rounded bg-background/50">
        {summary.verdictReason}
      </p>

      {/* Positive signals */}
      {positiveSignals.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1 mb-2">
            <CheckCircle2 className="w-4 h-4 text-neon-green" />
            <span className="text-xs font-medium text-neon-green uppercase">
              Supporting Signals ({positiveSignals.length})
            </span>
          </div>
          <div className="space-y-1">
            {positiveSignals.map((signal, idx) => (
              <ResearchSignalBadge key={idx} signal={signal} />
            ))}
          </div>
        </div>
      )}

      {/* Negative signals */}
      {negativeSignals.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1 mb-2">
            <AlertTriangle className="w-4 h-4 text-neon-orange" />
            <span className="text-xs font-medium text-neon-orange uppercase">
              Warning Signals ({negativeSignals.length})
            </span>
          </div>
          <div className="space-y-1">
            {negativeSignals.map((signal, idx) => (
              <ResearchSignalBadge key={idx} signal={signal} />
            ))}
          </div>
        </div>
      )}

      {/* Neutral signals */}
      {neutralSignals.length > 0 && (
        <div>
          <div className="flex items-center gap-1 mb-2">
            <MinusCircle className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase">
              Neutral Signals ({neutralSignals.length})
            </span>
          </div>
          <div className="space-y-1">
            {neutralSignals.map((signal, idx) => (
              <ResearchSignalBadge key={idx} signal={signal} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
