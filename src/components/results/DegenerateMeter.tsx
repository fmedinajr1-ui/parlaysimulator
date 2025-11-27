import { FeedCard } from "../FeedCard";
import { DEGEN_TIERS, DegenerateLevel } from "@/types/parlay";
import { useEffect, useState } from "react";

interface DegenerateMeterProps {
  probability: number;
  degenerateLevel: DegenerateLevel;
  delay?: number;
}

const tierOrder: DegenerateLevel[] = ['LOAN_NEEDED', 'LOTTERY_TICKET', 'SWEAT_SEASON', 'NOT_TERRIBLE', 'RESPECTABLE'];

const tierColors: Record<DegenerateLevel, string> = {
  LOAN_NEEDED: "text-neon-red",
  LOTTERY_TICKET: "text-neon-orange", 
  SWEAT_SEASON: "text-neon-yellow",
  NOT_TERRIBLE: "text-neon-purple",
  RESPECTABLE: "text-neon-green",
};

export function DegenerateMeter({ probability, degenerateLevel, delay = 0 }: DegenerateMeterProps) {
  const [fillWidth, setFillWidth] = useState(0);
  const tier = DEGEN_TIERS[degenerateLevel];
  
  // Calculate fill percentage based on tier
  const tierIndex = tierOrder.indexOf(degenerateLevel);
  const targetWidth = ((tierIndex + 1) / tierOrder.length) * 100;

  useEffect(() => {
    const timer = setTimeout(() => {
      setFillWidth(targetWidth);
    }, delay + 200);
    return () => clearTimeout(timer);
  }, [targetWidth, delay]);

  const getGradient = () => {
    if (tierIndex <= 1) return "gradient-fire";
    if (tierIndex === 2) return "gradient-gold";
    if (tierIndex === 3) return "gradient-purple";
    return "gradient-neon";
  };

  return (
    <FeedCard delay={delay}>
      <p className="text-sm text-muted-foreground uppercase tracking-wider mb-4">
        😈 Degenerate Meter
      </p>
      
      {/* Meter bar */}
      <div className="relative h-8 rounded-full bg-muted overflow-hidden mb-4">
        <div 
          className={`absolute inset-y-0 left-0 rounded-full ${getGradient()} transition-all duration-1000 ease-out`}
          style={{ width: `${fillWidth}%` }}
        />
        {/* Animated glow on fill */}
        <div 
          className="absolute inset-y-0 left-0 rounded-full bg-white/20 blur-sm transition-all duration-1000 ease-out"
          style={{ width: `${fillWidth}%` }}
        />
        {/* Tier markers */}
        {tierOrder.map((_, idx) => (
          <div 
            key={idx}
            className="absolute top-0 bottom-0 w-0.5 bg-background/50"
            style={{ left: `${((idx + 1) / tierOrder.length) * 100}%` }}
          />
        ))}
      </div>

      {/* Tier label */}
      <div className="text-center mb-4">
        <span className={`font-display text-2xl md:text-3xl ${tierColors[degenerateLevel]}`}>
          {tier.label} {tier.emoji}
        </span>
      </div>

      {/* Tier legend */}
      <div className="grid grid-cols-5 gap-1 text-xs">
        {tierOrder.map((t) => (
          <div 
            key={t} 
            className={`text-center py-2 rounded-lg transition-all ${
              degenerateLevel === t 
                ? 'bg-muted/80 scale-110' 
                : 'opacity-50'
            }`}
          >
            <span className="text-lg">{DEGEN_TIERS[t].emoji}</span>
          </div>
        ))}
      </div>
    </FeedCard>
  );
}
