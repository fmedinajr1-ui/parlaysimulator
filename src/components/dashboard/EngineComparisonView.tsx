import { useEngineComparison } from "@/hooks/useEngineComparison";
import { cn } from "@/lib/utils";
import { Target, BarChart3, Zap, Flame, Users, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

const consensusConfig = {
  unanimous: { 
    label: 'Unanimous', 
    color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    icon: CheckCircle2
  },
  majority: { 
    label: 'Majority', 
    color: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    icon: Users
  },
  split: { 
    label: 'Split', 
    color: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    icon: AlertTriangle
  },
  single: { 
    label: 'Single', 
    color: 'bg-muted text-muted-foreground border-border',
    icon: XCircle
  }
};

export function EngineComparisonView() {
  const { data, isLoading } = useEngineComparison();

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-card border border-border/50 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-1/3" />
          <div className="h-32 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (!data || data.rows.length === 0) {
    return (
      <div className="rounded-2xl bg-card border border-border/50 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-foreground">Engine Comparison</h3>
        </div>
        <p className="text-sm text-muted-foreground text-center py-8">
          No picks to compare yet. Run engine scans to see correlation data.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-card border border-border/50 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground">Engine Correlation</h3>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">{data.stats.multiEngine} multi-engine props</span>
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              {data.stats.unanimous} unanimous
            </Badge>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-4 gap-2 p-3 bg-muted/30 border-b border-border/30">
        <div className="text-center">
          <div className="text-lg font-bold text-foreground">{data.stats.totalProps}</div>
          <div className="text-[10px] text-muted-foreground">Total Props</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-blue-400">{data.stats.multiEngine}</div>
          <div className="text-[10px] text-muted-foreground">Multi-Engine</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-emerald-400">{data.stats.unanimous}</div>
          <div className="text-[10px] text-muted-foreground">Unanimous</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-amber-400">{data.stats.split}</div>
          <div className="text-[10px] text-muted-foreground">Split</div>
        </div>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-[1fr,80px,40px,40px,40px,40px,70px] gap-1 px-3 py-2 bg-muted/20 text-xs font-medium text-muted-foreground border-b border-border/30">
        <div>Player / Prop</div>
        <div className="text-center">Line</div>
        <div className="text-center" title="NBA Risk Engine">
          <Target className="w-3.5 h-3.5 mx-auto text-blue-400" />
        </div>
        <div className="text-center" title="Prop Engine v2">
          <BarChart3 className="w-3.5 h-3.5 mx-auto text-purple-400" />
        </div>
        <div className="text-center" title="Sharp Builder">
          <Zap className="w-3.5 h-3.5 mx-auto text-amber-400" />
        </div>
        <div className="text-center" title="Heat Engine">
          <Flame className="w-3.5 h-3.5 mx-auto text-orange-400" />
        </div>
        <div className="text-center">Status</div>
      </div>

      {/* Comparison Rows */}
      <ScrollArea className="max-h-[400px]">
        <div className="divide-y divide-border/20">
          {data.rows.slice(0, 30).map((row, idx) => {
            const config = consensusConfig[row.consensus];
            const ConsensusIcon = config.icon;
            
            return (
              <div
                key={idx}
                className={cn(
                  "grid grid-cols-[1fr,80px,40px,40px,40px,40px,70px] gap-1 px-3 py-2.5 items-center",
                  "hover:bg-muted/30 transition-colors",
                  row.consensus === 'unanimous' && "bg-emerald-500/5"
                )}
              >
                {/* Player & Prop */}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">
                    {row.player_name}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {row.prop_type}
                  </div>
                </div>

                {/* Line */}
                <div className="text-center text-sm font-mono text-foreground">
                  {row.line > 0 ? row.line.toFixed(1) : '--'}
                </div>

                {/* Risk Engine */}
                <div className="flex justify-center">
                  {row.riskEngine ? (
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold",
                      row.riskEngine.side?.toLowerCase() === 'over' 
                        ? "bg-emerald-500/20 text-emerald-400" 
                        : "bg-red-500/20 text-red-400"
                    )}>
                      {row.riskEngine.side?.toLowerCase() === 'over' ? 'O' : 'U'}
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-muted/30 flex items-center justify-center text-muted-foreground text-[10px]">
                      -
                    </div>
                  )}
                </div>

                {/* Prop v2 */}
                <div className="flex justify-center">
                  {row.propV2 ? (
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold",
                      row.propV2.side?.toLowerCase() === 'over' 
                        ? "bg-emerald-500/20 text-emerald-400" 
                        : "bg-red-500/20 text-red-400"
                    )}>
                      {row.propV2.side?.toLowerCase() === 'over' ? 'O' : 'U'}
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-muted/30 flex items-center justify-center text-muted-foreground text-[10px]">
                      -
                    </div>
                  )}
                </div>

                {/* Sharp Builder */}
                <div className="flex justify-center">
                  {row.sharpBuilder ? (
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold",
                      row.sharpBuilder.side?.toLowerCase() === 'over' 
                        ? "bg-emerald-500/20 text-emerald-400" 
                        : "bg-red-500/20 text-red-400"
                    )}>
                      {row.sharpBuilder.side?.toLowerCase() === 'over' ? 'O' : 'U'}
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-muted/30 flex items-center justify-center text-muted-foreground text-[10px]">
                      -
                    </div>
                  )}
                </div>

                {/* Heat Engine */}
                <div className="flex justify-center">
                  {row.heatEngine ? (
                    <div className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold",
                      row.heatEngine.side?.toLowerCase() === 'over' 
                        ? "bg-emerald-500/20 text-emerald-400" 
                        : "bg-red-500/20 text-red-400"
                    )}>
                      {row.heatEngine.side?.toLowerCase() === 'over' ? 'O' : 'U'}
                    </div>
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-muted/30 flex items-center justify-center text-muted-foreground text-[10px]">
                      -
                    </div>
                  )}
                </div>

                {/* Consensus Status */}
                <div className="flex justify-center">
                  <Badge 
                    variant="outline" 
                    className={cn("text-[9px] px-1.5 py-0.5 gap-1", config.color)}
                  >
                    <ConsensusIcon className="w-2.5 h-2.5" />
                    {config.label}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Legend */}
      <div className="px-4 py-2 bg-muted/20 border-t border-border/30">
        <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1">
            <Target className="w-3 h-3 text-blue-400" />
            <span>Risk Engine</span>
          </div>
          <div className="flex items-center gap-1">
            <BarChart3 className="w-3 h-3 text-purple-400" />
            <span>Prop v2</span>
          </div>
          <div className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-amber-400" />
            <span>Sharp</span>
          </div>
          <div className="flex items-center gap-1">
            <Flame className="w-3 h-3 text-orange-400" />
            <span>Heat</span>
          </div>
          <span className="text-muted-foreground/50">|</span>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-emerald-500/20 text-emerald-400 text-[8px] flex items-center justify-center font-bold">O</span>
            <span>Over</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-full bg-red-500/20 text-red-400 text-[8px] flex items-center justify-center font-bold">U</span>
            <span>Under</span>
          </div>
        </div>
      </div>
    </div>
  );
}
