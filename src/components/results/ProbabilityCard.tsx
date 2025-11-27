import { FeedCard } from "../FeedCard";
import { DEGEN_TIERS, DegenerateLevel } from "@/types/parlay";
import { useEffect, useState } from "react";

interface ProbabilityCardProps {
  probability: number;
  degenerateLevel: DegenerateLevel;
  delay?: number;
}

export function ProbabilityCard({ probability, degenerateLevel, delay = 0 }: ProbabilityCardProps) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [displayPct, setDisplayPct] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const tier = DEGEN_TIERS[degenerateLevel];
  const actualPct = probability * 100;

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsAnimating(true);
      // Animate the percentage
      const duration = 1500;
      const steps = 60;
      const increment = actualPct / steps;
      let current = 0;
      
      const interval = setInterval(() => {
        current += increment;
        if (current >= actualPct) {
          setDisplayPct(actualPct);
          clearInterval(interval);
          setShowEmoji(true);
        } else {
          setDisplayPct(current);
        }
      }, duration / steps);

      return () => clearInterval(interval);
    }, delay);

    return () => clearTimeout(timer);
  }, [actualPct, delay]);

  const getColorClass = () => {
    if (actualPct < 2) return "text-neon-red";
    if (actualPct < 5) return "text-neon-orange";
    if (actualPct < 15) return "text-neon-yellow";
    if (actualPct < 30) return "text-neon-purple";
    return "text-neon-green";
  };

  const getGlowClass = () => {
    if (actualPct < 2) return "drop-shadow-[0_0_30px_hsl(var(--neon-red)/0.5)]";
    if (actualPct < 5) return "drop-shadow-[0_0_30px_hsl(var(--neon-orange)/0.5)]";
    if (actualPct < 15) return "drop-shadow-[0_0_30px_hsl(var(--neon-yellow)/0.5)]";
    if (actualPct < 30) return "drop-shadow-[0_0_30px_hsl(var(--neon-purple)/0.5)]";
    return "drop-shadow-[0_0_30px_hsl(var(--neon-green)/0.5)]";
  };

  return (
    <FeedCard variant="glow" delay={delay} className="text-center">
      <p className="text-sm text-muted-foreground uppercase tracking-wider mb-4">
        🎯 Win Probability
      </p>
      
      <div className="relative mb-4 inline-block">
        <span className={`font-display text-7xl md:text-8xl ${getColorClass()} ${isAnimating ? getGlowClass() : ''} transition-all duration-500`}>
          {displayPct.toFixed(1)}%
        </span>
        {showEmoji && (
          <span className="absolute -right-8 -top-2 text-5xl emoji-bounce">
            {tier.emoji}
          </span>
        )}
      </div>

      <p className="text-lg text-muted-foreground max-w-xs mx-auto">
        {tier.subtext}
      </p>
      
      {/* Fun stat */}
      <div className="mt-4 pt-4 border-t border-border/50">
        <p className="text-sm text-muted-foreground">
          {actualPct < 5 
            ? "🎰 You'd have better luck at the slot machines"
            : actualPct < 15 
            ? "😰 Prepare for a sweaty Sunday"
            : actualPct < 30 
            ? "🤔 Not impossible, but not great"
            : "✅ This might actually have a chance"}
        </p>
      </div>
    </FeedCard>
  );
}
