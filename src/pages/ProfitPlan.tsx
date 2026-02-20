import { useAdminRole } from "@/hooks/useAdminRole";
import { StakeCalculator } from "@/components/bot/StakeCalculator";
import { TierPerformanceTable } from "@/components/bot/TierPerformanceTable";
import { LegCountAudit } from "@/components/bot/LegCountAudit";
import { DailyProfitProjector } from "@/components/bot/DailyProfitProjector";
import { StakeConfigPanel } from "@/components/bot/StakeConfigPanel";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";

export default function ProfitPlan() {
  const { isAdmin } = useAdminRole();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h1 className="font-bold text-lg">Profit Maximizer</h1>
          </div>
        </div>
      </div>

      <ScrollArea className="h-[calc(100vh-57px)]">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-6 pb-6">
          {/* Summary banner */}
          <div className="rounded-2xl bg-primary/10 border border-primary/20 p-4">
            <h2 className="font-bold text-base mb-1">Smart Stake Plan</h2>
            <p className="text-sm text-muted-foreground">
              The bot is profitable (+$23,696 over 9 days). The issue is inconsistent stakes and 2-leg parlays dragging returns.
              This dashboard shows you exactly what to fix and how much more you can make.
            </p>
            <div className="grid grid-cols-3 gap-3 mt-3">
              {[
                { label: "9-Day Net", value: "+$23,696", positive: true },
                { label: "3-Leg Win Rate", value: "37.1%", positive: true },
                { label: "2-Leg Win Rate", value: "11.8%", positive: false },
              ].map((s) => (
                <div key={s.label} className="text-center">
                  <div className={`text-lg font-bold ${s.positive ? "text-primary" : "text-destructive"}`}>{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 1: Stake Calculator */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">1</div>
              <h2 className="font-semibold">Live Stake Calculator</h2>
            </div>
            <StakeCalculator />
          </div>

          {/* Section 2: Tier Performance */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">2</div>
              <h2 className="font-semibold">Tier Performance Breakdown</h2>
            </div>
            <TierPerformanceTable />
          </div>

          {/* Section 3: Leg Count Audit */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">3</div>
              <h2 className="font-semibold">Leg Count Audit</h2>
            </div>
            <LegCountAudit />
          </div>

          {/* Section 4: Daily Profit Projector */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">4</div>
              <h2 className="font-semibold">Daily Profit Projector</h2>
            </div>
            <DailyProfitProjector />
          </div>

          {/* Section 5: Stake Override (admin only) */}
          {isAdmin && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">5</div>
                <h2 className="font-semibold">Stake Override Panel</h2>
                <span className="text-xs bg-muted text-muted-foreground rounded-full px-2 py-0.5">Admin</span>
              </div>
              <StakeConfigPanel />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
