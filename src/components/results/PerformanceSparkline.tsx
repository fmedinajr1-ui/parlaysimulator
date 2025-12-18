import { useMemo } from "react";
import { cn } from "@/lib/utils";

interface PerformanceSparklineProps {
  data: number[];
  threshold?: number;
  height?: number;
  width?: number;
  className?: string;
  showThreshold?: boolean;
}

export function PerformanceSparkline({
  data,
  threshold,
  height = 32,
  width = 100,
  className,
  showThreshold = true
}: PerformanceSparklineProps) {
  const { points, min, max, thresholdY, avg, stdDev } = useMemo(() => {
    if (!data || data.length === 0) return { points: '', min: 0, max: 0, thresholdY: 0, avg: 0, stdDev: 0 };
    
    const minVal = Math.min(...data);
    const maxVal = Math.max(...data);
    const range = maxVal - minVal || 1;
    const padding = 2;
    
    // Calculate average and standard deviation
    const average = data.reduce((a, b) => a + b, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - average, 2), 0) / data.length;
    const sd = Math.sqrt(variance);
    
    // Generate SVG path points
    const pointsArr = data.map((value, index) => {
      const x = padding + (index / (data.length - 1)) * (width - padding * 2);
      const y = padding + ((maxVal - value) / range) * (height - padding * 2);
      return `${x},${y}`;
    });
    
    // Calculate threshold line Y position
    const threshY = threshold !== undefined 
      ? padding + ((maxVal - threshold) / range) * (height - padding * 2)
      : 0;
    
    return { 
      points: pointsArr.join(' '), 
      min: minVal, 
      max: maxVal, 
      thresholdY: threshY,
      avg: average,
      stdDev: sd
    };
  }, [data, threshold, height, width]);

  if (!data || data.length < 2) {
    return (
      <div 
        className={cn("flex items-center justify-center text-xs text-muted-foreground", className)}
        style={{ width, height }}
      >
        No data
      </div>
    );
  }

  // Determine if performance is above/below threshold
  const lastValue = data[data.length - 1];
  const isAboveThreshold = threshold !== undefined && lastValue >= threshold;
  const trend = data.length >= 2 ? (data[data.length - 1] - data[data.length - 2]) : 0;

  return (
    <div className={cn("relative", className)}>
      <svg 
        width={width} 
        height={height} 
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
      >
        {/* Background gradient */}
        <defs>
          <linearGradient id="sparklineGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        
        {/* Threshold line */}
        {showThreshold && threshold !== undefined && (
          <line
            x1="0"
            y1={thresholdY}
            x2={width}
            y2={thresholdY}
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="3,3"
            className="text-neon-yellow/50"
          />
        )}
        
        {/* Area under line */}
        <polygon
          points={`2,${height - 2} ${points} ${width - 2},${height - 2}`}
          className={cn(
            isAboveThreshold ? "text-neon-green" : "text-neon-cyan"
          )}
          fill="url(#sparklineGradient)"
        />
        
        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn(
            isAboveThreshold ? "text-neon-green" : "text-neon-cyan"
          )}
        />
        
        {/* Last point indicator */}
        <circle
          cx={width - 2}
          cy={2 + ((max - lastValue) / (max - min || 1)) * (height - 4)}
          r="3"
          className={cn(
            "fill-current",
            isAboveThreshold ? "text-neon-green" : "text-neon-cyan"
          )}
        />
      </svg>
      
      {/* Stats overlay */}
      <div className="absolute -right-2 top-0 text-[10px] text-muted-foreground">
        {trend > 0 ? '↑' : trend < 0 ? '↓' : '→'}
      </div>
    </div>
  );
}

// IQR Badge component
interface IQRBadgeProps {
  q1: number;
  median: number;
  q3: number;
  currentLine?: number;
  className?: string;
}

export function IQRBadge({ q1, median, q3, currentLine, className }: IQRBadgeProps) {
  const isLineInIQR = currentLine !== undefined && currentLine >= q1 && currentLine <= q3;
  const isLineBelowQ1 = currentLine !== undefined && currentLine < q1;
  
  return (
    <div className={cn("flex items-center gap-1 text-xs", className)}>
      <span className="text-muted-foreground">IQR:</span>
      <span className={cn(
        "font-mono",
        isLineBelowQ1 ? "text-neon-green" : isLineInIQR ? "text-neon-cyan" : "text-neon-yellow"
      )}>
        {q1.toFixed(1)} - {q3.toFixed(1)}
      </span>
      {currentLine !== undefined && (
        <span className={cn(
          "px-1.5 py-0.5 rounded text-[10px]",
          isLineBelowQ1 ? "bg-neon-green/20 text-neon-green" : 
          isLineInIQR ? "bg-neon-cyan/20 text-neon-cyan" : 
          "bg-neon-yellow/20 text-neon-yellow"
        )}>
          Line: {currentLine.toFixed(1)}
        </span>
      )}
    </div>
  );
}

// Consistency indicator
interface ConsistencyIndicatorProps {
  stdDev: number;
  mean: number;
  className?: string;
}

export function ConsistencyIndicator({ stdDev, mean, className }: ConsistencyIndicatorProps) {
  const cv = mean !== 0 ? (stdDev / mean) * 100 : 0; // Coefficient of variation
  
  const getConsistencyLabel = () => {
    if (cv < 15) return { label: 'Very Consistent', color: 'text-neon-green', bg: 'bg-neon-green/10' };
    if (cv < 25) return { label: 'Consistent', color: 'text-neon-cyan', bg: 'bg-neon-cyan/10' };
    if (cv < 35) return { label: 'Variable', color: 'text-neon-yellow', bg: 'bg-neon-yellow/10' };
    return { label: 'Volatile', color: 'text-neon-red', bg: 'bg-neon-red/10' };
  };
  
  const config = getConsistencyLabel();
  
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className={cn("text-xs px-2 py-0.5 rounded", config.bg, config.color)}>
        {config.label}
      </span>
      <span className="text-xs text-muted-foreground">
        σ={stdDev.toFixed(1)}
      </span>
    </div>
  );
}
