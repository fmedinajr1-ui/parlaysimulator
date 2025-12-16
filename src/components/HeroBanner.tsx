import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight, Dog } from "lucide-react";

export function HeroBanner() {
  return (
    <div className="relative overflow-hidden rounded-xl p-4 mb-4">
      {/* Background gradient - subtle on mobile */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-neon-green/5 -z-10" />
      
      {/* Reduced glow orbs - hidden on small screens */}
      <div className="absolute top-0 left-1/4 w-16 h-16 bg-primary/15 rounded-full blur-2xl animate-pulse hidden sm:block" />
      
      <div className="relative z-10 text-center">
        {/* Compact Farm Badge */}
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/10 border border-primary/20 mb-3">
          <Dog className="w-3 h-3 text-primary" />
          <span className="text-xs text-primary font-medium">AI-Powered Picks</span>
        </div>
        
        {/* Compact Title */}
        <h1 className="font-display text-2xl sm:text-3xl tracking-wide mb-1.5">
          <span className="text-gradient-fire">PARLAY FARM</span>
        </h1>
        
        <p className="text-muted-foreground text-xs sm:text-sm mb-4 max-w-[280px] mx-auto leading-relaxed">
          Track sharps, tail winners, unleash your inner wolf 🐺
        </p>
        
        {/* Compact CTA Button */}
        <Link to="/upload">
          <Button variant="neon" size="default" className="font-display text-base tracking-wider h-10 px-6">
            GET STARTED
            <ArrowRight className="w-4 h-4 ml-1.5" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
