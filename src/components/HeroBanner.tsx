import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";

export function HeroBanner() {
  return (
    <div className="relative overflow-hidden rounded-3xl p-6 md:p-8 mb-6">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-neon-purple/20 via-background to-neon-green/10 -z-10" />
      
      {/* Animated glow orbs */}
      <div className="absolute top-0 left-1/4 w-32 h-32 bg-neon-purple/30 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-0 right-1/4 w-40 h-40 bg-neon-green/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      
      {/* Floating emojis */}
      <div className="absolute top-4 left-8 text-2xl animate-bounce" style={{ animationDelay: '0.5s' }}>🎰</div>
      <div className="absolute top-12 right-10 text-xl animate-bounce" style={{ animationDelay: '1s' }}>💸</div>
      <div className="absolute bottom-8 left-6 text-2xl animate-bounce" style={{ animationDelay: '1.5s' }}>🎟️</div>
      <div className="absolute bottom-12 right-8 text-xl animate-bounce" style={{ animationDelay: '0.8s' }}>🔥</div>
      
      <div className="relative z-10 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-neon-purple/20 border border-neon-purple/30 mb-4">
          <Sparkles className="w-4 h-4 text-neon-purple" />
          <span className="text-sm text-neon-purple font-medium">AI-Powered Analysis</span>
        </div>
        
        <h1 className="font-display text-4xl md:text-6xl lg:text-7xl tracking-wide mb-3">
          <span className="text-gradient-fire">🔥 PARLAY SIMULATOR</span>
        </h1>
        <p className="font-display text-2xl md:text-3xl text-gradient-purple mb-4">
          SOCIAL DEGEN MODE 🔥
        </p>
        <p className="text-muted-foreground text-lg md:text-xl mb-6 max-w-md mx-auto">
          Upload your slip… get roasted… get enlightened. 😈
        </p>
        <Link to="/upload">
          <Button variant="neon" size="xl" className="font-display text-xl tracking-wider">
            🎟️ UPLOAD SLIP
          </Button>
        </Link>
      </div>
    </div>
  );
}
