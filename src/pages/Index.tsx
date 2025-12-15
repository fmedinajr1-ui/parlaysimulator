import React from "react";
import { HeroBanner } from "@/components/HeroBanner";
import { ExampleCarousel } from "@/components/ExampleCarousel";
import { HowItWorks } from "@/components/HowItWorks";
import { FeatureTeaser } from "@/components/FeatureTeaser";
import { SampleParlayButton } from "@/components/SampleParlayButton";
import { SuggestedParlays } from "@/components/suggestions/SuggestedParlays";
import { OddsMovementCard } from "@/components/results/OddsMovementCard";
import { CompareTeaser } from "@/components/CompareTeaser";
import { HistoricalInsights } from "@/components/suggestions/HistoricalInsights";
import { SmartBettingEdge } from "@/components/suggestions/SmartBettingEdge";
import { PullToRefreshContainer, PullToRefreshIndicator } from "@/components/ui/pull-to-refresh";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Zap, BarChart3, Sparkles, Trophy, Calculator, Lock } from "lucide-react";
import { usePilotUser } from "@/hooks/usePilotUser";

function QuickAction({ to, icon: Icon, label, iconClass }: { 
  to: string; 
  icon: React.ElementType; 
  label: string;
  iconClass?: string;
}) {
  const { lightTap } = useHapticFeedback();
  
  return (
    <Link to={to} className="shrink-0" onClick={lightTap}>
      <div className="quick-action min-w-[140px] active:scale-95 transition-transform">
        <Icon className={`w-5 h-5 ${iconClass}`} />
        <span>{label}</span>
      </div>
    </Link>
  );
}

const Index = () => {
  const { lightTap, success } = useHapticFeedback();
  const { isPilotUser, isAdmin, isSubscribed, isLoading } = usePilotUser();
  
  // Pilot users who are NOT admin and NOT subscribed get restricted view
  const isPilotRestricted = isPilotUser && !isAdmin && !isSubscribed;

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
    { to: "/upload", icon: BarChart3, label: "Analyze", iconClass: "text-primary" },
    { to: "/kelly", icon: Calculator, label: "Kelly", iconClass: "text-chart-4" },
  ] : [
    { to: "/upload", icon: BarChart3, label: "Analyze", iconClass: "text-primary" },
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

        {/* Pilot Mode Welcome Message */}
        {isPilotRestricted && (
          <div className="mb-5 p-4 rounded-lg bg-primary/10 border border-primary/20">
            <h3 className="font-semibold text-primary flex items-center gap-2">
              <Lock className="w-4 h-4" /> Pilot Mode Active
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Upload your parlays to get AI analysis. Contact admin for full access.
            </p>
          </div>
        )}
        
        {/* Quick Actions - FanDuel style horizontal scroll */}
        <div className="mb-5">
          <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4 scroll-optimized">
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

        {/* Main CTA */}
        <div className="flex flex-col items-center gap-3 mb-6">
          <Link to="/upload" className="w-full" onClick={lightTap}>
            <Button variant="neon" size="lg" className="w-full font-display text-lg tracking-wider touch-target-lg h-14 active:scale-[0.98] transition-transform">
              🎯 Analyze Your Parlay
            </Button>
          </Link>
          <SampleParlayButton />
        </div>
        
        {/* Example Cards */}
        <ExampleCarousel />

        {/* Premium Sections - Hidden for Pilot Users */}
        {!isPilotRestricted && (
          <>
            {/* Compare Parlays */}
            <CompareTeaser />

            {/* AI Suggested Parlays */}
            <div className="mb-5 content-visibility-auto">
              <SuggestedParlays />
            </div>

            {/* Historical Trends */}
            <div className="mb-5 content-visibility-auto">
              <HistoricalInsights compact />
            </div>

            {/* Smart Betting Edge */}
            <div className="mb-5 content-visibility-auto">
              <SmartBettingEdge compact />
            </div>

            {/* Live Line Movements */}
            <div className="mb-5 content-visibility-auto">
              <Link to="/sharp" className="block" onClick={lightTap}>
                <OddsMovementCard compact showSharpOnly delay={200} />
              </Link>
              <p className="text-xs text-muted-foreground text-center mt-2">
                Tap to view sharp money dashboard →
              </p>
            </div>
          </>
        )}

        <HowItWorks />
        {!isPilotRestricted && <FeatureTeaser />}
      </div>
    </AppShell>
  );
};

export default Index;
