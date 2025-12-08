import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface UpsetScoreGaugeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

export function UpsetScoreGauge({ 
  score, 
  size = 'md', 
  showLabel = true,
  className 
}: UpsetScoreGaugeProps) {
  const sizeConfig = {
    sm: { width: 80, height: 40, strokeWidth: 6, fontSize: 'text-sm' },
    md: { width: 120, height: 60, strokeWidth: 8, fontSize: 'text-lg' },
    lg: { width: 160, height: 80, strokeWidth: 10, fontSize: 'text-2xl' }
  };

  const config = sizeConfig[size];
  const radius = config.width / 2 - config.strokeWidth;
  const circumference = Math.PI * radius;
  const progress = (score / 100) * circumference;

  // Color based on score
  const getColor = (score: number) => {
    if (score >= 70) return 'hsl(var(--chart-2))'; // Green
    if (score >= 50) return 'hsl(var(--chart-4))'; // Yellow
    if (score >= 30) return 'hsl(var(--chart-5))'; // Orange
    return 'hsl(var(--destructive))'; // Red
  };

  const getLabel = (score: number) => {
    if (score >= 70) return 'GOD MODE';
    if (score >= 50) return 'STRONG';
    if (score >= 30) return 'MODERATE';
    return 'WEAK';
  };

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <svg 
        width={config.width} 
        height={config.height + 10}
        viewBox={`0 0 ${config.width} ${config.height + 10}`}
      >
        {/* Background arc */}
        <path
          d={`M ${config.strokeWidth} ${config.height} 
              A ${radius} ${radius} 0 0 1 ${config.width - config.strokeWidth} ${config.height}`}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={config.strokeWidth}
          strokeLinecap="round"
        />
        
        {/* Progress arc */}
        <motion.path
          d={`M ${config.strokeWidth} ${config.height} 
              A ${radius} ${radius} 0 0 1 ${config.width - config.strokeWidth} ${config.height}`}
          fill="none"
          stroke={getColor(score)}
          strokeWidth={config.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference - progress }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />

        {/* Score text */}
        <text
          x={config.width / 2}
          y={config.height - 5}
          textAnchor="middle"
          className={cn(config.fontSize, 'font-bold fill-foreground')}
        >
          {Math.round(score)}
        </text>
      </svg>

      {showLabel && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-1"
        >
          <span 
            className="text-xs font-semibold tracking-wider"
            style={{ color: getColor(score) }}
          >
            {getLabel(score)}
          </span>
        </motion.div>
      )}
    </div>
  );
}
