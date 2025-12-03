import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";

export function HeroBanner() {
  return (
    <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-8 mb-4 sm:mb-6">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-neon-purple/20 via-background to-neon-green/10 -z-10" />
      
      {/* Animated glow orbs - scaled for mobile */}
      <div className="absolute top-0 left-1/4 w-16 sm:w-24 md:w-32 h-16 sm:h-24 md:h-32 bg-neon-purple/30 rounded-full blur-2xl sm:blur-3xl animate-pulse" />
      <div className="absolute bottom-0 right-1/4 w-20 sm:w-32 md:w-40 h-20 sm:h-32 md:h-40 bg-neon-green/20 rounded-full blur-2xl sm:blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      
      {/* Floating emojis - repositioned for mobile */}
      <div className="absolute top-2 sm:top-4 left-2 sm:left-8 text-lg sm:text-2xl animate-bounce opacity-70 sm:opacity-100" style={{ animationDelay: '0.5s' }}>🎰</div>
      <div className="absolute top-6 sm:top-12 right-2 sm:right-10 text-base sm:text-xl animate-bounce opacity-70 sm:opacity-100" style={{ animationDelay: '1s' }}>💸</div>
      <div className="absolute bottom-4 sm:bottom-8 left-1 sm:left-6 text-lg sm:text-2xl animate-bounce opacity-70 sm:opacity-100" style={{ animationDelay: '1.5s' }}>🎟️</div>
      <div className="absolute bottom-8 sm:bottom-12 right-1 sm:right-8 text-base sm:text-xl animate-bounce opacity-70 sm:opacity-100" style={{ animationDelay: '0.8s' }}>🔥</div>
      
      <div className="relative z-10 text-center px-2 sm:px-0">
        <div className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-1 sm:py-1.5 rounded-full bg-neon-purple/20 border border-neon-purple/30 mb-3 sm:mb-4">
          <Sparkles className="w-3 h-3 sm:w-4 sm:h-4 text-neon-purple" />
          <span className="text-xs sm:text-sm text-neon-purple font-medium">AI-Powered Analysis</span>
        </div>
        
        <h1 className="font-display text-fluid-hero tracking-wide mb-2 sm:mb-3">
          <span className="text-gradient-fire">🔥 PARLAY SIMULATOR</span>
        </h1>
        <p className="font-display text-fluid-hero-sub text-gradient-purple mb-2 sm:mb-4">
          SOCIAL DEGEN MODE 🔥
        </p>
        <p className="text-muted-foreground text-fluid-body mb-4 sm:mb-6 max-w-xs sm:max-w-md mx-auto leading-relaxed">
          Upload your slip… get roasted… get enlightened. 😈
        </p>
        <Link to="/upload">
          <Button variant="neon" size="lg" className="font-display text-base sm:text-lg md:text-xl tracking-wider touch-target">
            🎟️ UPLOAD SLIP
          </Button>
        </Link>
      </div>
    </div>
  );
}
