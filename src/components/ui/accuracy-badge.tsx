import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Target, TrendingUp, AlertTriangle } from 'lucide-react';

interface AccuracyBadgeProps {
  accuracy: number;
  sampleSize?: number;
  className?: string;
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function AccuracyBadge({ 
  accuracy, 
  sampleSize, 
  className,
  showIcon = true,
  size = 'md'
}: AccuracyBadgeProps) {
  const getAccuracyColor = () => {
    if (accuracy >= 55) return 'bg-chart-2/20 text-chart-2 border-chart-2/30';
    if (accuracy >= 50) return 'bg-chart-4/20 text-chart-4 border-chart-4/30';
    return 'bg-destructive/20 text-destructive border-destructive/30';
  };

  const getIcon = () => {
    if (accuracy >= 55) return <TrendingUp className={size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} />;
    if (accuracy >= 50) return <Target className={size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} />;
    return <AlertTriangle className={size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} />;
  };

  const getSampleConfidence = () => {
    if (!sampleSize) return null;
    if (sampleSize >= 100) return { label: 'High', color: 'text-chart-2' };
    if (sampleSize >= 50) return { label: 'Med', color: 'text-chart-4' };
    return { label: 'Low', color: 'text-muted-foreground' };
  };

  const sampleConfidence = getSampleConfidence();

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5'
  };

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Badge 
        variant="outline" 
        className={cn(
          'flex items-center gap-1 font-semibold border',
          getAccuracyColor(),
          sizeClasses[size]
        )}
      >
        {showIcon && getIcon()}
        {accuracy.toFixed(1)}% Win Rate
      </Badge>
      {sampleConfidence && (
        <span className={cn('text-xs', sampleConfidence.color)}>
          ({sampleSize} bets • {sampleConfidence.label} conf.)
        </span>
      )}
    </div>
  );
}
