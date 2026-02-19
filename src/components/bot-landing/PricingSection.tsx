import { useState } from "react";
import { Check, Zap, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PricingSectionProps {
  onSubscribe: (email: string, priceId: string) => void;
  isLoading?: boolean;
  loadingPriceId?: string;
  isSubscribed?: boolean;
  onCtaClick?: () => void;
}

const PARLAY_BOT_PRICE_ID = "price_1T1HU99D6r1PTCBBLQaWi80Z";
const SCOUT_PRICE_ID = "price_1T2br19D6r1PTCBBfrDD4opY";

const tiers = [
  {
    id: "parlay-bot",
    priceId: PARLAY_BOT_PRICE_ID,
    name: "Parlay Bot",
    price: 99,
    badge: "Most Popular",
    badgeIcon: Zap,
    highlight: true,
    features: [
      "Daily AI-generated parlay picks",
      "Full parlay leg breakdowns & odds",
      "Strategy analysis & reasoning",
      "Performance calendar with P&L details",
      "Telegram bot alerts & commands",
      "Real-time live prop tracking",
    ],
    cta: "Join Parlay Bot — $99/mo",
    hasTrial: false,
  },
  {
    id: "scout",
    priceId: SCOUT_PRICE_ID,
    name: "Scout",
    price: 750,
    badge: "Live Edge",
    badgeIcon: Eye,
    highlight: false,
    scoutAccent: true,
    features: [
      "Real-time streaming analysis",
      "Live player prop tracking",
      "Game bets & whale signals",
      "Lock Mode advanced picks",
      "AI-powered halftime edges",
      "Full Scout dashboard access",
    ],
    cta: "Start Free Trial — $750/mo",
    hasTrial: true,
  },
];

function TierCard({
  tier,
  onSubscribe,
  isLoading,
  loadingPriceId,
  isSubscribed,
  onCtaClick,
}: {
  tier: (typeof tiers)[0];
  onSubscribe: (email: string, priceId: string) => void;
  isLoading?: boolean;
  loadingPriceId?: string;
  isSubscribed?: boolean;
  onCtaClick?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const isThisLoading = isLoading && loadingPriceId === tier.priceId;

  const handleSubmit = () => {
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }
    setError("");
    onCtaClick?.();
    onSubscribe(email, tier.priceId);
  };

  const BadgeIcon = tier.badgeIcon;

  const isScout = (tier as any).scoutAccent;

  const borderClass = tier.highlight
    ? "border-primary"
    : isScout
    ? "border-emerald-500/60"
    : "border-border";

  const headerGradient = tier.highlight
    ? "bg-gradient-to-r from-primary/25 to-secondary/20"
    : isScout
    ? "bg-gradient-to-r from-emerald-600/20 to-emerald-500/10"
    : "bg-gradient-to-r from-muted/40 to-muted/20";

  const badgeBg = tier.highlight
    ? "bg-primary/20 text-primary"
    : isScout
    ? "bg-emerald-500/20 text-emerald-400"
    : "";

  const checkColor = tier.highlight
    ? "text-primary"
    : isScout
    ? "text-emerald-400"
    : "text-accent";

  const btnClass = tier.highlight
    ? "bg-primary hover:bg-primary/90 text-primary-foreground"
    : isScout
    ? "bg-emerald-500 hover:bg-emerald-400 text-black"
    : "bg-secondary hover:bg-secondary/90 text-secondary-foreground";

  return (
    <div
      className={`relative flex flex-col bg-card border-2 ${borderClass} rounded-2xl overflow-hidden shadow-lg ${
        tier.highlight ? "shadow-primary/10 scale-[1.02]" : ""
      } transition-transform`}
    >
      {tier.badge && BadgeIcon && (
        <div className="absolute top-3 right-3 z-10">
          <div
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${badgeBg}`}
          >
            <BadgeIcon className="w-3 h-3" />
            {tier.badge}
          </div>
        </div>
      )}

      <div className={`${headerGradient} px-6 py-5 text-center`}>
        <h3 className="text-2xl font-bold text-foreground font-bebas tracking-wide">
          {tier.name}
        </h3>
      </div>

      <div className="px-6 py-5 text-center border-b border-border">
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-5xl font-bold text-foreground">${tier.price}</span>
          <span className="text-muted-foreground text-sm">/month</span>
        </div>
        <p className="text-muted-foreground text-xs mt-1">
          Cancel anytime · {tier.hasTrial ? '1-day free trial' : 'No free trial'}
        </p>
      </div>

      <div className="px-6 py-5 space-y-3 flex-1">
        {tier.features.map((feature) => (
          <div key={feature} className="flex items-start gap-2.5">
            <Check className={`w-4 h-4 ${checkColor} mt-0.5 flex-shrink-0`} />
            <span className="text-sm text-foreground">{feature}</span>
          </div>
        ))}
      </div>

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
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
                className={error ? "border-destructive" : ""}
              />
              {error && <p className="text-destructive text-xs mt-1">{error}</p>}
            </div>
            <Button
              className={`w-full font-bold text-base py-5 ${btnClass}`}
              onClick={handleSubmit}
              disabled={isLoading}
            >
              {isThisLoading ? "Loading..." : tier.cta}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export function PricingSection({
  onSubscribe,
  isLoading,
  loadingPriceId,
  isSubscribed,
  onCtaClick,
}: PricingSectionProps) {
  return (
    <section className="py-12 px-4 sm:px-6" id="pricing">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-bold font-bebas tracking-wide text-foreground">
            Choose Your Edge
          </h2>
          <p className="text-muted-foreground mt-2 text-sm max-w-md mx-auto">
            AI-powered picks or live betting intelligence. Pick your lane.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
          {tiers.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              onSubscribe={onSubscribe}
              isLoading={isLoading}
              loadingPriceId={loadingPriceId}
              isSubscribed={isSubscribed}
              onCtaClick={onCtaClick}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
