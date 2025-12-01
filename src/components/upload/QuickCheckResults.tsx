import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Shield, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SharpSignal {
  type: 'real_sharp' | 'fake_sharp' | 'caution';
  message: string;
  confidence: number;
}

interface LegResult {
  description: string;
  riskLevel: 'safe' | 'caution' | 'danger';
  sharpSignals: SharpSignal[];
  hasSharpData: boolean;
  warnings: string[];
}

interface QuickCheckResultsProps {
  results: {
    legs: LegResult[];
    overallRisk: 'safe' | 'caution' | 'danger';
    hasSharpConflicts: boolean;
    suggestedAction: string;
  };
}

const getRiskIcon = (risk: 'safe' | 'caution' | 'danger') => {
  switch (risk) {
    case 'safe':
      return <CheckCircle2 className="w-4 h-4 text-neon-green" />;
    case 'caution':
      return <AlertTriangle className="w-4 h-4 text-neon-yellow" />;
    case 'danger':
      return <AlertTriangle className="w-4 h-4 text-neon-red" />;
  }
};

const getRiskEmoji = (risk: 'safe' | 'caution' | 'danger') => {
  switch (risk) {
    case 'safe': return '🟢';
    case 'caution': return '🟡';
    case 'danger': return '🔴';
  }
};

export function QuickCheckResults({ results }: QuickCheckResultsProps) {
  return (
    <Card className="p-4 space-y-4 border-border/50 bg-card/50">
      {/* Overall Status */}
      <div className="flex items-center justify-between pb-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">Quick Sharp Check</h3>
        </div>
        <Badge 
          variant="outline"
          className={cn(
            "font-medium",
            results.overallRisk === 'safe' && "border-neon-green/50 text-neon-green",
            results.overallRisk === 'caution' && "border-neon-yellow/50 text-neon-yellow",
            results.overallRisk === 'danger' && "border-neon-red/50 text-neon-red"
          )}
        >
          {getRiskIcon(results.overallRisk)}
          <span className="ml-1.5">
            {results.overallRisk === 'safe' && 'Clear'}
            {results.overallRisk === 'caution' && 'Caution'}
            {results.overallRisk === 'danger' && 'Warning'}
          </span>
        </Badge>
      </div>

      {/* Suggested Action */}
      <div className={cn(
        "p-3 rounded-lg text-sm font-medium",
        results.overallRisk === 'safe' && "bg-neon-green/10 text-neon-green border border-neon-green/20",
        results.overallRisk === 'caution' && "bg-neon-yellow/10 text-neon-yellow border border-neon-yellow/20",
        results.overallRisk === 'danger' && "bg-neon-red/10 text-neon-red border border-neon-red/20"
      )}>
        {results.suggestedAction}
      </div>

      {/* Leg Details */}
      <div className="space-y-2">
        {results.legs.map((leg, idx) => (
          <div
            key={idx}
            className="p-3 rounded-lg bg-muted/30 border border-border/30 space-y-2"
          >
            {/* Leg Header */}
            <div className="flex items-start gap-2">
              <span className="text-lg shrink-0">{getRiskEmoji(leg.riskLevel)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {leg.description}
                </p>
                {!leg.hasSharpData && (
                  <p className="text-xs text-muted-foreground mt-1">
                    No recent sharp data available
                  </p>
                )}
              </div>
            </div>

            {/* Sharp Signals */}
            {leg.sharpSignals.length > 0 && (
              <div className="space-y-1.5 pl-7">
                {leg.sharpSignals.map((signal, signalIdx) => (
                  <div
                    key={signalIdx}
                    className="flex items-start gap-2 text-xs"
                  >
                    {signal.type === 'real_sharp' && (
                      <TrendingUp className="w-3 h-3 text-neon-green shrink-0 mt-0.5" />
                    )}
                    {signal.type === 'fake_sharp' && (
                      <TrendingDown className="w-3 h-3 text-neon-red shrink-0 mt-0.5" />
                    )}
                    {signal.type === 'caution' && (
                      <AlertTriangle className="w-3 h-3 text-neon-yellow shrink-0 mt-0.5" />
                    )}
                    <span className={cn(
                      "flex-1",
                      signal.type === 'real_sharp' && "text-neon-green",
                      signal.type === 'fake_sharp' && "text-neon-red",
                      signal.type === 'caution' && "text-neon-yellow"
                    )}>
                      {signal.message}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Warnings */}
            {leg.warnings.length > 0 && (
              <div className="space-y-1 pl-7">
                {leg.warnings.map((warning, warnIdx) => (
                  <p key={warnIdx} className="text-xs text-muted-foreground">
                    • {warning}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Footer Info */}
      <div className="text-xs text-muted-foreground text-center pt-2 border-t border-border/30">
        Based on line movements from the last 6 hours
      </div>
    </Card>
  );
}
