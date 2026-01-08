import { cn } from "@/lib/utils";

export type HeatLevel = 'RED' | 'ORANGE' | 'YELLOW' | 'GREEN';

const HEAT_STYLES: Record<HeatLevel, { bg: string; border: string; text: string; emoji: string }> = {
  RED: { 
    bg: 'bg-red-500/20', 
    border: 'border-red-500/50', 
    text: 'text-red-400', 
    emoji: '🟥'
  },
  ORANGE: { 
    bg: 'bg-orange-500/20', 
    border: 'border-orange-500/50', 
    text: 'text-orange-400', 
    emoji: '🟧'
  },
  YELLOW: { 
    bg: 'bg-yellow-500/20', 
    border: 'border-yellow-500/50', 
    text: 'text-yellow-400', 
    emoji: '🟨'
  },
  GREEN: { 
    bg: 'bg-green-500/20', 
    border: 'border-green-500/50', 
    text: 'text-green-400', 
    emoji: '🟩'
  },
};

interface HeatBadgeProps {
  level: HeatLevel;
  score?: number;
  showScore?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function HeatBadge({ level, score, showScore = false, size = 'md', className }: HeatBadgeProps) {
  const styles = HEAT_STYLES[level];
  
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  if (!showScore) {
    return <span className={cn("text-base", className)}>{styles.emoji}</span>;
  }

  return (
    <div className={cn(
      "inline-flex items-center gap-1.5 rounded-md border",
      styles.bg,
      styles.border,
      styles.text,
      sizeClasses[size],
      className
    )}>
      <span>{styles.emoji}</span>
      {score !== undefined && <span className="font-mono font-semibold">{score}</span>}
    </div>
  );
}

export function calculateHeatLevel(engineScore: number, marketScore: number | null): {
  heat: number;
  level: HeatLevel;
} {
  // If no market data, use engine-only mode
  if (marketScore === null || marketScore === undefined) {
    const engineHeat = Math.round((engineScore / 10) * 100);
    if (engineHeat >= 85) return { heat: engineHeat, level: 'RED' };
    if (engineHeat >= 78) return { heat: engineHeat, level: 'ORANGE' };
    if (engineHeat >= 70) return { heat: engineHeat, level: 'YELLOW' };
    return { heat: engineHeat, level: 'GREEN' };
  }

  // Normalize engine score (0-10) to 0-50
  const normalizedEngine = (engineScore / 10) * 50;
  
  // Market score is already 0-100, use 50% weight
  const normalizedMarket = marketScore * 0.5;
  
  // Combined heat score 0-100
  const heat = Math.round(normalizedEngine + normalizedMarket);
  
  if (heat >= 80) return { heat, level: 'RED' };
  if (heat >= 60) return { heat, level: 'ORANGE' };
  if (heat >= 40) return { heat, level: 'YELLOW' };
  return { heat, level: 'GREEN' };
}
