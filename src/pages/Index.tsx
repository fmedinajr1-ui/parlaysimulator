import React from "react";
import { HeroBanner } from "@/components/HeroBanner";
import { HowItWorks } from "@/components/HowItWorks";
import { SampleParlayButton } from "@/components/SampleParlayButton";
import { SlateRefreshControls } from "@/components/market/SlateRefreshControls";
import { DailyParlayHub } from "@/components/parlays/DailyParlayHub";
import { SweetSpotPicksCard } from "@/components/market/SweetSpotPicksCard";
import { WeeklyParlayHistory } from "@/components/dashboard/WeeklyParlayHistory";
import { Elite3PTFixedParlay } from "@/components/market/Elite3PTFixedParlay";
import { WhenWeWinBig } from "@/components/WhenWeWinBig";
import { PullToRefreshContainer, PullToRefreshIndicator } from "@/components/ui/pull-to-refresh";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";
import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { BarChart3, GitCompare, LogIn, LogOut, Radio, Video, Trophy } from "lucide-react";
import { usePilotUser } from "@/hooks/usePilotUser";
import { useAuth } from "@/contexts/AuthContext";

function QuickAction({ to, icon: Icon, label, iconClass }: {
  to: string; 
  icon: React.ElementType; 
  label: string;
  iconClass?: string;
}) {
  const { lightTap } = useHapticFeedback();
  
  return (
    <Link to={to} className="shrink-0" onClick={lightTap}>
      <div className="quick-action min-w-[100px] sm:min-w-[120px] active:scale-95 transition-transform">
        <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${iconClass}`} />
        <span className="text-xs sm:text-sm">{label}</span>
      </div>
    </Link>
  );
}

const Index = () => {
  const { lightTap, success } = useHapticFeedback();
  const { isPilotUser, isAdmin, isSubscribed, isLoading } = usePilotUser();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  
  // Pilot users who are NOT admin and NOT subscribed get restricted view
  const isPilotRestricted = isPilotUser && !isAdmin && !isSubscribed;

  const handleAuthAction = async () => {
    lightTap();
    if (user) {
      await signOut();
      navigate('/', { replace: true });
    } else {
      navigate('/auth');
    }
  };

  const handleRefresh = React.useCallback(async () => {
    await new Promise(resolve => setTimeout(resolve, 1000));
    success();
  }, [success]);

  const { isRefreshing, pullProgress, containerRef, handlers } = usePullToRefresh({
    onRefresh: handleRefresh,
    threshold: 80,
  });

  // Reduced quick actions - 5 key tools
  const quickActions = [
    { to: "/scout", icon: Video, label: "Scout", iconClass: "text-orange-500" },
    { to: "/live-dashboard", icon: Radio, label: "Live", iconClass: "text-destructive" },
    { to: "/upload", icon: BarChart3, label: "Analyze", iconClass: "text-primary" },
    { to: "/compare", icon: GitCompare, label: "Compare", iconClass: "text-chart-3" },
    { to: "/best-bets", icon: Trophy, label: "Best Bets", iconClass: "text-chart-4" },
  ];

  return (
    <AppShell className="pt-safe">
      <PullToRefreshIndicator 
        pullProgress={pullProgress} 
        isRefreshing={isRefreshing} 
        threshold={80} 
      />
      
      <div 
        ref={containerRef}
        {...handlers}
        className="scroll-optimized"
        style={{ transform: `translateY(${Math.min(pullProgress * 0.5, 40)}px)` }}
      >
        <HeroBanner />

        {/* Auth Button - Sign Out only (login removed) */}
        {user && (
          <div className="flex justify-end mb-4">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleAuthAction}
              className="gap-2"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </Button>
          </div>
        )}

        {/* Pilot Mode Welcome Message */}
        {isPilotRestricted && (
          <div className="mb-5 p-4 rounded-lg bg-primary/10 border border-primary/20">
            <h3 className="font-semibold text-primary flex items-center gap-2">
              🎉 Welcome to the Pilot!
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              You have access to Analyze, Compare, and Kelly tools. More features coming soon!
            </p>
          </div>
        )}
        
        {/* Quick Actions - Compact horizontal scroll */}
        <div className="mb-4">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4 scroll-optimized">
            {quickActions.map((action) => (
              <QuickAction 
                key={action.to}
                to={action.to} 
                icon={action.icon} 
                label={action.label} 
                iconClass={action.iconClass} 
              />
            ))}
          </div>
        </div>

        {/* Main CTA - Side by Side */}
        <div className="flex items-center gap-4 mb-4">
          <Link to="/upload" className="flex-1" onClick={lightTap}>
            <Button variant="neon" size="lg" className="w-full font-display text-base sm:text-lg tracking-wider touch-target-lg h-12 active:scale-[0.98] transition-transform">
              🎯 Analyze Your Parlay
            </Button>
          </Link>
          <SampleParlayButton />
        </div>

        {/* Slate Control - Unified Refresh All Engines */}
        <div className="mb-4">
          <SlateRefreshControls />
        </div>
        
        {/* ★ ELITE 3PT FIXED PARLAY - Today's 100% L10 Picks ★ */}
        <div className="mb-4">
          <Elite3PTFixedParlay />
        </div>

        {/* 🔥 WHEN WE WIN, WE WIN BIG — Payout Preview */}
        <div className="mb-4">
          <WhenWeWinBig />
        </div>

        {/* ★ DAILY PARLAY HUB - Primary Content ★ */}
        <div className="mb-4">
          <DailyParlayHub />
        </div>

        {/* Sweet Spot Individual Picks */}
        <div className="mb-4">
          <SweetSpotPicksCard />
        </div>

        {/* 7-Day Performance History */}
        <div className="mb-4">
          <WeeklyParlayHistory />
        </div>

        <HowItWorks />
      </div>
    </AppShell>
  );
};

export default Index;
