import { Lock, Zap, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscription } from "@/hooks/useSubscription";

export function AutoPicksPaywall() {
  const { startCheckout, isLoading } = useSubscription();

  const features = [
    "Auto-analyzed player props daily",
    "5-Median calculation engine",
    "Edge recommendations updated daily",
    "Strong/Lean pick classification",
  ];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-card/90 via-card/70 to-primary/10 backdrop-blur-sm">
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-primary/10 rounded-full blur-3xl" />
      <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-cyan-500/10 rounded-full blur-3xl" />
      
      <div className="relative p-6 space-y-6 text-center">
        {/* Lock Icon */}
        <div className="flex justify-center">
          <div className="p-4 rounded-2xl bg-primary/20 border border-primary/40 shadow-lg shadow-primary/20">
            <Lock className="w-8 h-8 text-primary" />
          </div>
        </div>

        {/* Headline */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-primary uppercase tracking-wider">Premium Feature</p>
          <h3 className="text-2xl font-bold flex items-center justify-center gap-2">
            <Zap className="w-5 h-5 text-amber-400" />
            Unlock Auto Picks
            <Zap className="w-5 h-5 text-amber-400" />
          </h3>
          <p className="text-muted-foreground text-sm max-w-xs mx-auto">
            Get AI-generated median edge picks delivered to you daily
          </p>
        </div>

        {/* Features */}
        <div className="space-y-2 max-w-xs mx-auto">
          {features.map((feature, i) => (
            <div key={i} className="flex items-center gap-3 text-left">
              <div className="p-1 rounded-full bg-emerald-500/20">
                <Check className="w-3 h-3 text-emerald-400" />
              </div>
              <span className="text-sm text-foreground/80">{feature}</span>
            </div>
          ))}
        </div>

        {/* Price */}
        <div className="pt-2">
          <div className="inline-flex items-baseline gap-1">
            <span className="text-3xl font-bold text-primary">$9.99</span>
            <span className="text-muted-foreground">/month</span>
          </div>
        </div>

        {/* CTA Button */}
        <Button 
          onClick={startCheckout}
          disabled={isLoading}
          className="w-full max-w-xs bg-gradient-to-r from-primary to-cyan-500 hover:from-primary/90 hover:to-cyan-500/90 text-primary-foreground font-semibold py-6 text-lg shadow-lg shadow-primary/30"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
          ) : (
            <Zap className="w-5 h-5 mr-2" />
          )}
          Subscribe Now
        </Button>

        {/* Footer */}
        <p className="text-xs text-muted-foreground">
          Cancel anytime. Instant access after payment.
        </p>
      </div>
    </div>
  );
}
