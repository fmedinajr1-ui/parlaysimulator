import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface PVSScoreBarProps {
  label: string;
  score: number;
  weight: number;
  description: string;
  className?: string;
}

export function PVSScoreBar({ label, score, weight, description, className }: PVSScoreBarProps) {
  const getScoreColor = (score: number) => {
    if (score >= 85) return 'bg-emerald-500';
    if (score >= 70) return 'bg-yellow-500';
    if (score >= 60) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getScoreTextColor = (score: number) => {
    if (score >= 85) return 'text-emerald-400';
    if (score >= 70) return 'text-yellow-400';
    if (score >= 60) return 'text-orange-400';
    return 'text-red-400';
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn("space-y-1", className)}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{label}</span>
              <span className={cn("font-mono font-semibold", getScoreTextColor(score))}>
                {score.toFixed(0)}
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div 
                className={cn("h-full rounded-full transition-all duration-500", getScoreColor(score))}
                style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
              />
            </div>
            <div className="text-[10px] text-muted-foreground/60">
              Weight: {(weight * 100).toFixed(0)}%
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <p className="text-xs">{description}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
