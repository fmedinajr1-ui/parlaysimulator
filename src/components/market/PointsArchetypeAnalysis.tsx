import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, BarChart3, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type TimeWindow = '7d' | '30d' | 'all';

interface ArchetypePerformance {
  archetype: string;
  total: number;
  hits: number;
  misses: number;
  hitRate: number;
  avgConfidence: number;
}

interface LineTierPerformance {
  tier: string;
  range: string;
  total: number;
  hits: number;
  hitRate: number;
  recommendation: 'bet' | 'caution' | 'avoid';
}

interface ConfidencePerformance {
  bucket: string;
  range: string;
  total: number;
  hits: number;
  hitRate: number;
}

const BIG_ARCHETYPES = ['ELITE_REBOUNDER', 'GLASS_CLEANER', 'RIM_PROTECTOR'];

const LINE_TIERS = {
  LOW: { min: 0, max: 14.5, label: 'Low (0-14.5)' },
  MID: { min: 15, max: 21.5, label: 'Mid (15-21.5)' },
  HIGH: { min: 22, max: 50, label: 'High (22+)' },
};

const CONFIDENCE_BUCKETS = [
  { key: '5-6', min: 5, max: 6, label: '5.0-6.0' },
  { key: '6-7', min: 6, max: 7, label: '6.0-7.0' },
  { key: '7-8', min: 7, max: 8, label: '7.0-8.0' },
  { key: '8-9', min: 8, max: 9, label: '8.0-9.0' },
  { key: '9-10', min: 9, max: 10, label: '9.0-10.0' },
  { key: '10+', min: 10, max: 100, label: '10.0+' },
];

function getRecommendation(hitRate: number): 'bet' | 'caution' | 'avoid' {
  if (hitRate >= 55) return 'bet';
  if (hitRate >= 45) return 'caution';
  return 'avoid';
}

function getRecommendationStyles(rec: 'bet' | 'caution' | 'avoid') {
  switch (rec) {
    case 'bet':
      return 'bg-green-500/20 text-green-400 border-green-500/30';
    case 'caution':
      return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    case 'avoid':
      return 'bg-red-500/20 text-red-400 border-red-500/30';
  }
}

function HitRateBar({ hitRate, total }: { hitRate: number; total: number }) {
  const getColor = () => {
    if (hitRate >= 55) return 'bg-green-500';
    if (hitRate >= 45) return 'bg-amber-500';
    return 'bg-red-500';
  };

  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className={cn("h-full rounded-full transition-all", getColor())}
          style={{ width: `${Math.min(hitRate, 100)}%` }}
        />
      </div>
      <span className={cn(
        "text-sm font-medium",
        hitRate >= 55 ? "text-green-400" : hitRate >= 45 ? "text-amber-400" : "text-red-400"
      )}>
        {hitRate.toFixed(0)}%
      </span>
      <span className="text-xs text-muted-foreground">({total})</span>
    </div>
  );
}

