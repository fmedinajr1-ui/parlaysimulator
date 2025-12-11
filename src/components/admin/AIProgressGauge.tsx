import { motion } from 'framer-motion';

interface AIProgressGaugeProps {
  currentAccuracy: number;
  targetAccuracy: number;
  winRate: number;
}

export function AIProgressGauge({ currentAccuracy, targetAccuracy, winRate }: AIProgressGaugeProps) {
  const progress = Math.min((currentAccuracy / targetAccuracy) * 100, 100);
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  const milestones = [
    { value: 55, label: '55%' },
    { value: 60, label: '60%' },
    { value: 65, label: '65%' }
  ];

  const getColor = () => {
    if (currentAccuracy >= 65) return 'text-green-500';
    if (currentAccuracy >= 60) return 'text-cyan-500';
    if (currentAccuracy >= 55) return 'text-yellow-500';
    return 'text-orange-500';
  };

  const getStrokeColor = () => {
    if (currentAccuracy >= 65) return '#22c55e';
    if (currentAccuracy >= 60) return '#06b6d4';
    if (currentAccuracy >= 55) return '#eab308';
    return '#f97316';
  };

  const getStatus = () => {
    if (currentAccuracy >= 65) return '🎯 TARGET REACHED!';
    if (currentAccuracy >= 60) return 'Almost there!';
    if (currentAccuracy >= 55) return 'Making progress';
    return 'Training in progress';
  };

  return (
    <div className="flex flex-col items-center justify-center">
      {/* Circular Gauge */}
      <div className="relative w-36 h-36">
        <svg className="w-full h-full transform -rotate-90">
          {/* Background circle */}
          <circle
            cx="72"
            cy="72"
            r="45"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            className="text-muted/30"
          />
          
          {/* Progress arc */}
          <motion.circle
            cx="72"
            cy="72"
            r="45"
            fill="none"
            stroke={getStrokeColor()}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />

          {/* Milestone markers */}
          {milestones.map((milestone) => {
            const angle = ((milestone.value / targetAccuracy) * 100 / 100) * 360 - 90;
            const rad = (angle * Math.PI) / 180;
            const x = 72 + 45 * Math.cos(rad);
            const y = 72 + 45 * Math.sin(rad);
            const reached = currentAccuracy >= milestone.value;
            
            return (
              <circle
                key={milestone.value}
                cx={x}
                cy={y}
                r="4"
                fill={reached ? getStrokeColor() : 'currentColor'}
                className={reached ? '' : 'text-muted-foreground/50'}
              />
            );
          })}
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span 
            className={`text-3xl font-bold ${getColor()}`}
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            {currentAccuracy.toFixed(1)}%
          </motion.span>
          <span className="text-xs text-muted-foreground">
            / {targetAccuracy}%
          </span>
        </div>
      </div>

      {/* Status */}
      <div className="text-center mt-3">
        <p className={`font-medium ${getColor()}`}>{getStatus()}</p>
        <p className="text-xs text-muted-foreground">
          Win Rate: {winRate.toFixed(1)}%
        </p>
      </div>

      {/* Milestone Progress Bar */}
      <div className="w-full mt-4">
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>0%</span>
          {milestones.map((m) => (
            <span 
              key={m.value} 
              className={currentAccuracy >= m.value ? getColor() : ''}
            >
              {m.label}
            </span>
          ))}
        </div>
        <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: getStrokeColor() }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min((currentAccuracy / targetAccuracy) * 100, 100)}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </div>
      </div>
    </div>
  );
}
