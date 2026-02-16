import { useState } from "react";
import { Check, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PricingCardProps {
  onSubscribe: (email: string) => void;
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
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = () => {
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }
    setError("");
    onSubscribe(email);
  };

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
          <div className="px-6 pb-6 space-y-3">
            {isSubscribed ? (
              <Button className="w-full" variant="secondary" disabled>
                ✓ You're a member
              </Button>
            ) : (
              <>
                <div>
                  <Input
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(""); }}
                    className={error ? "border-destructive" : ""}
                  />
                  {error && <p className="text-destructive text-xs mt-1">{error}</p>}
                </div>
                <Button
                  className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-lg py-6"
                  onClick={handleSubmit}
                  disabled={isLoading}
                >
                  {isLoading ? 'Loading...' : 'Join Now — $99/mo'}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
