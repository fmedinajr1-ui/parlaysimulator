import { useState } from "react";
import { Clock, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PARLAY_BOT_PRICE_ID = "price_1T1HU99D6r1PTCBBLQaWi80Z";

interface FreeTrialBannerProps {
  onSubscribe: (email: string, priceId: string) => void;
  isLoading?: boolean;
}

export function FreeTrialBanner({ onSubscribe, isLoading }: FreeTrialBannerProps) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = () => {
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }
    setError("");
    onSubscribe(email, PARLAY_BOT_PRICE_ID);
  };

  return (
    <section className="px-4 py-6 animate-fade-in" style={{ animationDelay: "0.2s", animationFillMode: "both" }}>
      <div className="relative max-w-2xl mx-auto rounded-2xl border-2 border-primary/40 bg-card/80 backdrop-blur-sm overflow-hidden shadow-xl shadow-primary/10">
        {/* Glow orbs */}
        <div className="absolute -top-12 -left-12 w-32 h-32 bg-primary/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-accent/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />

        <div className="relative z-10 p-6 sm:p-8 text-center space-y-4">
          {/* Badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/20 text-primary text-xs font-bold uppercase tracking-wider animate-scale-in">
            <Zap className="w-3 h-3" />
            Free Trial
          </div>

          {/* Headline */}
          <h2 className="text-2xl sm:text-3xl font-bold font-bebas tracking-wide text-foreground">
            Start Your 3-Day Free Trial
          </h2>

          {/* Price */}
          <div className="flex items-baseline justify-center gap-1">
            <span className="text-4xl font-bold text-foreground">$99</span>
            <span className="text-muted-foreground text-sm">/month after trial</span>
          </div>

          {/* Urgency */}
          <p className="inline-flex items-center gap-1.5 text-destructive text-sm font-semibold animate-pulse">
            <Clock className="w-4 h-4" />
            Free trial ends March 12th
          </p>

          {/* Email + CTA */}
          <div className="max-w-sm mx-auto space-y-3 pt-2">
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
              className="w-full font-bold text-base py-5 bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/30 hover:scale-105 transition-transform"
              onClick={handleSubmit}
              disabled={isLoading}
            >
              {isLoading ? "Loading..." : "Join Now"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
