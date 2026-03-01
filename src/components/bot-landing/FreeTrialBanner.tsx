import { useState } from "react";
import { Check, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

const PARLAY_BOT_PRICE_ID = "price_1T1HU99D6r1PTCBBLQaWi80Z";

const FEATURES = [
  "Daily AI-generated parlay picks",
  "Full parlay leg breakdowns and odds",
  "Strategy analysis and reasoning",
  "Performance calendar with P&L details",
  "Telegram bot alerts and commands",
  "Real-time live prop tracking",
];

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
      <div className="relative max-w-md mx-auto rounded-2xl border-2 border-primary/40 bg-card/95 backdrop-blur-sm overflow-hidden shadow-xl shadow-primary/10">
        {/* Glow orbs */}
        <div className="absolute -top-12 -left-12 w-32 h-32 bg-primary/20 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-12 -right-12 w-32 h-32 bg-accent/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />

        {/* MOST POPULAR badge */}
        <div className="absolute top-4 right-4 z-20 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider animate-scale-in">
          <Zap className="w-3 h-3" />
          Most Popular
        </div>

        {/* Header bar */}
        <div className="relative z-10 bg-gradient-to-r from-background to-muted px-6 py-4 border-b border-border">
          <h2 className="text-2xl font-display tracking-wide text-foreground uppercase">Parlay Bot</h2>
        </div>

        <div className="relative z-10 px-6 py-6 space-y-5">
          {/* Pricing */}
          <div className="space-y-1">
            <div className="flex items-baseline gap-1">
              <span className="text-5xl font-bold text-foreground">$99</span>
              <span className="text-muted-foreground text-base">/month</span>
            </div>
            <p className="text-muted-foreground text-sm">Cancel anytime · 3-day free trial</p>
          </div>

          <Separator />

          {/* Feature checklist */}
          <ul className="space-y-3">
            {FEATURES.map((feature, i) => (
              <li
                key={i}
                className="flex items-start gap-2.5 text-sm text-foreground animate-fade-in"
                style={{ animationDelay: `${0.3 + i * 0.08}s`, animationFillMode: "both" }}
              >
                <Check className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                {feature}
              </li>
            ))}
          </ul>

          <Separator />

          {/* Email + CTA */}
          <div className="space-y-3">
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
              {isLoading ? "Loading..." : "Start 3-Day Free Trial — $99/mo"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
