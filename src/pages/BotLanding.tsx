import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";
import { HeroStats } from "@/components/bot-landing/HeroStats";
import { PerformanceCalendar } from "@/components/bot-landing/PerformanceCalendar";
import { PricingSection } from "@/components/bot-landing/PricingSection";
import { WolfLoadingOverlay } from "@/components/ui/wolf-loading-overlay";
import { ParlayFarmLogo } from "@/components/ParlayFarmLogo";
import { useTimeOnPage, useSectionView, useTrackClick } from "@/hooks/useAnalytics";
import { DailyWinnersShowcase } from "@/components/bot-landing/DailyWinnersShowcase";
import { FreeTrialBanner } from "@/components/bot-landing/FreeTrialBanner";
import { Link } from "react-router-dom";
import { RecentWinsFeed } from "@/components/bot-landing/RecentWinsFeed";
import { StickySubscribeCTA } from "@/components/bot-landing/StickySubscribeCTA";
import { InlineSlipGraderPromo } from "@/components/grade/InlineSlipGraderPromo";

interface PublicStats {
  days: Array<{
    date: string;
    profitLoss: number;
    won: number;
    lost: number;
    isProfitable: boolean;
  }>;
  totals: {
    totalProfit: number;
    totalWins: number;
    totalLosses: number;
    winRate: number;
    roi: number;
    daysActive: number;
    profitableDays: number;
    losingDays: number;
    bestDay: { date: string; profit: number };
    currentStreak: number;
    streakType: string;
    currentBankroll: number;
  };
}

export default function BotLanding() {
  const { user } = useAuth();
  const { hasBotAccess, isAdmin, startBotCheckout } = useSubscription();
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [loadingPriceId, setLoadingPriceId] = useState<string | undefined>(undefined);
  const [searchParams] = useSearchParams();
  const isSuccess = searchParams.get("success") === "true";

  useTimeOnPage('/bot');
  const trackClick = useTrackClick();
  const heroRef = useSectionView('hero_stats');
  const calendarRef = useSectionView('performance_calendar');
  const pricingRef = useSectionView('pricing');

  useEffect(() => {
    async function fetchStats() {
      try {
        const { data, error } = await supabase.functions.invoke('bot-public-stats');
        if (error) throw error;
        setStats(data);
      } catch (err) {
        console.error('Error fetching public stats:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  const handleCheckout = async (email: string, priceId: string) => {
    setCheckoutLoading(true);
    setLoadingPriceId(priceId);
    try {
      const { data, error } = await supabase.functions.invoke('create-bot-checkout', {
        body: { email, priceId },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error('Error starting checkout:', err);
    } finally {
      setCheckoutLoading(false);
      setLoadingPriceId(undefined);
    }
  };

  const handleCtaClick = () => {
    trackClick('cta_click', { label: 'join_now' });
  };

  const handleTelegramClick = () => {
    trackClick('cta_click', { label: 'telegram_link' });
  };

  if (loading) return <WolfLoadingOverlay />;

  const totals = stats?.totals || {
    totalProfit: 0, totalWins: 0, totalLosses: 0, winRate: 0,
    roi: 0, daysActive: 0, profitableDays: 0, losingDays: 0,
    bestDay: { date: '', profit: 0 }, currentStreak: 0, streakType: '', currentBankroll: 0,
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Logo */}
      <div className="px-4 pt-4 pb-2">
        <ParlayFarmLogo size="sm" />
      </div>

      {/* Success banner */}
      {isSuccess && (
        <div className="bg-accent/10 border border-accent/30 text-accent px-4 py-3 text-center text-sm">
          🎉 Welcome! Join the Telegram bot to get your picks:{" "}
          <a
            href="https://t.me/parlayiqbot"
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-bold"
            onClick={handleTelegramClick}
          >
            t.me/parlayiqbot
          </a>
        </div>
      )}

      {/* 1. Hero — profit machine */}
      <div ref={heroRef}>
        <HeroStats
          totalProfit={totals.totalProfit}
          totalWins={totals.totalWins}
          daysActive={totals.daysActive}
          currentStreak={totals.currentStreak}
          streakType={totals.streakType}
        />
      </div>

      {/* 2. Recent wins feed — social proof */}
      <RecentWinsFeed />

      {/* 3. CTA while they're hyped */}
      {!(hasBotAccess || isAdmin) && (
        <div id="free-trial-banner">
          <FreeTrialBanner onSubscribe={handleCheckout} isLoading={checkoutLoading} />
        </div>
      )}

      {/* 4. Daily winners showcase */}
      <DailyWinnersShowcase />

      {/* 5. Performance calendar */}
      <div ref={calendarRef}>
        <PerformanceCalendar days={stats?.days || []} hasBotAccess={hasBotAccess || isAdmin} />
      </div>

      {/* 6. Free Slip Grader — inline promo */}
      <div className="px-4 my-6">
        <InlineSlipGraderPromo />
      </div>

      {/* 7. Pricing */}
      {!(hasBotAccess || isAdmin) && (
        <div ref={pricingRef}>
          <PricingSection
            onSubscribe={handleCheckout}
            isLoading={checkoutLoading}
            loadingPriceId={loadingPriceId}
            isSubscribed={hasBotAccess}
            onCtaClick={handleCtaClick}
          />
        </div>
      )}

      {/* Sticky subscribe CTA for non-subscribers */}
      {!(hasBotAccess || isAdmin) && (
        <StickySubscribeCTA onSubscribe={handleCheckout} isLoading={checkoutLoading} />
      )}
    </div>
  );
}
