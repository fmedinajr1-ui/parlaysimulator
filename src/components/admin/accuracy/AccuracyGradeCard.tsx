import { Card, CardContent } from '@/components/ui/card';
import { WolfAvatar } from '@/components/avatars/WolfAvatar';
import { DogAvatar } from '@/components/avatars/DogAvatar';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AccuracyGradeCardProps {
  grade: string;
  accuracy: number;
  totalVerified: number;
  gradeColor: string;
  overallTrend?: { direction: string; change: number };
}

export function AccuracyGradeCard({ 
  grade, 
  accuracy, 
  totalVerified, 
  gradeColor,
  overallTrend 
}: AccuracyGradeCardProps) {
  const isHighPerformer = ['A+', 'A', 'B+'].includes(grade);
  const breakeven = 52.4;
  const vsBreakeven = accuracy - breakeven;
  
  const getTrendIcon = () => {
    if (!overallTrend || overallTrend.direction === 'stable') {
      return <Minus className="w-4 h-4" />;
    }
    if (overallTrend.direction === 'up') {
      return <TrendingUp className="w-4 h-4" />;
    }
    if (overallTrend.direction === 'down') {
      return <TrendingDown className="w-4 h-4" />;
    }
    return null;
  };
  
  return (
    <Card className={cn(
      "relative overflow-hidden",
      isHighPerformer && "ring-2 ring-green-500/30 shadow-lg shadow-green-500/10",
      !isHighPerformer && grade !== 'N/A' && accuracy < 50 && "ring-2 ring-red-500/30"
    )}>
      <CardContent className="p-6 text-center">
        {/* Avatar based on performance */}
        <div className="flex justify-center mb-4">
          {isHighPerformer ? (
            <WolfAvatar size="lg" variant="alpha" animated />
          ) : (
            <DogAvatar size="lg" variant={accuracy >= 50 ? 'winner' : 'default'} />
          )}
        </div>
        
        {/* Grade */}
        <div className={cn("text-6xl font-bold font-display mb-2", gradeColor)}>
          {grade}
        </div>
        
        {/* Accuracy */}
        <div className="text-2xl font-semibold text-foreground mb-1">
          {accuracy.toFixed(1)}%
        </div>
        <div className="text-sm text-muted-foreground mb-3">
          composite accuracy
        </div>
        
        {/* Verified count */}
        <div className="text-sm text-muted-foreground mb-4">
          {totalVerified.toLocaleString()} verified predictions
        </div>
        
        {/* Trend indicator */}
        {overallTrend && overallTrend.direction !== 'insufficient' && (
          <div className={cn(
            "flex items-center justify-center gap-1 text-sm font-medium mb-3 px-3 py-1.5 rounded-full mx-auto w-fit",
            overallTrend.direction === 'up' && "bg-green-500/10 text-green-500",
            overallTrend.direction === 'down' && "bg-red-500/10 text-red-500",
            overallTrend.direction === 'stable' && "bg-muted text-muted-foreground"
          )}>
            {getTrendIcon()}
            <span>
              {overallTrend.change >= 0 ? '+' : ''}{overallTrend.change.toFixed(1)}% vs last 30 days
            </span>
          </div>
        )}
        
        {/* vs Breakeven */}
        {grade !== 'N/A' && (
          <div className={cn(
            "flex items-center justify-center gap-1 text-sm font-medium",
            vsBreakeven >= 0 ? "text-green-500" : "text-red-500"
          )}>
            {vsBreakeven >= 0 ? (
              <TrendingUp className="w-4 h-4" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
            {vsBreakeven >= 0 ? '+' : ''}{vsBreakeven.toFixed(1)}% vs breakeven
          </div>
        )}
      </CardContent>
    </Card>
  );
}
