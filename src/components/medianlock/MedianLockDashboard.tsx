import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { RefreshCw, Lock, TrendingUp, Sparkles, AlertTriangle, Target, Zap, Radio, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MedianLockCandidateCard } from "./MedianLockCandidateCard";
import { GreenSlipCard } from "./GreenSlipCard";
import { useMedianLockRealtime } from "@/hooks/useMedianLockRealtime";
import { formatDistanceToNow } from "date-fns";

export function MedianLockDashboard() {
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("locks");
  const [viewMode, setViewMode] = useState<'active' | 'settled' | 'all'>('all');

  const today = new Date().toISOString().split('T')[0];
  
  const {
    loading,
    isConnected,
    lastUpdated,
    fetchData,
    activeCandidates,
    settledCandidates,
    locks,
    strongs,
    shockFlagged,
    activeLocks,
    activeStrongs,
    twoLegSlips,
    threeLegSlips,
    slips,
    stats,
  } = useMedianLockRealtime(today);

  // Auto-refresh game status every 2 minutes
  useEffect(() => {
    const syncGameStatus = async () => {
      try {
        await supabase.functions.invoke('sync-median-lock-game-status', {
          body: { trigger: 'auto' }
        });
      } catch (error) {
        console.error('Error syncing game status:', error);
      }
    };

    // Initial sync
    syncGameStatus();

    // Set up interval
    const interval = setInterval(syncGameStatus, 2 * 60 * 1000); // Every 2 minutes

    return () => clearInterval(interval);
  }, []);

  const runEngine = async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke('median-lock-engine', {
        body: { action: 'run', slateDate: today },
      });

      if (error) throw error;
      
      toast.success(`Analyzed ${data.summary?.totalCandidates || 0} candidates`);
      await fetchData();
    } catch (error) {
      console.error('Engine error:', error);
      toast.error('Failed to run MedianLock engine');
    } finally {
      setRefreshing(false);
    }
  };

  // Get filtered candidates based on view mode
  const getFilteredCandidates = (candidates: typeof locks) => {
    if (viewMode === 'active') return candidates.filter(c => c.game_status !== 'final' && c.outcome !== 'hit' && c.outcome !== 'miss');
    if (viewMode === 'settled') return candidates.filter(c => c.game_status === 'final' || c.outcome === 'hit' || c.outcome === 'miss');
    return candidates;
  };

  const filteredLocks = getFilteredCandidates(locks);
  const filteredStrongs = getFilteredCandidates(strongs);
  const filteredShockFlagged = getFilteredCandidates(shockFlagged);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Lock className="h-6 w-6 text-green-400" />
            MedianLock™ PRO
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            AI-powered prop analysis with shock detection & auto-builder
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Connection Status */}
          <div className="flex items-center gap-2 text-sm">
            <div className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'
            }`} />
            <span className="text-muted-foreground">
              {isConnected ? 'Live' : 'Connecting...'}
            </span>
            {lastUpdated && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                · {formatDistanceToNow(lastUpdated, { addSuffix: true })}
              </span>
            )}
          </div>
          <Button 
            onClick={runEngine} 
            disabled={refreshing}
            className="bg-gradient-to-r from-green-500 to-emerald-600"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Analyzing...' : 'Run Engine'}
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5 border-green-500/20">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-green-400">{locks.length}</div>
            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Lock className="h-3 w-3" /> LOCKS
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-blue-400">{strongs.length}</div>
            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <TrendingUp className="h-3 w-3" /> STRONG
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-red-500/10 to-red-600/5 border-red-500/20">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-red-400">{stats.liveGames}</div>
            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Radio className="h-3 w-3" /> LIVE
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-emerald-400">
              {stats.hitsCount}/{stats.settledCount}
            </div>
            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <CheckCircle className="h-3 w-3" /> HITS
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-purple-400">{twoLegSlips.length}</div>
            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Sparkles className="h-3 w-3" /> 2-Leg
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 border-orange-500/20">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-orange-400">{threeLegSlips.length}</div>
            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Zap className="h-3 w-3" /> 3-Leg
            </div>
          </CardContent>
        </Card>
      </div>

      {/* View Mode Toggle */}
      <div className="flex items-center gap-4">
        <span className="text-sm text-muted-foreground">Show:</span>
        <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as typeof viewMode)}>
          <ToggleGroupItem value="all" size="sm">
            All ({locks.length + strongs.length})
          </ToggleGroupItem>
          <ToggleGroupItem value="active" size="sm" className="text-green-400">
            🟢 Active ({activeCandidates.length})
          </ToggleGroupItem>
          <ToggleGroupItem value="settled" size="sm" className="text-muted-foreground">
            ✅ Settled ({settledCandidates.length})
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="locks" className="relative">
            🔒 Locks
            {filteredLocks.length > 0 && (
              <Badge className="ml-1 h-5 px-1.5 bg-green-500/20 text-green-400">{filteredLocks.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="strong">
            💪 Strong
            {filteredStrongs.length > 0 && (
              <Badge className="ml-1 h-5 px-1.5 bg-blue-500/20 text-blue-400">{filteredStrongs.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="slips">
            🎯 Green Slips
            {slips.length > 0 && (
              <Badge className="ml-1 h-5 px-1.5 bg-purple-500/20 text-purple-400">{slips.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="shock">
            ⚡ Shock Watch
            {filteredShockFlagged.length > 0 && (
              <Badge className="ml-1 h-5 px-1.5 bg-yellow-500/20 text-yellow-400">{filteredShockFlagged.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="locks" className="mt-4">
          {filteredLocks.length === 0 ? (
            <Card className="bg-muted/30">
              <CardContent className="p-8 text-center">
                <Lock className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">
                  {viewMode === 'active' ? 'No active locks' : 
                   viewMode === 'settled' ? 'No settled locks yet' : 
                   "No locks found for today's slate"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">Run the engine to analyze current props</p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              {filteredLocks.map((candidate) => (
                <MedianLockCandidateCard key={candidate.id} candidate={candidate} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="strong" className="mt-4">
          {filteredStrongs.length === 0 ? (
            <Card className="bg-muted/30">
              <CardContent className="p-8 text-center">
                <TrendingUp className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">
                  {viewMode === 'active' ? 'No active strong picks' : 
                   viewMode === 'settled' ? 'No settled strong picks yet' : 
                   'No strong picks found for today'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              {filteredStrongs.map((candidate) => (
                <MedianLockCandidateCard key={candidate.id} candidate={candidate} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="slips" className="mt-4">
          {slips.length === 0 ? (
            <Card className="bg-muted/30">
              <CardContent className="p-8 text-center">
                <Sparkles className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No Green Slips generated yet</p>
                <p className="text-sm text-muted-foreground mt-1">Generate optimal parlays from your locks & strong picks</p>
                <Button 
                  onClick={runEngine} 
                  disabled={refreshing}
                  className="mt-4 bg-gradient-to-r from-purple-500 to-pink-600"
                >
                  <Sparkles className={`h-4 w-4 mr-2 ${refreshing ? 'animate-pulse' : ''}`} />
                  {refreshing ? 'Generating...' : 'Generate Green Slips'}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {twoLegSlips.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Target className="h-5 w-5 text-purple-400" />
                    2-Leg Slips
                  </h3>
                  <div className="flex flex-col gap-4">
                    {twoLegSlips.map((slip, i) => (
                      <GreenSlipCard key={slip.id} slip={slip} rank={i + 1} />
                    ))}
                  </div>
                </div>
              )}
              {threeLegSlips.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <Zap className="h-5 w-5 text-orange-400" />
                    3-Leg Slips
                  </h3>
                  <div className="flex flex-col gap-4">
                    {threeLegSlips.map((slip, i) => (
                      <GreenSlipCard key={slip.id} slip={slip} rank={i + 1} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="shock" className="mt-4">
          {filteredShockFlagged.length === 0 ? (
            <Card className="bg-muted/30">
              <CardContent className="p-8 text-center">
                <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No shock-flagged players detected</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <Card className="bg-yellow-500/10 border-yellow-500/20">
                <CardContent className="p-4">
                  <p className="text-sm text-yellow-200">
                    <AlertTriangle className="h-4 w-4 inline mr-1" />
                    These players have detected usage/minutes/teammate shocks. Proceed with caution.
                  </p>
                </CardContent>
              </Card>
              <div className="flex flex-col gap-4">
                {filteredShockFlagged.map((candidate) => (
                  <MedianLockCandidateCard key={candidate.id} candidate={candidate} />
                ))}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
