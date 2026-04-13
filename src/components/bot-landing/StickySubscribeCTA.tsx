import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

const PARLAY_BOT_PRICE_ID = "price_1T1HU99D6r1PTCBBLQaWi80Z";

interface StickySubscribeCTAProps {
  onSubscribe: (email: string, priceId: string) => void;
  isLoading?: boolean;
}

export function StickySubscribeCTA({ onSubscribe, isLoading }: StickySubscribeCTAProps) {
  const scrollToTrial = () => {
    const banner = document.getElementById("free-trial-banner");
    if (banner) {
      banner.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 animate-fade-in">
      <div className="bg-background/80 backdrop-blur-xl border-t border-primary/20 px-4 py-3 shadow-[0_-4px_30px_hsl(var(--primary)/0.15)]">
        <div className="max-w-md mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">3-day free trial</span>
            <span className="text-lg font-bold text-foreground">$99<span className="text-xs text-muted-foreground font-normal">/mo</span></span>
          </div>
          <Button
            onClick={scrollToTrial}
            disabled={isLoading}
            className="font-bold px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_20px_hsl(var(--primary)/0.4)] hover:shadow-[0_0_30px_hsl(var(--primary)/0.6)] hover:scale-105 transition-all animate-pulse-glow"
          >
            <Zap className="w-4 h-4 mr-1" />
            Start Free Trial
          </Button>
        </div>
      </div>
    </div>
  );
}
