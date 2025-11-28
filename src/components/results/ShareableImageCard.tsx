import { forwardRef } from "react";
import { DEGEN_TIERS, DegenerateLevel, ParlayLeg } from "@/types/parlay";

interface ShareableImageCardProps {
  probability: number;
  degenerateLevel: DegenerateLevel;
  legs: ParlayLeg[];
  stake: number;
  potentialPayout: number;
  roast?: string;
}

export const ShareableImageCard = forwardRef<HTMLDivElement, ShareableImageCardProps>(
  ({ probability, degenerateLevel, legs, stake, potentialPayout, roast }, ref) => {
    const tier = DEGEN_TIERS[degenerateLevel];
    const pct = probability * 100;

    return (
      <div
        ref={ref}
        className="w-[400px] p-6 rounded-3xl relative overflow-hidden"
        style={{
          background: "linear-gradient(145deg, #0f1015 0%, #1a1b26 50%, #0f1015 100%)",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        {/* Background decorations */}
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            background: `radial-gradient(circle at 20% 20%, hsl(280 70% 60% / 0.4) 0%, transparent 50%),
                         radial-gradient(circle at 80% 80%, hsl(142 70% 50% / 0.4) 0%, transparent 50%)`,
          }}
        />
        
        {/* Noise texture overlay */}
        <div 
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          }}
        />

        {/* Content */}
        <div className="relative z-10">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🎟️</span>
              <span 
                className="text-sm font-bold tracking-wider"
                style={{ 
                  fontFamily: "'Bebas Neue', sans-serif",
                  color: "hsl(0 0% 70%)",
                }}
              >
                {legs.length}-LEG PARLAY
              </span>
            </div>
            <div 
              className="px-3 py-1 rounded-full text-xs font-semibold"
              style={{
                background: "linear-gradient(135deg, hsl(280 70% 60% / 0.3), hsl(320 80% 60% / 0.3))",
                color: "hsl(280 70% 75%)",
                border: "1px solid hsl(280 70% 60% / 0.5)",
              }}
            >
              DEGEN CERTIFIED
            </div>
          </div>

          {/* Main stat */}
          <div className="text-center py-6">
            <div 
              className="text-7xl font-bold mb-2"
              style={{
                fontFamily: "'Bebas Neue', sans-serif",
                background: "linear-gradient(135deg, hsl(142 70% 50%), hsl(185 80% 55%))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {pct.toFixed(1)}%
            </div>
            <p 
              className="text-sm mb-4"
              style={{ color: "hsl(0 0% 60%)" }}
            >
              Win Probability
            </p>
            
            {/* Tier badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl"
              style={{
                background: "hsl(240 12% 14%)",
                border: "1px solid hsl(240 10% 25%)",
              }}
            >
              <span className="text-3xl">{tier.emoji}</span>
              <span 
                className="text-lg font-bold"
                style={{ 
                  fontFamily: "'Bebas Neue', sans-serif",
                  color: "hsl(45 100% 55%)",
                }}
              >
                {tier.label}
              </span>
            </div>
          </div>

          {/* Stats row */}
          <div 
            className="grid grid-cols-2 gap-3 mb-4 p-3 rounded-xl"
            style={{ background: "hsl(240 12% 12%)" }}
          >
            <div className="text-center">
              <p className="text-xs mb-1" style={{ color: "hsl(0 0% 50%)" }}>STAKE</p>
              <p className="font-bold" style={{ color: "hsl(0 0% 98%)" }}>
                ${stake.toFixed(2)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs mb-1" style={{ color: "hsl(0 0% 50%)" }}>TO WIN</p>
              <p 
                className="font-bold"
                style={{ color: "hsl(142 70% 50%)" }}
              >
                ${potentialPayout.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Roast */}
          {roast && (
            <div 
              className="p-3 rounded-xl mb-4"
              style={{ 
                background: "linear-gradient(135deg, hsl(25 100% 55% / 0.1), hsl(0 80% 55% / 0.1))",
                border: "1px solid hsl(25 100% 55% / 0.3)",
              }}
            >
              <p 
                className="text-sm italic text-center"
                style={{ color: "hsl(0 0% 85%)" }}
              >
                "{roast}"
              </p>
            </div>
          )}

          {/* Legs preview */}
          <div className="space-y-1.5 mb-4">
            {legs.slice(0, 3).map((leg, i) => (
              <div 
                key={i}
                className="flex items-center gap-2 text-xs p-2 rounded-lg"
                style={{ background: "hsl(240 12% 14%)" }}
              >
                <span 
                  className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{ 
                    background: "hsl(280 70% 60% / 0.3)",
                    color: "hsl(280 70% 75%)",
                  }}
                >
                  {i + 1}
                </span>
                <span 
                  className="flex-1 truncate"
                  style={{ color: "hsl(0 0% 80%)" }}
                >
                  {leg.description}
                </span>
              </div>
            ))}
            {legs.length > 3 && (
              <p 
                className="text-xs text-center"
                style={{ color: "hsl(0 0% 50%)" }}
              >
                +{legs.length - 3} more legs
              </p>
            )}
          </div>

          {/* Footer */}
          <div 
            className="flex items-center justify-between pt-3"
            style={{ borderTop: "1px solid hsl(240 10% 20%)" }}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-lg">🔥</span>
              <span 
                className="text-xs font-bold"
                style={{ 
                  fontFamily: "'Bebas Neue', sans-serif",
                  color: "hsl(0 0% 60%)",
                }}
              >
                PARLAY SIMULATOR
              </span>
            </div>
            <div 
              className="text-xs"
              style={{ color: "hsl(0 0% 45%)" }}
            >
              @parlaysim
            </div>
          </div>
        </div>
      </div>
    );
  }
);

ShareableImageCard.displayName = "ShareableImageCard";
