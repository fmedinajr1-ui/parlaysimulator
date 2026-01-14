import React from "react";
import { HeroBanner } from "@/components/HeroBanner";
import { HowItWorks } from "@/components/HowItWorks";
import { SampleParlayButton } from "@/components/SampleParlayButton";
import { RiskEnginePicksCard } from "@/components/suggestions/RiskEnginePicksCard";
import { PropEngineV2Card } from "@/components/suggestions/PropEngineV2Card";
import { SweetSpotDreamTeamParlay } from "@/components/market/SweetSpotDreamTeamParlay";
import { PropMarketWidget } from "@/components/market/PropMarketWidget";
import { SweetSpotPicksCard } from "@/components/market/SweetSpotPicksCard";
import { SlateRefreshControls } from "@/components/market/SlateRefreshControls";
import { HeatParlaySection } from "@/components/heat/HeatParlaySection";
import { WeeklyParlayHistory } from "@/components/dashboard/WeeklyParlayHistory";
import { PullToRefreshContainer, PullToRefreshIndicator } from "@/components/ui/pull-to-refresh";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";
import { Button } from "@/components/ui/button";
import { Link, useNavigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Zap, BarChart3, Sparkles, Trophy, Calculator, GitCompare, LogIn, LogOut, Radio, Video } from "lucide-react";
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
  const { isPilotUser, isAdmin, isSubscribed, isLoading, hasEliteAccess } = usePilotUser();
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

  // Quick actions based on user type
  const quickActions = isPilotRestricted ? [
    { to: "/scout", icon: Video, label: "Scout", iconClass: "text-orange-500" },
    { to: "/live-dashboard", icon: Radio, label: "Live", iconClass: "text-destructive" },
    { to: "/upload", icon: BarChart3, label: "Analyze", iconClass: "text-primary" },
    { to: "/compare", icon: GitCompare, label: "Compare", iconClass: "text-chart-3" },
    { to: "/kelly", icon: Calculator, label: "Kelly", iconClass: "text-chart-4" },
  ] : [
    { to: "/scout", icon: Video, label: "Scout", iconClass: "text-orange-500" },
    { to: "/live-dashboard", icon: Radio, label: "Live", iconClass: "text-destructive" },
    { to: "/upload", icon: BarChart3, label: "Analyze", iconClass: "text-primary" },
    { to: "/compare", icon: GitCompare, label: "Compare", iconClass: "text-chart-3" },
    { to: "/sharp", icon: Zap, label: "Sharp Money", iconClass: "text-neon-yellow" },
    { to: "/suggestions", icon: Sparkles, label: "AI Picks", iconClass: "text-neon-purple" },
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

        {/* Auth Button */}
        <div className="flex justify-end mb-4">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleAuthAction}
            className="gap-2"
          >
            {user ? (
              <>
                <LogOut className="w-4 h-4" />
                Sign Out
              </>
            ) : (
              <>
                <LogIn className="w-4 h-4" />
                Sign In
              </>
            )}
          </Button>
        </div>

        {/* Pilot Mode Welcome Message */}
        {isPilotRestricted && (
          <div className="mb-5 p-4 rounded-lg bg-primary/10 border border-primary/20">
            <h3 className="font-semibold text-primary flex items-center gap-2">
              <Sparkles className="w-4 h-4" /> Welcome to the Pilot! 🎉
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

        {/* Slate Control - Clear & Refresh */}
        {(isPilotUser || isSubscribed || isAdmin) && (
          <div className="mb-4">
            <SlateRefreshControls />
          </div>
        )}
        
        {/* Sweet Spot Dream Team Parlay - FIRST */}
        {(isPilotUser || isSubscribed || isAdmin) && (
          <div className="mb-4">
            <SweetSpotDreamTeamParlay />
          </div>
        )}

        {/* Sweet Spot Individual Picks - SECOND */}
        {(isPilotUser || isSubscribed || isAdmin) && (
          <div className="mb-4">
            <SweetSpotPicksCard />
          </div>
        )}

        {/* Heat Engine Parlays - THIRD */}
        {(isPilotUser || isSubscribed || isAdmin) && (
          <div className="mb-4">
            <HeatParlaySection />
          </div>
        )}

        {/* NBA Risk Engine - SECOND */}
        {(isPilotUser || isSubscribed || isAdmin) && (
          <div className="mb-4">
            <RiskEnginePicksCard />
          </div>
        )}

        {/* Prop Engine v2.1 - THIRD */}
        {(isPilotUser || isSubscribed || isAdmin) && (
          <div className="mb-4">
            <PropEngineV2Card />
          </div>
        )}

        {/* Prop Heat Map - THIRD */}
        {(isPilotUser || isSubscribed || isAdmin) && (
          <div className="mb-4">
            <PropMarketWidget />
          </div>
        )}

        {/* 7-Day Performance History */}
        {(isPilotUser || isSubscribed || isAdmin) && (
          <div className="mb-4">
            <WeeklyParlayHistory />
          </div>
        )}

        <HowItWorks />
      </div>
    </AppShell>
  );
};

export default Index;
