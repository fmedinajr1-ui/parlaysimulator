import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Sparkles, ArrowRight } from "lucide-react";

export function HeroBanner() {
  return (
    <div className="relative overflow-hidden rounded-2xl p-5 mb-5">
      {/* Background gradient - simplified */}
      <div className="absolute inset-0 bg-gradient-to-br from-neon-purple/15 via-background to-neon-green/10 -z-10" />
      
      {/* Animated glow orbs - subtler */}
      <div className="absolute top-0 left-1/4 w-20 h-20 bg-neon-purple/20 rounded-full blur-2xl animate-pulse" />
      <div className="absolute bottom-0 right-1/4 w-24 h-24 bg-neon-green/15 rounded-full blur-2xl animate-pulse" style={{ animationDelay: '1s' }} />
      
      <div className="relative z-10 text-center">
        {/* AI Badge */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 mb-4">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs text-primary font-medium">AI-Powered Analysis</span>
        </div>
        
        {/* Title - More compact */}
        <h1 className="font-display text-3xl sm:text-4xl tracking-wide mb-2">
          <span className="text-gradient-fire">PARLAY SIMULATOR</span>
        </h1>
        
        <p className="text-muted-foreground text-sm mb-5 max-w-xs mx-auto">
          Upload your slip, get AI analysis, win smarter 🎯
        </p>
        
        {/* CTA Button */}
        <Link to="/upload">
          <Button variant="neon" size="lg" className="font-display text-lg tracking-wider touch-target-lg h-12 px-8">
            GET STARTED
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
