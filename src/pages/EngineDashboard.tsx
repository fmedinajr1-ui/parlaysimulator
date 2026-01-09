import { useState } from "react";
import { useEngineDashboard } from "@/hooks/useEngineDashboard";
import { EngineStatusCard } from "@/components/dashboard/EngineStatusCard";
import { EngineActivityFeed } from "@/components/dashboard/EngineActivityFeed";
import { EngineDashboardStats } from "@/components/dashboard/EngineDashboardStats";
import { EngineComparisonView } from "@/components/dashboard/EngineComparisonView";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Target, BarChart3, Zap, Flame, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

export default function EngineDashboard() {
  const navigate = useNavigate();
  const { riskEngine, propEngineV2, sharpBuilder, heatEngine, overall, refetch } = useEngineDashboard();
  const [isScanning, setIsScanning] = useState(false);
  const [runningEngines, setRunningEngines] = useState<Record<string, boolean>>({});

  const runFullScan = async () => {
    setIsScanning(true);
    toast.info("Starting full slate scan...");

    try {
      // Step 1: Fetch fresh props
      setRunningEngines({ props: true });
      toast.info("Step 1/5: Fetching live odds...");
      await supabase.functions.invoke('unified-props-engine', {
        body: { action: 'refresh', sport: 'basketball_nba' }
      });

      // Step 2: Run risk engine
      setRunningEngines({ risk: true });
      toast.info("Step 2/5: Running NBA Risk Engine...");
      await supabase.functions.invoke('nba-player-prop-risk-engine', {
        body: { action: 'scan' }
      });

      // Step 3: Run prop engine v2
      setRunningEngines({ propv2: true });
      toast.info("Step 3/5: Running Prop Engine v2...");
      await supabase.functions.invoke('prop-engine-v2', {
        body: { action: 'analyze_all' }
      });

      // Step 4: Build sharp parlays
      setRunningEngines({ sharp: true });
      toast.info("Step 4/5: Building Sharp Parlays...");
      await supabase.functions.invoke('sharp-parlay-builder', {
        body: { action: 'build' }
      });

      // Step 5: Build heat parlays
      setRunningEngines({ heat: true });
      toast.info("Step 5/5: Building Heat Parlays...");
      await supabase.functions.invoke('heat-prop-engine', {
        body: { action: 'build' }
      });

      toast.success("Full slate scan complete!");
      refetch();
    } catch (error) {
      console.error('Full scan error:', error);
      toast.error("Scan failed. Check console for details.");
    } finally {
      setIsScanning(false);
      setRunningEngines({});
    }
  };

  const runSingleEngine = async (engineName: string, functionName: string, action: string) => {
    setRunningEngines({ [engineName]: true });
    try {
      await supabase.functions.invoke(functionName, { body: { action } });
      toast.success(`${engineName} completed`);
      refetch();
    } catch (error) {
      console.error(`${engineName} error:`, error);
      toast.error(`${engineName} failed`);
    } finally {
      setRunningEngines({});
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-background/95 backdrop-blur-lg border-b border-border/50">
        <div className="px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-foreground">Engine Command Center</h1>
              <p className="text-sm text-muted-foreground">Real-time status across all systems</p>
            </div>
            <Button
              onClick={runFullScan}
              disabled={isScanning}
              className="bg-primary hover:bg-primary/90"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Full Scan
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* System Status Bar */}
        <div className="flex items-center gap-4 p-3 rounded-xl bg-card border border-border/50">
          <span className="text-xs text-muted-foreground">Systems:</span>
          <div className="flex items-center gap-3">
            {[
              { name: "Risk Engine", active: riskEngine.isActive },
              { name: "Prop v2", active: propEngineV2.isActive },
              { name: "Sharp Builder", active: sharpBuilder.isActive },
              { name: "Heat Engine", active: heatEngine.isActive },
            ].map((engine) => (
              <div key={engine.name} className="flex items-center gap-1.5">
                <span className={cn(
                  "w-2 h-2 rounded-full",
                  engine.active ? "bg-emerald-500 animate-pulse" : "bg-red-500"
                )} />
                <span className="text-xs text-muted-foreground">{engine.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Stats */}
        <EngineDashboardStats
          totalPicks={overall.totalPicks}
          sesPicks={propEngineV2.picksToday}
          sharpParlays={sharpBuilder.parlaysToday}
          heatParlays={heatEngine.parlaysToday}
          winRate={overall.winRate7Day}
        />

        {/* Engine Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* NBA Risk Engine */}
          <EngineStatusCard
            title="NBA Risk Engine"
            icon={<Target className="w-5 h-5 text-blue-400" />}
            isActive={riskEngine.isActive}
            isRunning={runningEngines.risk}
            lastRun={riskEngine.lastRun}
            stats={[
              { label: "Picks Today", value: riskEngine.picksToday },
              { label: "Avg Confidence", value: riskEngine.avgConfidence.toFixed(1) },
            ]}
            details={
              riskEngine.roleDistribution && Object.keys(riskEngine.roleDistribution).length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground mb-1">Role Distribution:</div>
                  {Object.entries(riskEngine.roleDistribution).slice(0, 4).map(([role, count]) => (
                    <div key={role} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{role}</span>
                      <span className="text-foreground font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              )
            }
            actions={[
              { label: "Run Scan", onClick: () => runSingleEngine('risk', 'nba-player-prop-risk-engine', 'scan') },
              { label: "View All", onClick: () => navigate('/prop-market'), variant: "outline" },
            ]}
          />

          {/* Prop Engine v2 */}
          <EngineStatusCard
            title="Prop Engine v2"
            icon={<BarChart3 className="w-5 h-5 text-purple-400" />}
            isActive={propEngineV2.isActive}
            isRunning={runningEngines.propv2}
            lastRun={propEngineV2.lastRun}
            stats={[
              { label: "SES Picks", value: propEngineV2.picksToday },
              { label: "Avg SES", value: propEngineV2.avgSES?.toFixed(0) || '--' },
            ]}
            details={
              propEngineV2.decisionDistribution && Object.keys(propEngineV2.decisionDistribution).length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground mb-1">Decision Distribution:</div>
                  {Object.entries(propEngineV2.decisionDistribution).map(([decision, count]) => (
                    <div key={decision} className="flex justify-between text-xs">
                      <span className={cn(
                        decision === 'BET' ? 'text-emerald-400' :
                        decision === 'LEAN' ? 'text-amber-400' : 'text-muted-foreground'
                      )}>{decision}</span>
                      <span className="text-foreground font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              )
            }
            actions={[
              { label: "Analyze All", onClick: () => runSingleEngine('propv2', 'prop-engine-v2', 'analyze_all') },
              { label: "View All", onClick: () => navigate('/prop-market'), variant: "outline" },
            ]}
          />

          {/* Sharp Parlay Builder */}
          <EngineStatusCard
            title="Sharp Parlay Builder"
            icon={<Zap className="w-5 h-5 text-amber-400" />}
            isActive={sharpBuilder.isActive}
            isRunning={runningEngines.sharp}
            lastRun={sharpBuilder.lastRun}
            stats={[
              { label: "Parlays Today", value: sharpBuilder.parlaysToday },
              { label: "7-Day Record", value: `${sharpBuilder.weeklyRecord.wins}W-${sharpBuilder.weeklyRecord.losses}L` },
            ]}
            details={
              sharpBuilder.parlayDetails.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground mb-1">Today's Parlays:</div>
                  {sharpBuilder.parlayDetails.map((parlay, idx) => (
                    <div key={idx} className="flex justify-between text-xs">
                      <span className="text-amber-400">{parlay.type}</span>
                      <span className="text-foreground">
                        {parlay.legs} legs @ +{parlay.odds.toFixed(0)}
                      </span>
                    </div>
                  ))}
                </div>
              )
            }
            actions={[
              { label: "Build Parlays", onClick: () => runSingleEngine('sharp', 'sharp-parlay-builder', 'build') },
              { label: "History", onClick: () => navigate('/'), variant: "outline" },
            ]}
          />

          {/* Heat Engine */}
          <EngineStatusCard
            title="Heat Engine"
            icon={<Flame className="w-5 h-5 text-orange-400" />}
            isActive={heatEngine.isActive}
            isRunning={runningEngines.heat}
            lastRun={heatEngine.lastRun}
            stats={[
              { label: "Parlays Today", value: heatEngine.parlaysToday },
              { label: "7-Day Record", value: `${heatEngine.weeklyRecord.wins}W-${heatEngine.weeklyRecord.losses}L` },
            ]}
            details={
              <div className="space-y-1">
                {heatEngine.parlayDetails.length > 0 && (
                  <>
                    <div className="text-xs text-muted-foreground mb-1">Today's Parlays:</div>
                    {heatEngine.parlayDetails.map((parlay, idx) => (
                      <div key={idx} className="flex justify-between text-xs">
                        <span className="text-orange-400">{parlay.type}</span>
                        <span className="text-foreground">
                          {parlay.legs} legs
                        </span>
                      </div>
                    ))}
                  </>
                )}
                <div className="flex justify-between text-xs mt-2">
                  <span className="text-muted-foreground">Watchlist</span>
                  <span className="text-foreground">{heatEngine.watchlistCount} props</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Do Not Bet</span>
                  <span className="text-red-400">{heatEngine.doNotBetCount} props</span>
                </div>
              </div>
            }
            actions={[
              { label: "Scan & Build", onClick: () => runSingleEngine('heat', 'heat-prop-engine', 'build') },
              { label: "View All", onClick: () => navigate('/prop-market'), variant: "outline" },
            ]}
          />
        </div>

        {/* Engine Comparison View */}
        <EngineComparisonView />

        {/* Activity Feed */}
        <EngineActivityFeed />
      </div>
    </div>
  );
}
