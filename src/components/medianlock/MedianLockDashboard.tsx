import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, Lock, TrendingUp, Sparkles, AlertTriangle, Target, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MedianLockCandidateCard } from "./MedianLockCandidateCard";
import { GreenSlipCard } from "./GreenSlipCard";

interface MedianLockCandidate {
  id: string;
  player_name: string;
  team_name: string;
  prop_type: string;
  book_line: number;
  classification: 'LOCK' | 'STRONG' | 'BLOCK';
  confidence_score: number;
  hit_rate: number;
  hit_rate_last_5: number;
  median_points: number;
  median_minutes: number;
  raw_edge: number;
  adjusted_edge: number;
  defense_adjustment: number;
  split_edge: number;
  juice_lag_bonus: number;
  is_shock_flagged: boolean;
  shock_reasons: string[];
  shock_passed_validation: boolean;
  passed_checks: string[];
  failed_checks: string[];
  block_reason?: string;
  outcome?: string;
}

interface GreenSlip {
  id: string;
  slate_date: string;
  slip_type: '2-leg' | '3-leg';
  legs: Array<{ playerName: string; confidenceScore: number; status: 'LOCK' | 'STRONG' }>;
  slip_score: number;
  probability: number;
  stake_tier: 'A' | 'B' | 'C';
  outcome?: 'won' | 'lost' | 'push' | 'pending';
}

export function MedianLockDashboard() {
  const [candidates, setCandidates] = useState<MedianLockCandidate[]>([]);
  const [slips, setSlips] = useState<GreenSlip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("locks");

  const today = new Date().toISOString().split('T')[0];

  const fetchData = async () => {
    try {
      const [candidatesRes, slipsRes] = await Promise.all([
        supabase
          .from('median_lock_candidates')
          .select('*')
          .eq('slate_date', today)
          .order('confidence_score', { ascending: false }),
        supabase
          .from('median_lock_slips')
          .select('*')
          .eq('slate_date', today)
          .order('slip_score', { ascending: false }),
      ]);

      if (candidatesRes.data) {
        setCandidates(candidatesRes.data as MedianLockCandidate[]);
      }
      if (slipsRes.data) {
        setSlips(slipsRes.data as unknown as GreenSlip[]);
      }
    } catch (error) {
      console.error('Error fetching MedianLock data:', error);
    } finally {
      setLoading(false);
    }
  };

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

  useEffect(() => {
    fetchData();
  }, []);

  const locks = candidates.filter(c => c.classification === 'LOCK');
  const strongs = candidates.filter(c => c.classification === 'STRONG');
  const shockFlagged = candidates.filter(c => c.is_shock_flagged);
  const twoLegSlips = slips.filter(s => s.slip_type === '2-leg');
  const threeLegSlips = slips.filter(s => s.slip_type === '3-leg');

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
        <Button 
          onClick={runEngine} 
          disabled={refreshing}
          className="bg-gradient-to-r from-green-500 to-emerald-600"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Analyzing...' : 'Run Engine'}
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
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
        <Card className="bg-gradient-to-br from-yellow-500/10 to-yellow-600/5 border-yellow-500/20">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-yellow-400">{shockFlagged.length}</div>
            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <AlertTriangle className="h-3 w-3" /> SHOCK
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-purple-400">{twoLegSlips.length}</div>
            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Sparkles className="h-3 w-3" /> 2-Leg Slips
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-orange-500/10 to-orange-600/5 border-orange-500/20">
          <CardContent className="p-4 text-center">
            <div className="text-3xl font-bold text-orange-400">{threeLegSlips.length}</div>
            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Zap className="h-3 w-3" /> 3-Leg Slips
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="locks" className="relative">
            🔒 Locks
            {locks.length > 0 && (
              <Badge className="ml-1 h-5 px-1.5 bg-green-500/20 text-green-400">{locks.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="strong">
            💪 Strong
            {strongs.length > 0 && (
              <Badge className="ml-1 h-5 px-1.5 bg-blue-500/20 text-blue-400">{strongs.length}</Badge>
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
            {shockFlagged.length > 0 && (
              <Badge className="ml-1 h-5 px-1.5 bg-yellow-500/20 text-yellow-400">{shockFlagged.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="locks" className="mt-4">
          {locks.length === 0 ? (
            <Card className="bg-muted/30">
              <CardContent className="p-8 text-center">
                <Lock className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No locks found for today's slate</p>
                <p className="text-sm text-muted-foreground mt-1">Run the engine to analyze current props</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {locks.map((candidate) => (
                <MedianLockCandidateCard key={candidate.id} candidate={candidate} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="strong" className="mt-4">
          {strongs.length === 0 ? (
            <Card className="bg-muted/30">
              <CardContent className="p-8 text-center">
                <TrendingUp className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No strong picks found for today</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {strongs.map((candidate) => (
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
                <p className="text-sm text-muted-foreground mt-1">Run the engine to build optimal parlays</p>
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
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
          {shockFlagged.length === 0 ? (
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
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {shockFlagged.map((candidate) => (
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
