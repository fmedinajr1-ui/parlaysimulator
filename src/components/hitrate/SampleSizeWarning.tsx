import { AlertTriangle, Info, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface SampleSizeWarningProps {
  sampleSize: number;
  className?: string;
  showProgressBar?: boolean;
}

export function getSampleSizeInfo(sampleSize: number) {
  if (sampleSize >= 100) {
    return {
      level: 'excellent',
      icon: TrendingUp,
      message: 'Statistically robust sample size',
      color: 'text-neon-green',
      bgColor: 'bg-neon-green/10',
      borderColor: 'border-neon-green/30',
      progress: 100,
    };
  } else if (sampleSize >= 50) {
    return {
      level: 'good',
      icon: TrendingUp,
      message: 'Good sample size for reliable estimates',
      color: 'text-neon-green',
      bgColor: 'bg-neon-green/10',
      borderColor: 'border-neon-green/30',
      progress: 80,
    };
  } else if (sampleSize >= 20) {
    return {
      level: 'moderate',
      icon: Info,
      message: 'Moderate sample - results may vary',
      color: 'text-neon-yellow',
      bgColor: 'bg-neon-yellow/10',
      borderColor: 'border-neon-yellow/30',
      progress: 50,
    };
  } else if (sampleSize >= 10) {
    return {
      level: 'low',
      icon: AlertTriangle,
      message: 'Low sample size - interpret with caution',
      color: 'text-orange-400',
      bgColor: 'bg-orange-400/10',
      borderColor: 'border-orange-400/30',
      progress: 30,
    };
  } else {
    return {
      level: 'insufficient',
      icon: AlertTriangle,
      message: 'Insufficient data for reliable estimate',
      color: 'text-red-400',
      bgColor: 'bg-red-400/10',
      borderColor: 'border-red-400/30',
      progress: 15,
    };
  }
}

export function SampleSizeWarning({
  sampleSize,
  className,
  showProgressBar = false,
}: SampleSizeWarningProps) {
  const info = getSampleSizeInfo(sampleSize);
  const Icon = info.icon;

  return (
    <div className={cn(
      "flex items-center gap-2 p-2 rounded-lg border",
      info.bgColor,
      info.borderColor,
      className
    )}>
      <Icon className={cn("h-4 w-4 flex-shrink-0", info.color)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-xs font-medium", info.color)}>
            n={sampleSize}
          </span>
          <span className="text-xs text-muted-foreground truncate">
            {info.message}
          </span>
        </div>
        {showProgressBar && (
          <div className="mt-1 h-1 w-full bg-muted/30 rounded-full overflow-hidden">
            <div 
              className={cn("h-full rounded-full transition-all", 
                info.level === 'excellent' || info.level === 'good' 
                  ? 'bg-neon-green' 
                  : info.level === 'moderate' 
                    ? 'bg-neon-yellow' 
                    : 'bg-orange-400'
              )}
              style={{ width: `${info.progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function SampleSizeBadge({ sampleSize }: { sampleSize: number }) {
  const info = getSampleSizeInfo(sampleSize);
  
  return (
    <Badge 
      variant="outline" 
      className={cn(
        "text-xs font-mono",
        info.color,
        info.borderColor,
        info.bgColor
      )}
    >
      n={sampleSize}
    </Badge>
  );
}
