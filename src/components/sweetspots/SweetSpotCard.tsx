import { Plus, TrendingUp, TrendingDown, Film, AlertTriangle, Target, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DeepSweetSpot } from "@/types/sweetSpot";
import { PROP_TYPE_CONFIG } from "@/types/sweetSpot";
import { QualityTierBadge } from "./QualityTierBadge";
import { FloorProtectionBar } from "./FloorProtectionBar";
import { JuiceIndicator } from "./JuiceIndicator";
import { MinutesVerdictBadge } from "./MinutesVerdictBadge";
import { MomentumIndicator } from "./MomentumIndicator";
import { ProductionRateDisplay } from "./ProductionRateDisplay";
import { LiveDataOverlay } from "./LiveDataOverlay";
import { HedgeRecommendation } from "./HedgeRecommendation";
import { ShotChartPreview } from "./ShotChartPreview";

// Helper to get peak quarter from profile data
function getPeakQuarter(peakQuarters: { q1: number; q2: number; q3: number; q4: number }): string {
  const entries = Object.entries(peakQuarters) as [string, number][];
  const peak = entries.reduce((max, [q, pct]) => pct > max.pct ? { q, pct } : max, { q: 'q1', pct: 0 });
  return peak.q.replace('q', '');
}

interface SweetSpotCardProps {
  spot: DeepSweetSpot;
  onAddToBuilder?: (spot: DeepSweetSpot) => void;
}

