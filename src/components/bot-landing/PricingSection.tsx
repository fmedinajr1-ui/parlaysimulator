import { useState } from "react";
import { Check, Zap, Crown, TrendingUp, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PricingSectionProps {
  onSubscribe: (email: string, priceId: string) => void;
  isLoading?: boolean;
  loadingPriceId?: string;
  isSubscribed?: boolean;
  onCtaClick?: () => void;
}

const ENTRY_PRICE_ID = "price_1T1HU99D6r1PTCBBLQaWi80Z";
const PRO_PRICE_ID = "price_1T2D4I9D6r1PTCBB3kngnoRk";
const ULTIMATE_PRICE_ID = "price_1T2DD99D6r1PTCBBpcsPloWj";
const SCOUT_PRICE_ID = "price_1T2br19D6r1PTCBBfrDD4opY";

const tiers = [
  {
    id: "entry",
    priceId: ENTRY_PRICE_ID,
    name: "Entry",
    price: 99,
    badge: null,
    badgeIcon: null,
    highlight: false,
    goldAccent: false,
    fundingBadge: null,
    features: [
      "Daily AI-generated parlay picks",
      "Full parlay leg breakdowns & odds",
      "Strategy analysis & reasoning",
      "Performance calendar with P&L details",
      "Telegram bot alerts & commands",
      "Real-time live prop tracking",
    ],
    cta: "Join Entry — $99/mo",
  },
  {
    id: "pro",
    priceId: PRO_PRICE_ID,
    name: "Pro",
    price: 399,
    badge: "Most Popular",
    badgeIcon: Zap,
    highlight: true,
    goldAccent: false,
    fundingBadge: "$1,000 Funded Account",
    features: [
      "Everything in Entry",
      "$1,000 funded betting account",
      "Bot places execution-tier parlays for you",
      "70/30 profit split in your favor",
      "Execution-tier parlay access",
      "Priority Telegram picks",
    ],
    cta: "Join Pro — $399/mo",
  },
  {
    id: "ultimate",
    priceId: ULTIMATE_PRICE_ID,
    name: "Ultimate",
    price: 799,
    badge: "VIP Tier",
    badgeIcon: Crown,
    highlight: false,
    goldAccent: true,
    fundingBadge: "$5,000 Funded Account",
    features: [
      "Everything in Pro",
      "$5,000 funded betting account",
      "Bot places max-stake parlays for you",
      "80/20 profit split in your favor",
      "Personalized parlay strategy",
      "Priority 1-on-1 DM support",
    ],
    cta: "Join Ultimate — $799/mo",
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
    goldAccent: false,
    scoutAccent: true,
    fundingBadge: null,
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

  const borderClass = tier.highlight
    ? "border-primary"
    : tier.goldAccent
    ? "border-yellow-500/60"
    : (tier as any).scoutAccent
    ? "border-emerald-500/60"
    : "border-border";

  const headerGradient = tier.highlight
    ? "bg-gradient-to-r from-primary/25 to-secondary/20"
    : tier.goldAccent
    ? "bg-gradient-to-r from-yellow-600/20 to-amber-500/10"
    : (tier as any).scoutAccent
    ? "bg-gradient-to-r from-emerald-600/20 to-emerald-500/10"
    : "bg-gradient-to-r from-muted/40 to-muted/20";

  const badgeBg = tier.highlight
    ? "bg-primary/20 text-primary"
    : tier.goldAccent
    ? "bg-yellow-500/20 text-yellow-400"
    : (tier as any).scoutAccent
    ? "bg-emerald-500/20 text-emerald-400"
    : "";

  const checkColor = tier.highlight
    ? "text-primary"
    : tier.goldAccent
    ? "text-yellow-400"
    : (tier as any).scoutAccent
    ? "text-emerald-400"
    : "text-accent";

  const btnClass = tier.highlight
    ? "bg-primary hover:bg-primary/90 text-primary-foreground"
    : tier.goldAccent
    ? "bg-yellow-500 hover:bg-yellow-400 text-black"
    : (tier as any).scoutAccent
    ? "bg-emerald-500 hover:bg-emerald-400 text-black"
    : "bg-secondary hover:bg-secondary/90 text-secondary-foreground";

  return (
    <div
      className={`relative flex flex-col bg-card border-2 ${borderClass} rounded-2xl overflow-hidden shadow-lg ${
        tier.highlight ? "shadow-primary/10 scale-[1.02]" : ""
      } transition-transform`}
    >
      {/* Most Popular / VIP ribbon */}
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

      {/* Header */}
      <div className={`${headerGradient} px-6 py-5 text-center`}>
        <h3 className="text-2xl font-bold text-foreground font-bebas tracking-wide">
          {tier.name}
        </h3>

        {/* Funding badge */}
        {tier.fundingBadge && (
          <div
            className={`inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-xs font-bold ${
              tier.goldAccent
                ? "bg-yellow-500/25 text-yellow-300 border border-yellow-500/40"
                : "bg-primary/15 text-primary border border-primary/30"
            }`}
          >
            <TrendingUp className="w-3 h-3" />
            {tier.fundingBadge} — Access to Funding
          </div>
        )}
      </div>

      {/* Price */}
      <div className="px-6 py-5 text-center border-b border-border">
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-5xl font-bold text-foreground">${tier.price}</span>
          <span className="text-muted-foreground text-sm">/month</span>
        </div>
        <p className="text-muted-foreground text-xs mt-1">
          Cancel anytime · {(tier as any).hasTrial ? '1-day free trial' : 'No free trial'}
        </p>
      </div>

      {/* Features */}
      <div className="px-6 py-5 space-y-3 flex-1">
        {tier.features.map((feature) => (
          <div key={feature} className="flex items-start gap-2.5">
            <Check className={`w-4 h-4 ${checkColor} mt-0.5 flex-shrink-0`} />
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
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <h2 className="text-3xl sm:text-4xl font-bold font-bebas tracking-wide text-foreground">
            Choose Your Edge
          </h2>
          <p className="text-muted-foreground mt-2 text-sm max-w-md mx-auto">
            Start with picks. Unlock funding. Let the bot bet for you.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
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
