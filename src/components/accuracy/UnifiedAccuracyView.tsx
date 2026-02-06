import { useState } from "react";
import { useUnifiedAccuracy } from "@/hooks/useUnifiedAccuracy";
import { CompositeGradeCard } from "./CompositeGradeCard";
import { SystemAccuracyCard } from "./SystemAccuracyCard";
import { SystemCategoryBreakdown } from "./SystemCategoryBreakdown";
import { SettledPicksTable } from "./SettledPicksTable";
import { SidePerformanceCard } from "./SidePerformanceCard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { RefreshCw, AlertTriangle, CheckCircle, AlertCircle, Info, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettledPicksCount } from "@/hooks/useSettledPicks";

type TimePeriod = 7 | 30 | 90 | 365;

const TIME_PERIODS: { value: TimePeriod; label: string }[] = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: 365, label: 'All' },
];

interface Recommendation {
  type: 'trust' | 'caution' | 'avoid' | 'needs_data';
  message: string;
  icon: typeof CheckCircle;
  color: string;
}

export function UnifiedAccuracyView() {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>(30);
  const [settledOpen, setSettledOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const { 
    systems, 
    compositeGrade, 
    compositeGradeColor, 
    compositeHitRate,
    totalVerified,
    isLoading, 
    refetch 
  } = useUnifiedAccuracy(timePeriod);
  const { data: settledCount } = useSettledPicksCount();

  // Generate recommendations based on system performance
  const recommendations: Recommendation[] = systems.flatMap(sys => {
    const recs: Recommendation[] = [];
    
    if (sys.sampleConfidence === 'insufficient') {
      recs.push({
        type: 'needs_data',
        message: `${sys.displayName} needs more verified picks (${sys.verifiedPicks}/20)`,
        icon: Info,
        color: 'text-blue-400',
      });
    } else if (sys.hitRate >= 55) {
      recs.push({
        type: 'trust',
        message: `${sys.displayName} is performing well at ${sys.hitRate}%`,
        icon: CheckCircle,
        color: 'text-green-400',
      });
    } else if (sys.hitRate >= 50 && sys.hitRate < 52.4) {
      recs.push({
        type: 'caution',
        message: `${sys.displayName} is near breakeven at ${sys.hitRate}%`,
        icon: AlertCircle,
        color: 'text-yellow-400',
      });
    } else if (sys.hitRate < 45 && sys.verifiedPicks >= 20) {
      recs.push({
        type: 'avoid',
        message: `${sys.displayName} is underperforming at ${sys.hitRate}%`,
        icon: AlertTriangle,
        color: 'text-red-400',
      });
    }
    
    return recs;
  });

  // Sort recommendations by priority
  const sortedRecs = recommendations.sort((a, b) => {
    const priority = { avoid: 0, caution: 1, trust: 2, needs_data: 3 };
    return priority[a.type] - priority[b.type];
  });

  return (
    <div className="space-y-6">
      {/* Header with time period selector */}
      <div className="flex items-center justify-between">
        <Tabs 
          value={timePeriod.toString()} 
          onValueChange={(v) => setTimePeriod(Number(v) as TimePeriod)}
        >
          <TabsList className="bg-muted/30">
            {TIME_PERIODS.map(p => (
              <TabsTrigger 
                key={p.value} 
                value={p.value.toString()}
                className="text-xs"
              >
                {p.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => refetch()}
          disabled={isLoading}
        >
          <RefreshCw className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Composite Grade */}
      <CompositeGradeCard
        grade={compositeGrade}
        gradeColor={compositeGradeColor}
        hitRate={compositeHitRate}
        totalVerified={totalVerified}
      />

      {/* System Cards Grid */}
      <div className="grid grid-cols-2 gap-3">
        {isLoading ? (
          <>
            {[1, 2, 3, 4].map(i => (
              <Card key={i} className="h-40 animate-pulse bg-muted/30" />
            ))}
          </>
        ) : systems.length === 0 ? (
          <div className="col-span-2 text-center py-8 text-muted-foreground">
            No accuracy data available
          </div>
        ) : (
          systems.map(system => (
            <SystemAccuracyCard key={system.systemName} system={system} />
          ))
        )}
      </div>

      {/* Category Breakdown */}
      <Card className="p-4 bg-card/50 border-border/50">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <span>📊</span>
          Category Breakdown
        </h3>
        <SystemCategoryBreakdown />
      </Card>

      {/* Side Performance Tracking */}
      <Card className="p-4 bg-card/50 border-border/50">
        <Collapsible open={sideOpen} onOpenChange={setSideOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full">
            <h3 className="font-semibold flex items-center gap-2">
              <span>⬆️⬇️</span>
              Over vs Under Performance
            </h3>
            <ChevronDown className={cn(
              "w-4 h-4 transition-transform",
              sideOpen && "rotate-180"
            )} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidePerformanceCard />
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Settled Picks Table */}
      <Card className="p-4 bg-card/50 border-border/50">
        <Collapsible open={settledOpen} onOpenChange={setSettledOpen}>
          <CollapsibleTrigger className="flex items-center justify-between w-full">
            <h3 className="font-semibold flex items-center gap-2">
              <span>📋</span>
              Settled Picks {settledCount !== undefined && `(${settledCount})`}
            </h3>
            <ChevronDown className={cn(
              "w-4 h-4 transition-transform",
              settledOpen && "rotate-180"
            )} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SettledPicksTable />
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Recommendations */}
      {sortedRecs.length > 0 && (
        <Card className="p-4 bg-card/50 border-border/50">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <span>💡</span>
            Recommendations
          </h3>
          <div className="space-y-2">
            {sortedRecs.slice(0, 5).map((rec, i) => (
              <div 
                key={i} 
                className="flex items-start gap-2 text-sm p-2 rounded-lg bg-muted/20"
              >
                <rec.icon className={cn("w-4 h-4 mt-0.5 shrink-0", rec.color)} />
                <span className="text-muted-foreground">{rec.message}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