export function PointsArchetypeAnalysis() {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('30d');

  const { data, isLoading, error } = useQuery({
    queryKey: ['points-archetype-analysis', timeWindow],
    queryFn: async () => {
      const now = new Date();
      let startDate: string;
      
      if (timeWindow === '7d') {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      } else if (timeWindow === '30d') {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      } else {
        startDate = '2020-01-01';
      }

      // Fetch settled Points props from risk engine
      const { data: picks, error } = await supabase
        .from('nba_risk_engine_picks')
        .select('player_name, prop_type, line, side, archetype, confidence_score, outcome, game_date')
        .gte('game_date', startDate)
        .not('outcome', 'is', null)
        .ilike('prop_type', '%point%')
        .not('prop_type', 'ilike', '%rebound%')
        .not('prop_type', 'ilike', '%assist%');

      if (error) throw error;

      // Process by archetype
      const archetypeMap = new Map<string, { total: number; hits: number; confidenceSum: number }>();
      
      // Process by line tier
      const tierMap = new Map<string, { total: number; hits: number }>();
      
      // Process by confidence bucket
      const confMap = new Map<string, { total: number; hits: number }>();

      for (const pick of picks || []) {
        const archetype = pick.archetype || 'UNKNOWN';
        const isHit = pick.outcome === 'hit';
        const line = pick.line || 0;
        const confidence = pick.confidence_score || 0;

        // Archetype stats
        const arch = archetypeMap.get(archetype) || { total: 0, hits: 0, confidenceSum: 0 };
        arch.total++;
        if (isHit) arch.hits++;
        arch.confidenceSum += confidence;
        archetypeMap.set(archetype, arch);

        // Line tier stats
        let tier = 'HIGH';
        if (line <= LINE_TIERS.LOW.max) tier = 'LOW';
        else if (line <= LINE_TIERS.MID.max) tier = 'MID';
        
        const t = tierMap.get(tier) || { total: 0, hits: 0 };
        t.total++;
        if (isHit) t.hits++;
        tierMap.set(tier, t);

        // Confidence bucket stats
        for (const bucket of CONFIDENCE_BUCKETS) {
          if (confidence >= bucket.min && confidence < bucket.max) {
            const c = confMap.get(bucket.key) || { total: 0, hits: 0 };
            c.total++;
            if (isHit) c.hits++;
            confMap.set(bucket.key, c);
            break;
          }
        }
      }

      // Format archetype results
      const archetypePerformance: ArchetypePerformance[] = [];
      archetypeMap.forEach((stats, archetype) => {
        archetypePerformance.push({
          archetype,
          total: stats.total,
          hits: stats.hits,
          misses: stats.total - stats.hits,
          hitRate: stats.total > 0 ? (stats.hits / stats.total) * 100 : 0,
          avgConfidence: stats.total > 0 ? stats.confidenceSum / stats.total : 0,
        });
      });
      archetypePerformance.sort((a, b) => b.hitRate - a.hitRate);

      // Format tier results
      const tierPerformance: LineTierPerformance[] = Object.entries(LINE_TIERS).map(([key, config]) => {
        const stats = tierMap.get(key) || { total: 0, hits: 0 };
        const hitRate = stats.total > 0 ? (stats.hits / stats.total) * 100 : 0;
        return {
          tier: key,
          range: config.label,
          total: stats.total,
          hits: stats.hits,
          hitRate,
          recommendation: getRecommendation(hitRate),
        };
      });

      // Format confidence results
      const confidencePerformance: ConfidencePerformance[] = CONFIDENCE_BUCKETS.map(bucket => {
        const stats = confMap.get(bucket.key) || { total: 0, hits: 0 };
        return {
          bucket: bucket.key,
          range: bucket.label,
          total: stats.total,
          hits: stats.hits,
          hitRate: stats.total > 0 ? (stats.hits / stats.total) * 100 : 0,
        };
      });

      // Calculate big archetype warning
      const bigArchetypeStats = archetypePerformance.filter(a => BIG_ARCHETYPES.includes(a.archetype));
      const avgBigHitRate = bigArchetypeStats.length > 0
        ? bigArchetypeStats.reduce((sum, a) => sum + a.hitRate, 0) / bigArchetypeStats.length
        : 0;

      return {
        archetypePerformance,
        tierPerformance,
        confidencePerformance,
        totalPicks: picks?.length || 0,
        avgBigHitRate,
      };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="text-center py-8 text-red-400">
          Failed to load analysis data
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Points Props Analysis</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            {(['7d', '30d', 'all'] as const).map((window) => (
              <Button
                key={window}
                variant={timeWindow === window ? "default" : "ghost"}
                size="sm"
                onClick={() => setTimeWindow(window)}
                className="h-7 text-xs"
              >
                {window === 'all' ? 'All' : window}
              </Button>
            ))}
          </div>
        </div>
        <CardDescription className="text-xs">
          Historical performance by archetype, line tier, and confidence ({data?.totalPicks || 0} picks)
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Big Archetype Warning */}
        {data?.avgBigHitRate !== undefined && data.avgBigHitRate < 45 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-400">Big Archetypes Underperforming</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                ELITE_REBOUNDER, GLASS_CLEANER, RIM_PROTECTOR averaging {data.avgBigHitRate.toFixed(0)}% on Points props
              </p>
            </div>
          </div>
        )}

        {/* By Archetype */}
        <div>
          <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
            By Archetype
            {data?.archetypePerformance.some(a => BIG_ARCHETYPES.includes(a.archetype) && a.hitRate < 45) && (
              <Badge variant="outline" className="text-xs text-amber-400 border-amber-500/30">
                Bigs Struggle
              </Badge>
            )}
          </h4>
          <div className="space-y-2">
            {data?.archetypePerformance.slice(0, 8).map((arch) => (
              <div key={arch.archetype} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-sm",
                    BIG_ARCHETYPES.includes(arch.archetype) && arch.hitRate < 45 && "text-amber-400"
                  )}>
                    {arch.archetype.replace(/_/g, ' ')}
                  </span>
                  {BIG_ARCHETYPES.includes(arch.archetype) && (
                    <Badge variant="outline" className="text-[10px]">BIG</Badge>
                  )}
                </div>
                <HitRateBar hitRate={arch.hitRate} total={arch.total} />
              </div>
            ))}
          </div>
        </div>

        {/* By Line Tier */}
        <div>
          <h4 className="text-sm font-medium mb-3">By Line Tier</h4>
          <div className="grid grid-cols-3 gap-2">
            {data?.tierPerformance.map((tier) => (
              <div 
                key={tier.tier}
                className={cn(
                  "p-3 rounded-lg border text-center",
                  getRecommendationStyles(tier.recommendation)
                )}
              >
                <p className="text-xs opacity-80 mb-1">{tier.range}</p>
                <p className="text-lg font-bold">{tier.hitRate.toFixed(0)}%</p>
                <p className="text-xs opacity-60">{tier.total} picks</p>
                <Badge 
                  variant="outline" 
                  className={cn(
                    "text-[10px] mt-2",
                    getRecommendationStyles(tier.recommendation)
                  )}
                >
                  {tier.recommendation.toUpperCase()}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {/* By Confidence */}
        <div>
          <h4 className="text-sm font-medium mb-3">By Confidence Score</h4>
          <div className="space-y-2">
            {data?.confidencePerformance.filter(c => c.total > 0).map((conf) => (
              <div key={conf.bucket} className="flex items-center justify-between">
                <span className="text-sm">{conf.range}</span>
                <HitRateBar hitRate={conf.hitRate} total={conf.total} />
              </div>
            ))}
          </div>
        </div>

        {/* Key Insights */}
        <div className="pt-3 border-t border-border/50">
          <h4 className="text-sm font-medium mb-2">Key Insights</h4>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {data?.tierPerformance.find(t => t.tier === 'MID')?.hitRate !== undefined && 
             data?.tierPerformance.find(t => t.tier === 'MID')!.hitRate < 45 && (
              <li className="flex items-start gap-2">
                <TrendingDown className="w-3 h-3 text-red-400 mt-0.5" />
                <span>Mid-tier lines (15-21.5) underperforming - require higher edge</span>
              </li>
            )}
            {data?.avgBigHitRate !== undefined && data.avgBigHitRate < 45 && (
              <li className="flex items-start gap-2">
                <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5" />
                <span>Big archetypes have volatile Points scoring - apply confidence penalty</span>
              </li>
            )}
            {data?.confidencePerformance.find(c => c.bucket === '8-9')?.hitRate !== undefined &&
             data?.confidencePerformance.find(c => c.bucket === '8-9')!.hitRate >= 55 && (
              <li className="flex items-start gap-2">
                <TrendingUp className="w-3 h-3 text-green-400 mt-0.5" />
                <span>8.0-9.0 confidence range shows strong performance</span>
              </li>
            )}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
