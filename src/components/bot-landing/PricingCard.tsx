import { Check, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PricingCardProps {
  onSubscribe: () => void;
  isLoading?: boolean;
  isSubscribed?: boolean;
}

const features = [
  "Daily AI-generated parlay picks",
  "Full parlay leg breakdowns & odds",
  "Strategy analysis & reasoning",
  "Performance calendar with P&L details",
  "Telegram bot alerts & commands",
  "Real-time live prop tracking",
];

export function PricingCard({ onSubscribe, isLoading, isSubscribed }: PricingCardProps) {
  return (
    <section className="py-12 px-4 sm:px-6" id="pricing">
      <div className="max-w-md mx-auto">
        <div className="bg-card border-2 border-primary/30 rounded-2xl overflow-hidden shadow-lg shadow-primary/5">
          {/* Header */}
          <div className="bg-gradient-to-r from-primary/20 to-secondary/20 px-6 py-5 text-center">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-primary/20 rounded-full text-primary text-xs font-bold uppercase tracking-wider mb-2">
              <Zap className="w-3 h-3" />
              Pro Access
            </div>
            <h3 className="text-2xl font-bold text-foreground font-bebas tracking-wide">Parlay Bot Pro</h3>
          </div>

          {/* Price */}
          <div className="px-6 py-6 text-center border-b border-border">
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-5xl font-bold text-foreground">$99</span>
              <span className="text-muted-foreground text-sm">/month</span>
            </div>
            <p className="text-muted-foreground text-sm mt-1">Cancel anytime</p>
          </div>

          {/* Features */}
          <div className="px-6 py-5 space-y-3">
            {features.map((feature) => (
              <div key={feature} className="flex items-start gap-2.5">
                <Check className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                <span className="text-sm text-foreground">{feature}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="px-6 pb-6">
            {isSubscribed ? (
              <Button className="w-full" variant="secondary" disabled>
                ✓ You're a member
              </Button>
            ) : (
              <Button
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-lg py-6"
                onClick={onSubscribe}
                disabled={isLoading}
              >
                {isLoading ? 'Loading...' : 'Join Now — $99/mo'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
