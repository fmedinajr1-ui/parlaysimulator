import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { ParlayFarmLogo } from "@/components/ParlayFarmLogo";

export function HeroBanner() {
  return (
    <div className="relative overflow-hidden rounded-xl p-4 mb-4">
      {/* Background gradient - subtle on mobile */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-background to-neon-green/5 -z-10" />
      
      {/* Reduced glow orbs - hidden on small screens */}
      <div className="absolute top-0 left-1/4 w-16 h-16 bg-primary/15 rounded-full blur-2xl animate-pulse hidden sm:block" />
      
      <div className="relative z-10 text-center">
        {/* Logo */}
        <div className="flex justify-center mb-3">
          <ParlayFarmLogo size="2xl" className="sm:h-44 drop-shadow-lg" />
        </div>
        
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
