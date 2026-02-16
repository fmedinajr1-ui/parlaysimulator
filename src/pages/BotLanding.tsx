import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";
import { HeroStats } from "@/components/bot-landing/HeroStats";
import { PerformanceCalendar } from "@/components/bot-landing/PerformanceCalendar";
import { PricingCard } from "@/components/bot-landing/PricingCard";
import { WhyMultipleParlays } from "@/components/bot-landing/WhyMultipleParlays";
import { WolfLoadingOverlay } from "@/components/ui/wolf-loading-overlay";
import { ParlayFarmLogo } from "@/components/ParlayFarmLogo";

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
  const [searchParams] = useSearchParams();
  const isSuccess = searchParams.get("success") === "true";

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

  const handleCheckout = async (email: string) => {
    setCheckoutLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-bot-checkout', {
        body: { email },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error('Error starting checkout:', err);
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (loading) return <WolfLoadingOverlay />;

  const totals = stats?.totals || {
    totalProfit: 0, totalWins: 0, totalLosses: 0, winRate: 0,
    roi: 0, daysActive: 0, profitableDays: 0, losingDays: 0,
    bestDay: { date: '', profit: 0 }, currentStreak: 0, streakType: '', currentBankroll: 0,
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Navigation */}
      <nav className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border">
        <ParlayFarmLogo size="sm" />
        {user && isAdmin && (
          <a href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
            Admin Dashboard →
          </a>
        )}
      </nav>

      {/* Success banner */}
      {isSuccess && (
        <div className="bg-accent/10 border border-accent/30 text-accent px-4 py-3 text-center text-sm">
          🎉 Welcome! Join the Telegram bot to get your picks:{" "}
          <a href="https://t.me/parlayiqbot" target="_blank" rel="noopener noreferrer" className="underline font-bold">
            t.me/parlayiqbot
          </a>
        </div>
      )}

      <HeroStats
        totalProfit={totals.totalProfit}
        totalWins={totals.totalWins}
      />

      <PerformanceCalendar
        days={stats?.days || []}
        hasBotAccess={hasBotAccess || isAdmin}
      />

      <WhyMultipleParlays />

      {!(hasBotAccess || isAdmin) && (
        <PricingCard
          onSubscribe={handleCheckout}
          isLoading={checkoutLoading}
          isSubscribed={hasBotAccess}
        />
      )}
    </div>
  );
}
