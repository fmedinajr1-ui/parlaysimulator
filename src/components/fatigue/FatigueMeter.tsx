import { cn } from '@/lib/utils';

interface FatigueMeterProps {
  score: number;
  category: string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

const getFatigueColor = (score: number): string => {
  if (score <= 20) return 'bg-green-500';
  if (score <= 40) return 'bg-yellow-500';
  if (score <= 60) return 'bg-orange-500';
  if (score <= 80) return 'bg-red-500';
  return 'bg-red-600';
};

const getFatigueTextColor = (score: number): string => {
  if (score <= 20) return 'text-green-400';
  if (score <= 40) return 'text-yellow-400';
  if (score <= 60) return 'text-orange-400';
  if (score <= 80) return 'text-red-400';
  return 'text-red-500';
};

const getFatigueEmoji = (score: number): string => {
  if (score <= 20) return '🟢';
  if (score <= 40) return '🟡';
  if (score <= 60) return '🟠';
  if (score <= 80) return '🔴';
  return '🚨';
};

export const FatigueMeter = ({ score, category, size = 'md', showLabel = true }: FatigueMeterProps) => {
  const sizeClasses = {
    sm: 'h-2 w-20',
    md: 'h-3 w-32',
    lg: 'h-4 w-48',
  };

  const labelSizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div className={cn('bg-muted/50 rounded-full overflow-hidden', sizeClasses[size])}>
          <div 
            className={cn('h-full rounded-full transition-all duration-500', getFatigueColor(score))}
            style={{ width: `${score}%` }}
          />
        </div>
        <span className={cn('font-bold', getFatigueTextColor(score), labelSizeClasses[size])}>
          {score}
        </span>
        <span className="text-xs">{getFatigueEmoji(score)}</span>
      </div>
      {showLabel && (
        <span className={cn('text-muted-foreground', labelSizeClasses[size])}>
          {category}
        </span>
      )}
    </div>
  );
};
