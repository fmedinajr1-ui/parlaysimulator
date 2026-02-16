import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";
import { HeroStats } from "@/components/bot-landing/HeroStats";
import { PerformanceCalendar } from "@/components/bot-landing/PerformanceCalendar";
import { PricingCard } from "@/components/bot-landing/PricingCard";
import { WhyMultipleParlays } from "@/components/bot-landing/WhyMultipleParlays";
import { WolfLoadingOverlay } from "@/components/ui/wolf-loading-overlay";

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
        <span className="font-bebas text-xl tracking-wider text-foreground">🐺 Parlay Wolf</span>
        {!user && (
          <a href="/auth" className="text-sm text-primary hover:underline">
            Sign In
          </a>
        )}
        {user && isAdmin && (
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground">
            Admin Dashboard →
          </a>
        )}
      </nav>

      <HeroStats
        totalProfit={totals.totalProfit}
        winRate={totals.winRate}
        daysActive={totals.daysActive}
        totalWins={totals.totalWins}
        totalLosses={totals.totalLosses}
      />

      <PerformanceCalendar
        days={stats?.days || []}
        hasBotAccess={hasBotAccess || isAdmin}
      />

      <WhyMultipleParlays />

      {!(hasBotAccess || isAdmin) && (
        <PricingCard
          onSubscribe={startBotCheckout}
          isSubscribed={hasBotAccess}
        />
      )}
    </div>
  );
}
