import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface CompositeGradeCardProps {
  grade: string;
  gradeColor: string;
  hitRate: number;
  totalVerified: number;
  trend?: { direction: 'up' | 'down' | 'stable'; change: number };
}

export function CompositeGradeCard({ 
  grade, 
  gradeColor, 
  hitRate, 
  totalVerified,
  trend 
}: CompositeGradeCardProps) {
  const breakevenRate = 52.4;
  const vsBreakeven = hitRate - breakevenRate;
  const isProfitable = vsBreakeven > 0;

  const TrendIcon = trend?.direction === 'up' ? TrendingUp 
    : trend?.direction === 'down' ? TrendingDown 
    : Minus;

  const trendColor = trend?.direction === 'up' ? 'text-green-400'
    : trend?.direction === 'down' ? 'text-red-400'
    : 'text-muted-foreground';

  return (
    <Card className="p-6 bg-gradient-to-br from-card/80 to-card/40 border-border/50">
      <div className="text-center">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
          Overall Performance
        </p>
        
        <div className="flex items-center justify-center gap-4 mb-4">
          {/* Grade */}
          <div className={cn("text-6xl font-bold", gradeColor)}>
            {grade}
          </div>
          
          {/* Hit Rate + Trend */}
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className={cn(
                "text-3xl font-bold",
                hitRate >= 55 ? "text-green-400" : hitRate >= 50 ? "text-yellow-400" : "text-red-400"
              )}>
                {totalVerified > 0 ? `${hitRate}%` : '--'}
              </span>
              {trend && trend.direction !== 'stable' && (
                <TrendIcon className={cn("w-5 h-5", trendColor)} />
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {totalVerified.toLocaleString()} verified picks
            </p>
          </div>
        </div>

        {/* vs Breakeven */}
        {totalVerified >= 20 && (
          <div className={cn(
            "inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium",
            isProfitable 
              ? "bg-green-500/20 text-green-400" 
              : "bg-red-500/20 text-red-400"
          )}>
            {isProfitable ? '+' : ''}{vsBreakeven.toFixed(1)}% vs breakeven
          </div>
        )}
      </div>
    </Card>
  );
}
