import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Plane, 
  Moon, 
  Mountain, 
  Shield, 
  Zap, 
  TrendingUp, 
  TrendingDown,
  AlertTriangle,
  ThermometerSun,
  Wind
} from "lucide-react";
import { ContextualFactors, applyContextualAdjustments } from "@/lib/parametric-models";

interface ContextualFactorsCardProps {
  factors: ContextualFactors;
  baseExpectedValue: number;
  propType: string;
  playerName?: string;
  compact?: boolean;
}

interface FactorDisplay {
  label: string;
  value: string;
  impact: 'positive' | 'negative' | 'neutral';
  icon: React.ReactNode;
  adjustment: number;
}

export function ContextualFactorsCard({ 
  factors, 
  baseExpectedValue, 
  propType,
  playerName,
  compact = false 
}: ContextualFactorsCardProps) {
  const adjustedEV = applyContextualAdjustments(baseExpectedValue, factors);
  const totalAdjustment = ((adjustedEV / baseExpectedValue) - 1) * 100;
  
  const factorDisplays: FactorDisplay[] = [];
  
  // Rest days
  if (factors.restDays !== undefined) {
    const isB2B = factors.restDays === 0;
    const isRested = factors.restDays >= 3;
    factorDisplays.push({
      label: 'Rest',
      value: isB2B ? 'B2B' : `${factors.restDays}d rest`,
      impact: isB2B ? 'negative' : isRested ? 'positive' : 'neutral',
      icon: <Moon className="h-3 w-3" />,
      adjustment: isB2B ? -5 : isRested ? 2 : 0
    });
  }
  
  // Travel
  if (factors.travelMiles !== undefined && factors.travelMiles > 500) {
    const isFarTravel = factors.travelMiles > 1500;
    factorDisplays.push({
      label: 'Travel',
      value: `${Math.round(factors.travelMiles).toLocaleString()} mi`,
      impact: isFarTravel ? 'negative' : 'neutral',
      icon: <Plane className="h-3 w-3" />,
      adjustment: isFarTravel ? -3 : -1
    });
  }
  
  // Home/Away
  if (factors.isHome !== undefined) {
    factorDisplays.push({
      label: 'Venue',
      value: factors.isHome ? 'Home' : 'Away',
      impact: factors.isHome ? 'positive' : 'negative',
      icon: <Mountain className="h-3 w-3" />,
      adjustment: factors.isHome ? 3 : -3
    });
  }
  
  // Defense rating
  if (factors.defenseRating !== undefined) {
    const isGoodDefense = factors.defenseRating > 1.05;
    const isWeakDefense = factors.defenseRating < 0.95;
    factorDisplays.push({
      label: 'Matchup',
      value: isGoodDefense ? 'Tough D' : isWeakDefense ? 'Weak D' : 'Avg D',
      impact: isWeakDefense ? 'positive' : isGoodDefense ? 'negative' : 'neutral',
      icon: <Shield className="h-3 w-3" />,
      adjustment: isWeakDefense ? 5 : isGoodDefense ? -5 : 0
    });
  }
  
  // Pace adjustment
  if (factors.paceAdjustment !== undefined && Math.abs(factors.paceAdjustment - 1) > 0.02) {
    const isFastPace = factors.paceAdjustment > 1.02;
    factorDisplays.push({
      label: 'Pace',
      value: isFastPace ? 'Fast' : 'Slow',
      impact: isFastPace ? 'positive' : 'negative',
      icon: <Zap className="h-3 w-3" />,
      adjustment: (factors.paceAdjustment - 1) * 100
    });
  }
  
  // Recent form
  if (factors.recentForm !== undefined && Math.abs(factors.recentForm - 1) > 0.05) {
    const isHot = factors.recentForm > 1.05;
    factorDisplays.push({
      label: 'Form',
      value: isHot ? 'Hot' : 'Cold',
      impact: isHot ? 'positive' : 'negative',
      icon: isHot ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />,
      adjustment: (factors.recentForm - 1) * 100
    });
  }
  
  // Injury impact
  if (factors.injuryImpact !== undefined && factors.injuryImpact < -0.02) {
    factorDisplays.push({
      label: 'Injuries',
      value: factors.injuryImpact < -0.1 ? 'Major' : 'Minor',
      impact: 'negative',
      icon: <AlertTriangle className="h-3 w-3" />,
      adjustment: factors.injuryImpact * 100
    });
  }
  
  // Weather (outdoor sports)
  if (factors.windSpeed !== undefined && factors.windSpeed > 10) {
    factorDisplays.push({
      label: 'Wind',
      value: `${factors.windSpeed} mph`,
      impact: factors.windSpeed > 20 ? 'negative' : 'neutral',
      icon: <Wind className="h-3 w-3" />,
      adjustment: factors.windSpeed > 15 ? -2 : 0
    });
  }
  
  if (factors.temperature !== undefined && (factors.temperature < 40 || factors.temperature > 90)) {
    const isExtreme = factors.temperature < 30 || factors.temperature > 95;
    factorDisplays.push({
      label: 'Temp',
      value: `${factors.temperature}°F`,
      impact: isExtreme ? 'negative' : 'neutral',
      icon: <ThermometerSun className="h-3 w-3" />,
      adjustment: isExtreme ? -2 : 0
    });
  }
  
  if (factorDisplays.length === 0) {
    return null;
  }
  
  const getImpactColor = (impact: 'positive' | 'negative' | 'neutral') => {
    switch (impact) {
      case 'positive': return 'text-neon-green border-neon-green/30 bg-neon-green/10';
      case 'negative': return 'text-orange-400 border-orange-400/30 bg-orange-400/10';
      default: return 'text-muted-foreground border-border/30 bg-muted/10';
    }
  };
  
  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {factorDisplays.slice(0, 4).map((factor, idx) => (
          <Badge 
            key={idx} 
            variant="outline" 
            className={`text-[10px] ${getImpactColor(factor.impact)}`}
          >
            {factor.icon}
            <span className="ml-1">{factor.value}</span>
          </Badge>
        ))}
        {Math.abs(totalAdjustment) > 2 && (
          <Badge 
            variant="outline" 
            className={`text-[10px] ${totalAdjustment > 0 ? 'text-neon-green border-neon-green/30' : 'text-orange-400 border-orange-400/30'}`}
          >
            {totalAdjustment > 0 ? '+' : ''}{totalAdjustment.toFixed(1)}% EV
          </Badge>
        )}
      </div>
    );
  }
  
  return (
    <Card className="bg-card/60 border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-neon-purple" />
            Context Factors
            {playerName && <span className="text-muted-foreground font-normal">• {playerName}</span>}
          </span>
          {Math.abs(totalAdjustment) > 1 && (
            <Badge 
              variant="outline" 
              className={totalAdjustment > 0 ? 'text-neon-green border-neon-green/30' : 'text-orange-400 border-orange-400/30'}
            >
              {totalAdjustment > 0 ? '+' : ''}{totalAdjustment.toFixed(1)}% EV Adj
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {factorDisplays.map((factor, idx) => (
            <div 
              key={idx}
              className={`flex items-center gap-2 p-2 rounded-lg border ${getImpactColor(factor.impact)}`}
            >
              {factor.icon}
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-muted-foreground">{factor.label}</p>
                <p className="text-xs font-medium truncate">{factor.value}</p>
              </div>
              {factor.adjustment !== 0 && (
                <span className="text-[10px] font-mono">
                  {factor.adjustment > 0 ? '+' : ''}{factor.adjustment.toFixed(0)}%
                </span>
              )}
            </div>
          ))}
        </div>
        
        <div className="mt-3 pt-3 border-t border-border/30 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Base EV: {baseExpectedValue.toFixed(1)}</span>
          <span className={totalAdjustment > 0 ? 'text-neon-green font-medium' : totalAdjustment < 0 ? 'text-orange-400 font-medium' : 'text-muted-foreground'}>
            Adjusted: {adjustedEV.toFixed(1)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