export function SweetSpotCard({ spot, onAddToBuilder }: SweetSpotCardProps) {
  const propConfig = PROP_TYPE_CONFIG[spot.propType];
  const hitRatePercent = Math.round(spot.hitRateL10 * 100);
  
  return (
    <Card className={cn(
      "border transition-all hover:border-primary/50",
      spot.qualityTier === 'ELITE' && "border-purple-500/30 bg-purple-500/5",
      spot.qualityTier === 'PREMIUM' && "border-teal-500/30 bg-teal-500/5",
      spot.qualityTier === 'STRONG' && "border-green-500/30 bg-green-500/5",
    )}>
      <CardContent className="p-4 space-y-3">
        {/* Header Row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-foreground truncate">
                {spot.playerName}
              </h3>
              <QualityTierBadge tier={spot.qualityTier} size="sm" />
            </div>
            <p className="text-sm text-muted-foreground truncate">
              {spot.gameDescription}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">L10</span>
            <span className={cn(
              "text-sm font-bold px-1.5 py-0.5 rounded",
              hitRatePercent === 100 ? "bg-green-500/20 text-green-400" :
              hitRatePercent >= 90 ? "bg-teal-500/20 text-teal-400" :
              hitRatePercent >= 80 ? "bg-yellow-500/20 text-yellow-400" :
              "bg-muted text-muted-foreground"
            )}>
              {hitRatePercent}%
            </span>
            <JuiceIndicator juice={spot.juice} compact />
          </div>
        </div>
        
        {/* Live Data Overlay (if game in progress) */}
        {spot.liveData?.isLive && (
          <LiveDataOverlay 
            liveData={spot.liveData} 
            line={spot.line} 
            side={spot.side} 
          />
        )}
        
        {/* Hedge Recommendation (if at risk) */}
        <HedgeRecommendation spot={spot} />
        
        {/* Shot Chart Preview (for non-live points/threes props) */}
        <ShotChartPreview spot={spot} />
        
        {/* v8.0: Profile Insights Row */}
        {spot.profileData && (spot.profileData.filmSamples > 0 || spot.profileData.peakQuarters || spot.profileData.hasFatigueTendency || spot.profileData.matchupAdvantage) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {spot.profileData.filmSamples > 0 && (
              <Badge variant="outline" className="text-purple-400 border-purple-500/30 bg-purple-500/10 text-xs gap-1">
                <Film className="w-3 h-3" />
                {spot.profileData.filmSamples} film
              </Badge>
            )}
            
            {spot.propType === 'threes' && spot.profileData.peakQuarters && (
              <Badge variant="outline" className="text-blue-400 border-blue-500/30 bg-blue-500/10 text-xs gap-1">
                <Sparkles className="w-3 h-3" />
                Peak Q{getPeakQuarter(spot.profileData.peakQuarters)}
              </Badge>
            )}
            
            {spot.profileData.matchupAdvantage === 'favorable' && (
              <Badge variant="outline" className="text-green-400 border-green-500/30 bg-green-500/10 text-xs gap-1">
                <Target className="w-3 h-3" />
                Matchup+
              </Badge>
            )}
            
            {spot.profileData.matchupAdvantage === 'unfavorable' && (
              <Badge variant="outline" className="text-orange-400 border-orange-500/30 bg-orange-500/10 text-xs gap-1">
                <Target className="w-3 h-3" />
                Matchup-
              </Badge>
            )}
            
            {spot.profileData.hasFatigueTendency && (
              <Badge variant="outline" className="text-yellow-400 border-yellow-500/30 bg-yellow-500/10 text-xs gap-1">
                <AlertTriangle className="w-3 h-3" />
                Fatigue
              </Badge>
            )}
            
            {spot.profileData.profileConfidence >= 70 && (
              <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 bg-emerald-500/10 text-xs">
                Verified
              </Badge>
            )}
          </div>
        )}
        
        {/* Prop Type Badge */}
        <div className="flex items-center gap-2">
          <span className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold uppercase",
            spot.side === 'over' 
              ? "bg-green-500/20 text-green-400" 
              : "bg-red-500/20 text-red-400"
          )}>
            {spot.side === 'over' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {propConfig.shortLabel} {spot.side.toUpperCase()}
          </span>
          <span className="text-lg font-bold font-mono">
            {spot.line}
          </span>
          <div className="flex-1" />
          <div className="text-right">
            <div className="text-xs text-muted-foreground">L10 Avg</div>
            <div className="text-sm font-bold text-foreground">
              {spot.l10Stats.avg.toFixed(1)}
            </div>
          </div>
        </div>
        
        {/* Floor/Ceiling Protection Bar */}
        <FloorProtectionBar 
          floorProtection={spot.floorProtection}
          l10Min={spot.l10Stats.min}
          l10Max={spot.l10Stats.max}
          line={spot.line}
          side={spot.side}
        />
        
        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Edge</div>
            <div className={cn(
              "text-sm font-bold",
              spot.edge > 0 ? "text-green-400" : spot.edge < 0 ? "text-red-400" : "text-muted-foreground"
            )}>
              {spot.edge > 0 ? '+' : ''}{spot.edge.toFixed(1)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Momentum</div>
            <MomentumIndicator 
              momentum={spot.momentum} 
              ratio={spot.momentumRatio}
              compact 
            />
          </div>
        </div>
        
        {/* Production & Minutes */}
        <div className="pt-1 border-t border-border">
          <ProductionRateDisplay 
            production={spot.production} 
            propType={spot.propType}
            side={spot.side}
            compact 
          />
        </div>
        
        {/* H2H Section (if available) */}
        {spot.h2h && spot.h2h.gamesPlayed >= 2 && (
          <div className="pt-1 border-t border-border">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                H2H vs {spot.h2h.opponentName}
              </span>
              <span className={cn(
                "font-medium",
                spot.h2hBoost > 0 ? "text-green-400" : 
                spot.h2hBoost < 0 ? "text-red-400" : "text-muted-foreground"
              )}>
                Avg: {spot.h2h.avgStat.toFixed(1)} 
                ({spot.h2h.gamesPlayed} games)
                {spot.h2hBoost > 0 && ` +${Math.round(spot.h2hBoost * 100)}%`}
              </span>
            </div>
          </div>
        )}
        
        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Score</span>
            <span className={cn(
              "text-lg font-bold",
              spot.sweetSpotScore >= 80 ? "text-green-400" :
              spot.sweetSpotScore >= 60 ? "text-yellow-400" :
              "text-muted-foreground"
            )}>
              {spot.sweetSpotScore}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <MinutesVerdictBadge verdict={spot.production.verdict} compact />
            {onAddToBuilder && (
              <Button 
                size="sm" 
                variant="outline"
                onClick={() => onAddToBuilder(spot)}
                className="gap-1"
              >
                <Plus size={14} />
                Add
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
