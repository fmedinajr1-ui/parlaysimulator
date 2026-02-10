import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getEasternDate } from '@/lib/dateUtils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  Brain, 
  Zap, 
  TrendingUp, 
  Target, 
  RefreshCw, 
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  BarChart3,
  Layers,
  Activity,
  Sparkles,
  PlayCircle,
  History,
  AlertCircle,
  Download,
  Trash2,
  FileJson,
  FileSpreadsheet,
  ShieldCheck,
  Database
} from 'lucide-react';
import { AIProgressGauge } from './AIProgressGauge';
import { AILearnedPatterns } from './AILearnedPatterns';
import { AILearningInsights } from './AILearningInsights';
import { ManualStatsEntry } from './ManualStatsEntry';
import { Json } from '@/integrations/supabase/types';

interface AIGeneratedParlay {
  id: string;
  generation_round: number;
  strategy_used: string;
  signals_used: string[];
  legs: Json;
  total_odds: number;
  confidence_score: number;
  outcome: string;
  created_at: string;
  settled_at: string | null;
  ai_reasoning: string | null;
  accuracy_at_generation: number | null;
  formula_breakdown: Json;
  source_engines: string[];
  leg_sources: Json;
  sport: string | null;
}

interface AILearningProgress {
  id: string;
  generation_round: number;
  parlays_generated: number;
  parlays_settled: number;
  wins: number;
  losses: number;
  current_accuracy: number;
  target_accuracy: number;
  strategy_weights: Json;
  learned_patterns: Json;
  is_milestone: boolean;
  milestone_reached: string | null;
  created_at: string;
}

interface FormulaPerformance {
  id: string;
  formula_name: string;
  engine_source: string;
  total_picks: number;
  wins: number;
  losses: number;
  current_accuracy: number;
  current_weight: number;
  last_win_streak: number;
  last_loss_streak: number;
  sport_breakdown: Json;
  compound_formulas: Json;
}

interface SettlementJob {
  id: string;
  job_name: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  result: Json;
}

interface LegResult {
  legIndex: number;
  description: string;
  outcome: 'won' | 'lost' | 'pending' | 'push';
  settlementMethod: string;
  actualValue?: number;
  line?: number;
  score?: { home: number; away: number };
  dataSource?: string;
}

interface SettledParlayDetail {
  id: string;
  outcome: string;
  totalOdds: number;
  legs: LegResult[];
  strategy: string;
}

interface LearningResults {
  weights_updated?: { weights_updated: number };
  avoid_patterns?: { patterns_updated: number; patterns_deactivated: number };
  compound_formulas?: { formulas_updated: number };
  cross_engine?: { comparisons_updated: number };
  sync_results?: { wins: number; losses: number; accuracy: number; winning_patterns: number; losing_patterns: number };
}

interface SettlementProgress {
  isRunning: boolean;
  status: string;
  settled: number;
  won: number;
  lost: number;
  stillPending: number;
  settledDetails: SettledParlayDetail[];
  learningResults?: LearningResults;
}

interface VerificationResult {
  parlayId: string;
  originalOutcome: string;
  verifiedOutcome: string | null;
  isCorrect: boolean;
  reason: string;
  legDetails: Array<{
    description: string;
    originalResult: string;
    verifiedResult: string | null;
    statsDate: string | null;
    gameDate: string | null;
    hasValidStats: boolean;
  }>;
}

interface VerificationSummary {
  totalVerified: number;
  correctlySettled: number;
  incorrectlySettled: number;
  unverifiable: number;
  accuracyRate: string;
  latestStatsAvailable: {
    nba: string;
    nfl: string;
    nhl: string;
  };
  pendingAnalysis?: {
    total: number;
    missingStats: number;
    gameNotStarted: number;
    readyToSettle: number;
    missingStatsDetails?: Array<{ player: string; gameDate: string; sport: string }>;
  };
}

export function AIGenerativeProgressDashboard() {
  const [parlays, setParlays] = useState<AIGeneratedParlay[]>([]);
  const [learningProgress, setLearningProgress] = useState<AILearningProgress | null>(null);
  const [formulaPerformance, setFormulaPerformance] = useState<FormulaPerformance[]>([]);
  const [settlementJobs, setSettlementJobs] = useState<SettlementJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLearning, setIsLearning] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'won' | 'lost'>('all');
  const [settlementProgress, setSettlementProgress] = useState<SettlementProgress | null>(null);
  const [staleParlays, setStaleParlays] = useState(0);
  const [isPurging, setIsPurging] = useState(false);
  const [pendingBreakdown, setPendingBreakdown] = useState<{
    scheduled: number;
    inProgress: number;
    mixed: number;
    readyToSettle: number;
  }>({ scheduled: 0, inProgress: 0, mixed: 0, readyToSettle: 0 });
  const [dataFreshness, setDataFreshness] = useState<{
    nba: string;
    nfl: string;
    nhl: string;
    isStale: boolean;
  }>({ nba: '', nfl: '', nhl: '', isStale: false });
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResults, setVerificationResults] = useState<{
    summary: VerificationSummary;
    results: VerificationResult[];
  } | null>(null);
  const [isRefreshingStats, setIsRefreshingStats] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<string>('');
  const [isAnalyzingPending, setIsAnalyzingPending] = useState(false);
  const [pendingAnalysisResults, setPendingAnalysisResults] = useState<VerificationSummary | null>(null);

  useEffect(() => {
    fetchData();
    fetchStaleCount();
    fetchPendingBreakdown();
    fetchDataFreshness();
    
    const parlayChannel = supabase
      .channel('ai_parlays_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_generated_parlays' }, fetchData)
      .subscribe();

    const progressChannel = supabase
      .channel('ai_progress_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_learning_progress' }, fetchData)
      .subscribe();

    const formulaChannel = supabase
      .channel('formula_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_formula_performance' }, fetchData)
      .subscribe();

    return () => {
      supabase.removeChannel(parlayChannel);
      supabase.removeChannel(progressChannel);
      supabase.removeChannel(formulaChannel);
    };
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    
    // Fetch parlays by outcome type to ensure won/lost are always visible
    const [pendingRes, wonRes, lostRes, expiredRes, progressRes, formulaRes, settlementRes] = await Promise.all([
      supabase
        .from('ai_generated_parlays')
        .select('*')
        .eq('outcome', 'pending')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('ai_generated_parlays')
        .select('*')
        .eq('outcome', 'won')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('ai_generated_parlays')
        .select('*')
        .eq('outcome', 'lost')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('ai_generated_parlays')
        .select('*')
        .eq('outcome', 'expired')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('ai_learning_progress')
        .select('*')
        .order('generation_round', { ascending: false })
        .limit(1),
      supabase
        .from('ai_formula_performance')
        .select('*')
        .order('current_accuracy', { ascending: false }),
      supabase
        .from('cron_job_history')
        .select('*')
        .eq('job_name', 'auto-settle-ai-parlays')
        .order('started_at', { ascending: false })
        .limit(10)
    ]);

    // Combine all parlays and sort by created_at
    const allParlays = [
      ...(pendingRes.data || []),
      ...(wonRes.data || []),
      ...(lostRes.data || []),
      ...(expiredRes.data || [])
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setParlays(allParlays as AIGeneratedParlay[]);
    if (progressRes.data && progressRes.data.length > 0) setLearningProgress(progressRes.data[0] as AILearningProgress);
    if (formulaRes.data) setFormulaPerformance(formulaRes.data as FormulaPerformance[]);
    if (settlementRes.data) setSettlementJobs(settlementRes.data as SettlementJob[]);
    
    setIsLoading(false);
  };

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-continuous-parlay-generator');
      if (error) throw error;
      toast.success(`Generated ${data?.parlays_generated || 0} parlays across all sports!`);
      fetchData();
    } catch (error) {
      toast.error('Generation failed: ' + (error as Error).message);
    }
    setIsGenerating(false);
  };

  const handleRunLearningCycle = async () => {
    setIsLearning(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-learning-engine', {
        body: { action: 'full_learning_cycle' }
      });
      if (error) throw error;
      toast.success(`Learning cycle complete! ${data?.weights_updated?.weights_updated || 0} weights updated.`);
      fetchData();
    } catch (error) {
      toast.error('Learning cycle failed: ' + (error as Error).message);
    }
    setIsLearning(false);
  };

  const handleSyncLearningProgress = async () => {
    setIsSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('ai-learning-engine', {
        body: { action: 'sync_learning_progress' }
      });
      if (error) throw error;
      toast.success(`Synced ${data?.wins || 0}W-${data?.losses || 0}L (${data?.accuracy || 0}%) • ${data?.winning_patterns || 0} winning patterns, ${data?.losing_patterns || 0} losing patterns`);
      fetchData();
    } catch (error) {
      toast.error('Sync failed: ' + (error as Error).message);
    }
    setIsSyncing(false);
  };

  const handleRunSettlement = async (force: boolean = false, autoSync: boolean = false) => {
    setIsSettling(true);
    setSettlementProgress({
      isRunning: true,
      status: force ? 'Force settling all pending parlays...' : 'Settling parlays (4hr+ old)...',
      settled: 0,
      won: 0,
      lost: 0,
      stillPending: 0,
      settledDetails: []
    });
    
    try {
      const { data, error } = await supabase.functions.invoke('auto-settle-ai-parlays', {
        body: { force }
      });
      
      if (error) throw error;
      
      let learningResults = data?.learningResults as LearningResults | undefined;
      
      // If autoSync is enabled, also run sync to update learning progress
      if (autoSync && (data?.settled || 0) > 0) {
        setSettlementProgress(prev => prev ? { ...prev, status: 'Syncing learning progress...' } : null);
        const { data: syncData } = await supabase.functions.invoke('ai-learning-engine', {
          body: { action: 'sync_learning_progress' }
        });
        if (syncData) {
          learningResults = {
            ...learningResults,
            sync_results: syncData
          };
        }
      }
      
      setSettlementProgress({
        isRunning: false,
        status: 'Complete',
        settled: data?.settled || 0,
        won: data?.won || 0,
        lost: data?.lost || 0,
        stillPending: data?.stillPending || 0,
        settledDetails: data?.settledDetails || [],
        learningResults
      });
      
      // Build combined toast message
      const settlementMsg = `${data?.settled || 0} parlays (${data?.won || 0}W/${data?.lost || 0}L)`;
      const learningMsg = learningResults 
        ? ` • ${learningResults.weights_updated?.weights_updated || 0} weights • ${learningResults.avoid_patterns?.patterns_updated || 0} patterns`
        : '';
      const syncMsg = autoSync && learningResults?.sync_results ? ` • Synced ${learningResults.sync_results.wins}W-${learningResults.sync_results.losses}L` : '';
      
      toast.success(`Settled ${settlementMsg}${learningMsg}${syncMsg}`);
      fetchData();
    } catch (error) {
      setSettlementProgress(null);
      toast.error('Settlement failed: ' + (error as Error).message);
    }
    setIsSettling(false);
  };

  // Fetch count of stale parlays (>48 hours old, still pending)
  const fetchStaleCount = async () => {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('ai_generated_parlays')
      .select('*', { count: 'exact', head: true })
      .eq('outcome', 'pending')
      .lt('created_at', cutoff);
    setStaleParlays(count || 0);
  };

  // Fetch pending parlays breakdown by game status
  const fetchPendingBreakdown = async () => {
    const { data: pendingParlays } = await supabase
      .from('ai_generated_parlays')
      .select('id, legs, created_at')
      .eq('outcome', 'pending');

    if (!pendingParlays) return;

    const now = new Date();
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    
    let scheduled = 0;
    let inProgress = 0;
    let mixed = 0;
    let readyToSettle = 0;

    pendingParlays.forEach(parlay => {
      const legs = parlay.legs as any[];
      if (!Array.isArray(legs) || legs.length === 0) return;

      let allScheduled = true;
      let allCompleted = true;
      let anyInProgress = false;

      legs.forEach(leg => {
        const commenceTime = new Date(leg.commence_time || leg.commenceTime || parlay.created_at);
        const gameEndEstimate = new Date(commenceTime.getTime() + 3 * 60 * 60 * 1000); // ~3 hours for game

        if (commenceTime > now) {
          // Game hasn't started
          allCompleted = false;
        } else if (now < gameEndEstimate) {
          // Game likely in progress
          allScheduled = false;
          allCompleted = false;
          anyInProgress = true;
        } else {
          // Game likely completed
          allScheduled = false;
        }
      });

      if (allScheduled) {
        scheduled++;
      } else if (allCompleted) {
        readyToSettle++;
      } else if (anyInProgress && !allScheduled) {
        inProgress++;
      } else {
        mixed++;
      }
    });

    setPendingBreakdown({ scheduled, inProgress, mixed, readyToSettle });
  };

  // Fetch data freshness for player stats tables
  const fetchDataFreshness = async () => {
    const today = getEasternDate();
    
    const [nbaRes, nflRes, nhlRes] = await Promise.all([
      supabase.from('nba_player_game_logs').select('game_date').order('game_date', { ascending: false }).limit(1),
      supabase.from('nfl_player_game_logs').select('game_date').order('game_date', { ascending: false }).limit(1),
      supabase.from('nhl_player_game_logs').select('game_date').order('game_date', { ascending: false }).limit(1)
    ]);
    
    const nba = nbaRes.data?.[0]?.game_date || 'none';
    const nfl = nflRes.data?.[0]?.game_date || 'none';
    const nhl = nhlRes.data?.[0]?.game_date || 'none';
    
    // Check if any data is stale (older than today)
    const isStale = (nba !== 'none' && nba < today) || (nfl !== 'none' && nfl < today) || (nhl !== 'none' && nhl < today);
    
    setDataFreshness({ nba, nfl, nhl, isStale });
  };

  // Purge stale parlays by marking them as 'expired'
  const handlePurgeStaleParlays = async () => {
    setIsPurging(true);
    try {
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      
      const { data, error } = await supabase
        .from('ai_generated_parlays')
        .update({ 
          outcome: 'expired',
          settled_at: new Date().toISOString(),
          ai_reasoning: 'Marked as expired - unable to settle after 48 hours'
        })
        .eq('outcome', 'pending')
        .lt('created_at', cutoff)
        .select('id');
      
      if (error) throw error;
      
      toast.success(`Purged ${data?.length || 0} stale parlays (marked as expired)`);
      fetchData();
      fetchStaleCount();
    } catch (error) {
      toast.error('Failed to purge: ' + (error as Error).message);
    }
    setIsPurging(false);
  };

  // Verify all settled parlays
  const handleVerifySettlements = async () => {
    setIsVerifying(true);
    setVerificationResults(null);
    try {
      const { data, error } = await supabase.functions.invoke('verify-ai-parlay-settlements', {
        body: { include_pending: false }
      });
      if (error) throw error;
      
      if (data?.success) {
        setVerificationResults({
          summary: data.summary,
          results: data.results
        });
        toast.success(
          `Verified ${data.summary.totalVerified} parlays: ${data.summary.correctlySettled} correct, ${data.summary.incorrectlySettled} incorrect`
        );
      } else {
        throw new Error(data?.error || 'Verification failed');
      }
    } catch (error) {
      toast.error('Verification failed: ' + (error as Error).message);
    }
    setIsVerifying(false);
  };

  // Analyze pending parlays to see which are ready to settle
  const handleAnalyzePending = async () => {
    setIsAnalyzingPending(true);
    setPendingAnalysisResults(null);
    try {
      const { data, error } = await supabase.functions.invoke('verify-ai-parlay-settlements', {
        body: { include_pending: true, limit: 300 }
      });
      if (error) throw error;
      
      if (data?.success && data.summary?.pendingAnalysis) {
        setPendingAnalysisResults(data.summary);
        const pa = data.summary.pendingAnalysis;
        toast.success(
          `Analyzed ${pa.total} pending: ${pa.readyToSettle} ready to settle, ${pa.missingStats} missing stats`
        );
      } else {
        throw new Error(data?.error || 'Analysis failed');
      }
    } catch (error) {
      toast.error('Analysis failed: ' + (error as Error).message);
    }
    setIsAnalyzingPending(false);
  };

  // Refresh stats and then settle parlays
  const handleRefreshAndSettle = async () => {
    setIsRefreshingStats(true);
    setRefreshProgress('Fetching fresh NBA stats...');
    
    try {
      // Step 1: Fetch fresh NBA stats
      const { data: nbaData, error: nbaError } = await supabase.functions.invoke('nba-stats-fetcher', {
        body: { mode: 'sync' }
      });
      
      if (nbaError) {
        console.error('NBA stats error:', nbaError);
        toast.error('NBA stats fetch failed, continuing with settlement...');
      } else {
        toast.success(`NBA: ${nbaData?.results?.statsInserted || 0} stats updated`);
      }
      
      setRefreshProgress('Stats refreshed! Running settlement...');
      
      // Step 2: Run settlement with force mode
      const { data: settleData, error: settleError } = await supabase.functions.invoke('auto-settle-ai-parlays', {
        body: { force: true }
      });
      
      if (settleError) throw settleError;
      
      // Step 3: Sync learning progress
      setRefreshProgress('Syncing learning progress...');
      const { data: syncData } = await supabase.functions.invoke('ai-learning-engine', {
        body: { action: 'sync_learning_progress' }
      });
      
      const learningResults: LearningResults = {
        ...settleData?.learningResults,
        sync_results: syncData
      };
      
      setSettlementProgress({
        isRunning: false,
        status: 'Complete',
        settled: settleData?.settled || 0,
        won: settleData?.won || 0,
        lost: settleData?.lost || 0,
        stillPending: settleData?.stillPending || 0,
        settledDetails: settleData?.settledDetails || [],
        learningResults
      });
      
      toast.success(
        `Refreshed & Settled ${settleData?.settled || 0} parlays (${settleData?.won || 0}W/${settleData?.lost || 0}L)`
      );
      
      fetchData();
      fetchDataFreshness();
      fetchPendingBreakdown();
      
    } catch (error) {
      toast.error('Refresh & Settle failed: ' + (error as Error).message);
    }
    
    setRefreshProgress('');
    setIsRefreshingStats(false);
  };

  // Export helper functions
  const convertToCSV = (data: any[]) => {
    if (data.length === 0) return '';
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(row => 
      Object.values(row).map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    );
    return [headers, ...rows].join('\n');
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCSV = () => {
    const exportData = parlays.map(p => ({
      id: p.id,
      round: p.generation_round,
      strategy: p.strategy_used,
      sport: p.sport || 'unknown',
      engines: (p.source_engines || []).join(' | '),
      legs: Array.isArray(p.legs) ? (p.legs as any[]).map((l: any) => l.description || l.player || '').join(' | ') : '',
      total_odds: p.total_odds,
      confidence: p.confidence_score,
      outcome: p.outcome,
      created_at: p.created_at,
      settled_at: p.settled_at || ''
    }));
    
    const csv = convertToCSV(exportData);
    downloadFile(csv, `ai-parlays-export-${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
    toast.success(`Exported ${exportData.length} parlays to CSV`);
  };

  const handleExportJSON = () => {
    const exportPayload = {
      exportedAt: new Date().toISOString(),
      summary: {
        totalParlays: parlays.length,
        pending: stats.pending,
        won: stats.won,
        lost: stats.lost,
        winRate: parseFloat(winRate),
        sportDistribution,
        engineContribution,
        currentRound: learningProgress?.generation_round || 0,
        targetAccuracy: learningProgress?.target_accuracy || 65
      },
      parlays: parlays,
      formulas: formulaPerformance
    };
    
    const json = JSON.stringify(exportPayload, null, 2);
    downloadFile(json, `ai-parlays-full-export-${new Date().toISOString().split('T')[0]}.json`, 'application/json');
    toast.success(`Exported full dataset to JSON`);
  };

  const filteredParlays = parlays.filter(p => {
    if (filter === 'all') return true;
    return p.outcome === filter;
  });

  const stats = {
    total: parlays.length,
    pending: parlays.filter(p => p.outcome === 'pending').length,
    won: parlays.filter(p => p.outcome === 'won').length,
    lost: parlays.filter(p => p.outcome === 'lost').length,
  };

  const winRate = stats.won + stats.lost > 0 
    ? ((stats.won / (stats.won + stats.lost)) * 100).toFixed(1)
    : '0.0';

  // Calculate sport distribution
  const sportDistribution: Record<string, number> = {};
  parlays.forEach(p => {
    const sport = p.sport || 'unknown';
    sportDistribution[sport] = (sportDistribution[sport] || 0) + 1;
  });

  // Calculate engine contribution
  const engineContribution: Record<string, { total: number; wins: number }> = {};
  parlays.forEach(p => {
    (p.source_engines || []).forEach(engine => {
      if (!engineContribution[engine]) {
        engineContribution[engine] = { total: 0, wins: 0 };
      }
      engineContribution[engine].total++;
      if (p.outcome === 'won') {
        engineContribution[engine].wins++;
      }
    });
  });

  // Get last settlement info
  const lastSettlement = settlementJobs[0];
  const lastSettlementResult = lastSettlement?.result as any;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Progress */}
      <Card className="bg-gradient-to-br from-cyan-500/10 to-purple-500/10 border-cyan-500/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-cyan-500/20">
                <Brain className="w-6 h-6 text-cyan-500" />
              </div>
              <div>
                <CardTitle className="text-xl">AI Parlay Training System</CardTitle>
                <p className="text-sm text-muted-foreground">
                  50+ daily parlays • Auto-learning • Auto-settlement
                </p>
              </div>
            </div>
            <Badge variant={learningProgress?.is_milestone ? 'default' : 'secondary'}>
              Round #{learningProgress?.generation_round || 0}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            <AIProgressGauge 
              currentAccuracy={learningProgress?.current_accuracy || 0}
              targetAccuracy={learningProgress?.target_accuracy || 65}
              winRate={parseFloat(winRate)}
            />
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-background/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">Generated</p>
                </div>
                <div className="bg-background/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-cyan-500">{winRate}%</p>
                  <p className="text-xs text-muted-foreground">Win Rate</p>
                </div>
                <div className="bg-background/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-500">{stats.won}</p>
                  <p className="text-xs text-muted-foreground">Wins</p>
                </div>
                <div className="bg-background/50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-500">{stats.lost}</p>
                  <p className="text-xs text-muted-foreground">Losses</p>
                </div>
              </div>

              {/* Data Freshness Warning */}
              {dataFreshness.isStale && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-yellow-500">
                      <AlertCircle className="w-4 h-4" />
                      <span className="text-sm font-medium">Stale Player Stats</span>
                    </div>
                    <Button
                      onClick={handleRefreshAndSettle}
                      disabled={isRefreshingStats}
                      size="sm"
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {isRefreshingStats ? (
                        <>
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                          {refreshProgress || 'Refreshing...'}
                        </>
                      ) : (
                        <>
                          <Download className="w-3 h-3 mr-1" />
                          Refresh & Settle
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                    <div className={dataFreshness.nba < new Date().toISOString().split('T')[0] ? 'text-yellow-500' : 'text-green-500'}>
                      NBA: {dataFreshness.nba}
                    </div>
                    <div className={dataFreshness.nfl < new Date().toISOString().split('T')[0] ? 'text-yellow-500' : 'text-green-500'}>
                      NFL: {dataFreshness.nfl}
                    </div>
                    <div className={dataFreshness.nhl < new Date().toISOString().split('T')[0] ? 'text-yellow-500' : 'text-green-500'}>
                      NHL: {dataFreshness.nhl}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleGenerate} disabled={isGenerating} className="bg-cyan-600 hover:bg-cyan-700">
                  {isGenerating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
                  Generate
                </Button>
                <Button 
                  onClick={() => handleRunSettlement(true, true)} 
                  disabled={isSettling} 
                  className="bg-gradient-to-r from-orange-600 to-purple-600 hover:from-orange-700 hover:to-purple-700"
                >
                  {isSettling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                  Settle & Learn
                </Button>
                {!dataFreshness.isStale && (
                  <Button
                    onClick={handleRefreshAndSettle}
                    disabled={isRefreshingStats}
                    variant="outline"
                  >
                    {isRefreshingStats ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {refreshProgress || 'Refreshing...'}
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 mr-2" />
                        Refresh Stats
                      </>
                    )}
                  </Button>
                )}
                {staleParlays > 0 && (
                  <Button 
                    onClick={handlePurgeStaleParlays} 
                    disabled={isPurging}
                    variant="destructive"
                  >
                    {isPurging ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4 mr-2" />
                    )}
                    Purge {staleParlays} Stale
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Verification Results */}
      {verificationResults && (
        <Card className="border-2 border-blue-500/50 bg-blue-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ShieldCheck className="w-5 h-5 text-blue-500" />
              Settlement Verification Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-4 text-center">
                <div className="bg-background/50 rounded-lg p-3">
                  <p className="text-2xl font-bold">{verificationResults.summary.totalVerified}</p>
                  <p className="text-xs text-muted-foreground">Total Verified</p>
                </div>
                <div className="bg-background/50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-green-500">{verificationResults.summary.correctlySettled}</p>
                  <p className="text-xs text-muted-foreground">Correct</p>
                </div>
                <div className="bg-background/50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-red-500">{verificationResults.summary.incorrectlySettled}</p>
                  <p className="text-xs text-muted-foreground">Incorrect</p>
                </div>
                <div className="bg-background/50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-yellow-500">{verificationResults.summary.unverifiable}</p>
                  <p className="text-xs text-muted-foreground">Unverifiable</p>
                </div>
              </div>
              
              {/* Accuracy Rate */}
              <div className="bg-background/50 rounded-lg p-4 text-center">
                <p className="text-4xl font-bold text-blue-500">{verificationResults.summary.accuracyRate}</p>
                <p className="text-sm text-muted-foreground">Verification Accuracy</p>
              </div>
              
              {/* Stats Freshness */}
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-sm font-medium mb-2">Latest Stats Available:</p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">NBA:</span> {verificationResults.summary.latestStatsAvailable.nba}
                  </div>
                  <div>
                    <span className="text-muted-foreground">NFL:</span> {verificationResults.summary.latestStatsAvailable.nfl}
                  </div>
                  <div>
                    <span className="text-muted-foreground">NHL:</span> {verificationResults.summary.latestStatsAvailable.nhl}
                  </div>
                </div>
              </div>
              
              {/* Incorrect Settlements List */}
              {verificationResults.results.filter(r => !r.isCorrect && r.verifiedOutcome).length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-red-500">Incorrectly Settled ({verificationResults.results.filter(r => !r.isCorrect && r.verifiedOutcome).length}):</p>
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-2">
                      {verificationResults.results
                        .filter(r => !r.isCorrect && r.verifiedOutcome)
                        .map((result) => (
                          <div key={result.parlayId} className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-2">
                              <Badge variant="destructive">{result.originalOutcome} → {result.verifiedOutcome}</Badge>
                              <span className="text-xs font-mono">{result.parlayId.slice(0, 8)}...</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{result.reason}</p>
                            <div className="mt-2 space-y-1">
                              {result.legDetails.map((leg, idx) => (
                                <div key={idx} className="text-xs flex items-center gap-2">
                                  {leg.hasValidStats ? (
                                    <CheckCircle2 className="w-3 h-3 text-green-500" />
                                  ) : (
                                    <XCircle className="w-3 h-3 text-red-500" />
                                  )}
                                  <span className="truncate flex-1">{leg.description.substring(0, 50)}...</span>
                                  {leg.statsDate && <span className="text-muted-foreground">Stats: {leg.statsDate}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
              
              <Button 
                onClick={() => setVerificationResults(null)} 
                variant="outline" 
                size="sm" 
                className="w-full"
              >
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Analysis Results */}
      {pendingAnalysisResults && pendingAnalysisResults.pendingAnalysis && (
        <Card className="border-2 border-purple-500/50 bg-purple-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="w-5 h-5 text-purple-500" />
              Pending Parlay Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-4 text-center">
                <div className="bg-background/50 rounded-lg p-3">
                  <p className="text-2xl font-bold">{pendingAnalysisResults.pendingAnalysis.total}</p>
                  <p className="text-xs text-muted-foreground">Total Pending</p>
                </div>
                <div className="bg-background/50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-green-500">{pendingAnalysisResults.pendingAnalysis.readyToSettle}</p>
                  <p className="text-xs text-muted-foreground">Ready to Settle</p>
                </div>
                <div className="bg-background/50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-yellow-500">{pendingAnalysisResults.pendingAnalysis.missingStats}</p>
                  <p className="text-xs text-muted-foreground">Missing Stats</p>
                </div>
                <div className="bg-background/50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-blue-500">{pendingAnalysisResults.pendingAnalysis.gameNotStarted}</p>
                  <p className="text-xs text-muted-foreground">Game Not Started</p>
                </div>
              </div>
              
              {/* Insight */}
              {pendingAnalysisResults.pendingAnalysis.readyToSettle > 0 && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
                  <p className="text-sm text-green-500 font-medium">
                    ✅ {pendingAnalysisResults.pendingAnalysis.readyToSettle} parlays have all stats available and can be settled now!
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Run "Force+Sync" to settle these parlays.
                  </p>
                </div>
              )}
              
              {pendingAnalysisResults.pendingAnalysis.missingStats > 0 && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                  <p className="text-sm text-yellow-500 font-medium">
                    ⚠️ {pendingAnalysisResults.pendingAnalysis.missingStats} parlays are waiting for player stats to be fetched.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    The BallDontLie API may not have stats for recent games yet. Stats are typically available 2-6 hours after game completion.
                  </p>
                </div>
              )}
              
              {/* Stats Freshness */}
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-sm font-medium mb-2">Latest Stats Available:</p>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">NBA:</span> {pendingAnalysisResults.latestStatsAvailable.nba}
                  </div>
                  <div>
                    <span className="text-muted-foreground">NFL:</span> {pendingAnalysisResults.latestStatsAvailable.nfl}
                  </div>
                  <div>
                    <span className="text-muted-foreground">NHL:</span> {pendingAnalysisResults.latestStatsAvailable.nhl}
                  </div>
                </div>
              </div>
              
              <Button 
                onClick={() => setPendingAnalysisResults(null)} 
                variant="outline" 
                size="sm" 
                className="w-full"
              >
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Real-Time Settlement Progress */}
      {settlementProgress && (
        <Card className={`border-2 ${settlementProgress.isRunning ? 'border-cyan-500/50 bg-cyan-500/5' : settlementProgress.won > settlementProgress.lost ? 'border-green-500/50 bg-green-500/5' : 'border-red-500/50 bg-red-500/5'}`}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              {settlementProgress.isRunning ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin text-cyan-500" />
                  Settlement in Progress
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  Settlement Complete
                </>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Progress Status */}
              <p className="text-sm text-muted-foreground">{settlementProgress.status}</p>
              
              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-4 text-center">
                <div className="bg-background/50 rounded-lg p-3">
                  <p className="text-2xl font-bold">{settlementProgress.settled}</p>
                  <p className="text-xs text-muted-foreground">Settled</p>
                </div>
                <div className="bg-background/50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-green-500">{settlementProgress.won}</p>
                  <p className="text-xs text-muted-foreground">Won</p>
                </div>
                <div className="bg-background/50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-red-500">{settlementProgress.lost}</p>
                  <p className="text-xs text-muted-foreground">Lost</p>
                </div>
                <div className="bg-background/50 rounded-lg p-3">
                  <p className="text-2xl font-bold text-yellow-500">{settlementProgress.stillPending}</p>
                  <p className="text-xs text-muted-foreground">Pending</p>
                </div>
              </div>
              
              {/* Learning Results */}
              {settlementProgress.learningResults && !settlementProgress.isRunning && (
                <div className="bg-cyan-500/10 rounded-lg p-3 border border-cyan-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Brain className="w-4 h-4 text-cyan-500" />
                    <span className="text-sm font-medium">AI Learning Updated</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div>
                      <p className="font-bold text-cyan-500">{settlementProgress.learningResults.weights_updated?.weights_updated || 0}</p>
                      <p className="text-muted-foreground">Weights</p>
                    </div>
                    <div>
                      <p className="font-bold text-orange-500">{settlementProgress.learningResults.avoid_patterns?.patterns_updated || 0}</p>
                      <p className="text-muted-foreground">Patterns</p>
                    </div>
                    <div>
                      <p className="font-bold text-purple-500">{settlementProgress.learningResults.compound_formulas?.formulas_updated || 0}</p>
                      <p className="text-muted-foreground">Formulas</p>
                    </div>
                    <div>
                      <p className="font-bold text-green-500">{settlementProgress.learningResults.cross_engine?.comparisons_updated || 0}</p>
                      <p className="text-muted-foreground">Cross-Engine</p>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Detailed Leg Results */}
              {settlementProgress.settledDetails.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-medium">Leg-by-Leg Results:</p>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-3">
                      {settlementProgress.settledDetails.map((parlay) => (
                        <Card key={parlay.id} className="bg-muted/30">
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Badge variant={parlay.outcome === 'won' ? 'default' : 'destructive'}>
                                  {parlay.outcome === 'won' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                                  {parlay.outcome === 'lost' && <XCircle className="w-3 h-3 mr-1" />}
                                  {parlay.outcome.toUpperCase()}
                                </Badge>
                                <span className="text-xs text-muted-foreground">{parlay.strategy}</span>
                              </div>
                              <span className="font-mono font-bold text-sm">
                                {parlay.totalOdds > 0 ? '+' : ''}{parlay.totalOdds}
                              </span>
                            </div>
                            
                            <div className="space-y-2">
                              {parlay.legs.map((leg, idx) => (
                                <div 
                                  key={idx} 
                                  className={`text-sm border-l-2 pl-2 ${
                                    leg.outcome === 'won' ? 'border-green-500' : 
                                    leg.outcome === 'lost' ? 'border-red-500' : 
                                    leg.outcome === 'push' ? 'border-yellow-500' : 'border-muted'
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <span className="truncate flex-1 text-xs">{leg.description}</span>
                                    <div className="flex items-center gap-1">
                                      {leg.outcome === 'won' && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                                      {leg.outcome === 'lost' && <XCircle className="w-3 h-3 text-red-500" />}
                                      {leg.outcome === 'pending' && <Clock className="w-3 h-3 text-yellow-500" />}
                                      {leg.outcome === 'push' && <AlertCircle className="w-3 h-3 text-yellow-500" />}
                                    </div>
                                  </div>
                                  
                                  {/* Show actual stats vs line */}
                                  {leg.actualValue !== undefined && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                      Actual: <span className="font-mono font-medium">{leg.actualValue}</span> vs Line: <span className="font-mono">{leg.line}</span>
                                      {leg.dataSource && <span className="ml-2 opacity-70">({leg.dataSource})</span>}
                                    </p>
                                  )}
                                  
                                  {/* Show game score */}
                                  {leg.score && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                      Final Score: <span className="font-mono font-medium">{leg.score.home} - {leg.score.away}</span>
                                      {leg.dataSource && <span className="ml-2 opacity-70">({leg.dataSource})</span>}
                                    </p>
                                  )}
                                  
                                  {/* Show settlement method if no data */}
                                  {!leg.actualValue && !leg.score && leg.settlementMethod && (
                                    <p className="text-xs text-muted-foreground mt-1 opacity-70">
                                      Method: {leg.settlementMethod}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}
              
              {/* Dismiss button */}
              {!settlementProgress.isRunning && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setSettlementProgress(null)}
                  className="w-full"
                >
                  Dismiss
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Parlays Breakdown */}
      {stats.pending > 0 && (
        <Card className="bg-card/50 border-yellow-500/20">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="w-5 h-5 text-yellow-500" />
                Pending Parlays Breakdown
              </CardTitle>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={fetchPendingBreakdown}
                className="h-8 w-8 p-0"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4 text-center">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                <p className="text-2xl font-bold text-blue-500">{pendingBreakdown.scheduled}</p>
                <p className="text-xs text-muted-foreground">Scheduled</p>
                <p className="text-[10px] text-muted-foreground opacity-70">Games not started</p>
              </div>
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3">
                <p className="text-2xl font-bold text-purple-500">{pendingBreakdown.mixed}</p>
                <p className="text-xs text-muted-foreground">Mixed</p>
                <p className="text-[10px] text-muted-foreground opacity-70">Some games pending</p>
              </div>
              <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3">
                <p className="text-2xl font-bold text-orange-500">{pendingBreakdown.inProgress}</p>
                <p className="text-xs text-muted-foreground">In Progress</p>
                <p className="text-[10px] text-muted-foreground opacity-70">Games ongoing</p>
              </div>
              <div className={`rounded-lg p-3 ${pendingBreakdown.readyToSettle > 0 ? 'bg-green-500/10 border-2 border-green-500/50' : 'bg-green-500/10 border border-green-500/20'}`}>
                <p className={`text-2xl font-bold ${pendingBreakdown.readyToSettle > 0 ? 'text-green-400' : 'text-green-500'}`}>
                  {pendingBreakdown.readyToSettle}
                </p>
                <p className="text-xs text-muted-foreground">Ready to Settle</p>
                <p className="text-[10px] text-muted-foreground opacity-70">All games done</p>
              </div>
            </div>
            
            {/* Progress Bar */}
            <div className="mt-4 space-y-2">
              <div className="flex h-3 rounded-full overflow-hidden bg-muted">
                {pendingBreakdown.scheduled > 0 && (
                  <div 
                    className="bg-blue-500 transition-all" 
                    style={{ width: `${(pendingBreakdown.scheduled / stats.pending) * 100}%` }}
                  />
                )}
                {pendingBreakdown.mixed > 0 && (
                  <div 
                    className="bg-purple-500 transition-all" 
                    style={{ width: `${(pendingBreakdown.mixed / stats.pending) * 100}%` }}
                  />
                )}
                {pendingBreakdown.inProgress > 0 && (
                  <div 
                    className="bg-orange-500 transition-all" 
                    style={{ width: `${(pendingBreakdown.inProgress / stats.pending) * 100}%` }}
                  />
                )}
                {pendingBreakdown.readyToSettle > 0 && (
                  <div 
                    className="bg-green-500 transition-all" 
                    style={{ width: `${(pendingBreakdown.readyToSettle / stats.pending) * 100}%` }}
                  />
                )}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-blue-500" /> Scheduled
                </span>
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-purple-500" /> Mixed
                </span>
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-orange-500" /> In Progress
                </span>
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-green-500" /> Ready
                </span>
              </div>
            </div>
            
            {/* Alert if ready to settle */}
            {pendingBreakdown.readyToSettle > 0 && (
              <div className="mt-4 bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-green-500" />
                  <span className="text-sm text-green-400">
                    {pendingBreakdown.readyToSettle} parlay{pendingBreakdown.readyToSettle > 1 ? 's' : ''} ready to settle!
                  </span>
                </div>
                <Button 
                  onClick={() => handleRunSettlement(true, true)} 
                  disabled={isSettling}
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isSettling ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Zap className="w-4 h-4 mr-1" />}
                  Settle & Learn
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Settlement Status Card */}
      <Card className="bg-card/50 border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <History className="w-5 h-5" />
            Auto-Settlement Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-yellow-500">{stats.pending}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{lastSettlementResult?.settled || 0}</p>
              <p className="text-xs text-muted-foreground">Last Settled</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-green-500">{lastSettlementResult?.won || 0}</p>
              <p className="text-xs text-muted-foreground">Last Won</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-500">{lastSettlementResult?.lost || 0}</p>
              <p className="text-xs text-muted-foreground">Last Lost</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">
                {lastSettlement ? new Date(lastSettlement.started_at).toLocaleString() : 'Never'}
              </p>
              <p className="text-xs text-muted-foreground">Last Run</p>
            </div>
          </div>
          
          {lastSettlement && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <Badge variant={lastSettlement.status === 'completed' ? 'default' : 'secondary'}>
                  {lastSettlement.status}
                </Badge>
                {lastSettlement.duration_ms && (
                  <span className="text-muted-foreground">
                    {(lastSettlement.duration_ms / 1000).toFixed(1)}s
                  </span>
                )}
                {lastSettlementResult?.force_mode && (
                  <Badge variant="outline" className="text-orange-500 border-orange-500/50">
                    Force Mode
                  </Badge>
                )}
              </div>
              {lastSettlementResult?.learningTriggered && (
                <Badge variant="outline" className="text-cyan-500 border-cyan-500/50">
                  <Brain className="w-3 h-3 mr-1" />
                  Learning Updated
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{stats.total}</p>
              </div>
              <BarChart3 className="w-8 h-8 text-primary/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold text-yellow-500">{stats.pending}</p>
              </div>
              <Clock className="w-8 h-8 text-yellow-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Won</p>
                <p className="text-2xl font-bold text-green-500">{stats.won}</p>
              </div>
              <CheckCircle2 className="w-8 h-8 text-green-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Lost</p>
                <p className="text-2xl font-bold text-red-500">{stats.lost}</p>
              </div>
              <XCircle className="w-8 h-8 text-red-500/50" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Accuracy</p>
                <p className="text-2xl font-bold">{learningProgress?.current_accuracy?.toFixed(1) || 0}%</p>
              </div>
              <Target className="w-8 h-8 text-primary/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="formulas" className="space-y-4">
        <TabsList>
          <TabsTrigger value="formulas" className="gap-2">
            <Activity className="w-4 h-4" />
            Formula Performance
          </TabsTrigger>
          <TabsTrigger value="settlement" className="gap-2">
            <History className="w-4 h-4" />
            Settlement History
          </TabsTrigger>
          <TabsTrigger value="engines" className="gap-2">
            <Layers className="w-4 h-4" />
            Engine Stats
          </TabsTrigger>
          <TabsTrigger value="parlays" className="gap-2">
            <BarChart3 className="w-4 h-4" />
            Parlays
          </TabsTrigger>
          <TabsTrigger value="patterns">Patterns</TabsTrigger>
          <TabsTrigger value="insights" className="gap-2">
            <Brain className="w-4 h-4" />
            Learning Insights
          </TabsTrigger>
          <TabsTrigger value="stats" className="gap-2">
            <Database className="w-4 h-4" />
            Stats Data
          </TabsTrigger>
        </TabsList>

        <TabsContent value="formulas">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                Formula Performance Tracker ({formulaPerformance.length} formulas)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {formulaPerformance.map((formula) => (
                    <div key={formula.id} className="p-4 bg-muted/30 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {formula.engine_source.toUpperCase()}
                          </Badge>
                          <span className="font-medium">{formula.formula_name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground">
                            Weight: <span className={formula.current_weight > 1 ? 'text-green-500' : formula.current_weight < 1 ? 'text-red-500' : ''}>
                              {formula.current_weight.toFixed(2)}x
                            </span>
                          </span>
                          <span className={`font-bold ${formula.current_accuracy >= 55 ? 'text-green-500' : formula.current_accuracy >= 45 ? 'text-yellow-500' : 'text-red-500'}`}>
                            {formula.current_accuracy.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-muted-foreground">{formula.total_picks} picks</span>
                        <span className="text-green-500">{formula.wins}W</span>
                        <span className="text-red-500">{formula.losses}L</span>
                        {formula.last_win_streak >= 3 && (
                          <Badge className="bg-green-500/20 text-green-500">🔥 {formula.last_win_streak} streak</Badge>
                        )}
                        {formula.last_loss_streak >= 3 && (
                          <Badge className="bg-red-500/20 text-red-500">❄️ {formula.last_loss_streak} cold</Badge>
                        )}
                      </div>
                      <Progress value={formula.current_accuracy} className="h-2 mt-2" />
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settlement">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="w-5 h-5" />
                Settlement Job History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {settlementJobs.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <History className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No settlement jobs yet. Click "Settle" to run!</p>
                    </div>
                  ) : (
                    settlementJobs.map((job) => {
                      const result = job.result as any;
                      return (
                        <Card key={job.id} className="bg-muted/30">
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Badge variant={job.status === 'completed' ? 'default' : job.status === 'failed' ? 'destructive' : 'secondary'}>
                                  {job.status}
                                </Badge>
                                <span className="text-sm text-muted-foreground">
                                  {new Date(job.started_at).toLocaleString()}
                                </span>
                                {result?.force_mode && (
                                  <Badge variant="outline" className="text-orange-500 border-orange-500/50 text-xs">
                                    Force
                                  </Badge>
                                )}
                              </div>
                              {job.duration_ms && (
                                <span className="text-sm text-muted-foreground">
                                  {(job.duration_ms / 1000).toFixed(1)}s
                                </span>
                              )}
                            </div>
                            {result && (
                              <div className="grid grid-cols-5 gap-2 text-sm">
                                <div className="text-center">
                                  <p className="font-bold">{result.processed || 0}</p>
                                  <p className="text-xs text-muted-foreground">Processed</p>
                                </div>
                                <div className="text-center">
                                  <p className="font-bold">{result.settled || 0}</p>
                                  <p className="text-xs text-muted-foreground">Settled</p>
                                </div>
                                <div className="text-center">
                                  <p className="font-bold text-green-500">{result.won || 0}</p>
                                  <p className="text-xs text-muted-foreground">Won</p>
                                </div>
                                <div className="text-center">
                                  <p className="font-bold text-red-500">{result.lost || 0}</p>
                                  <p className="text-xs text-muted-foreground">Lost</p>
                                </div>
                                <div className="text-center">
                                  <p className="font-bold text-yellow-500">{result.stillPending || 0}</p>
                                  <p className="text-xs text-muted-foreground">Pending</p>
                                </div>
                              </div>
                            )}
                            {result?.learningTriggered && (
                              <div className="mt-2 flex items-center gap-1 text-xs text-cyan-500">
                                <Brain className="w-3 h-3" />
                                Learning engine updated
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="engines">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Engine Contribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(engineContribution)
                    .sort((a, b) => b[1].total - a[1].total)
                    .map(([engine, data]) => {
                      const winRate = data.total > 0 ? (data.wins / data.total) * 100 : 0;
                      return (
                        <div key={engine} className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium capitalize">{engine}</span>
                            <span className="text-muted-foreground">
                              {data.total} parlays • {data.wins}W • {winRate.toFixed(1)}%
                            </span>
                          </div>
                          <Progress value={winRate} className="h-2" />
                        </div>
                      );
                    })}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sport Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {Object.entries(sportDistribution)
                    .sort((a, b) => b[1] - a[1])
                    .map(([sport, count]) => {
                      const percentage = parlays.length > 0 ? (count / parlays.length) * 100 : 0;
                      return (
                        <div key={sport} className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium">{sport.replace(/_/g, ' ').toUpperCase()}</span>
                            <span className="text-muted-foreground">{count} parlays</span>
                          </div>
                          <Progress value={percentage} className="h-2" />
                        </div>
                      );
                    })}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="parlays">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5" />
                  Generated Parlays
                </CardTitle>
                <div className="flex gap-1">
                  {(['all', 'pending', 'won', 'lost'] as const).map(f => (
                    <Button
                      key={f}
                      variant={filter === f ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setFilter(f)}
                      className="text-xs h-7"
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Confidence Tier Legend */}
              <div className="flex items-center gap-4 mb-3 p-2 rounded bg-background/40 text-xs">
                <span className="text-muted-foreground font-medium">Tiers:</span>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-purple-500" />
                  <span className="text-purple-400">Elite (80-95%)</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-green-400">Strong (65-79%)</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-yellow-500" />
                  <span className="text-yellow-400">Moderate (50-64%)</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-red-400">Speculative (35-49%)</span>
                </div>
              </div>
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {filteredParlays.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Sparkles className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No parlays yet. Click "Generate" to start!</p>
                    </div>
                  ) : (
                    filteredParlays.slice(0, 50).map((parlay) => {
                      const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
                      
                      // Confidence tier calculation
                      const conf = parlay.confidence_score;
                      const confTier = conf >= 80 ? { label: 'Elite', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', icon: '🔥' }
                        : conf >= 65 ? { label: 'Strong', color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: '✅' }
                        : conf >= 50 ? { label: 'Moderate', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: '⚡' }
                        : { label: 'Speculative', color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: '⚠️' };
                      
                      // Get confidence breakdown from formula_breakdown if available
                      const breakdown = parlay.formula_breakdown as Record<string, number> | null;
                      const hasConfBreakdown = breakdown && '_conf_normalized' in breakdown;
                      
                      return (
                        <Card key={parlay.id} className="bg-muted/30">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant={
                                  parlay.outcome === 'won' ? 'default' :
                                  parlay.outcome === 'lost' ? 'destructive' : 'secondary'
                                }>
                                  {parlay.outcome === 'won' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                                  {parlay.outcome === 'lost' && <XCircle className="w-3 h-3 mr-1" />}
                                  {parlay.outcome === 'pending' && <Clock className="w-3 h-3 mr-1" />}
                                  {parlay.outcome.toUpperCase()}
                                </Badge>
                                {/* Confidence Tier Badge */}
                                <Badge variant="outline" className={`text-xs border ${confTier.color}`}>
                                  {confTier.icon} {confTier.label}
                                </Badge>
                                <span className="text-xs text-muted-foreground">#{parlay.generation_round}</span>
                                {parlay.sport && (
                                  <Badge variant="outline" className="text-xs">
                                    {parlay.sport.replace(/_/g, ' ')}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-right">
                                <span className="font-mono font-bold">
                                  {parlay.total_odds > 0 ? '+' : ''}{parlay.total_odds}
                                </span>
                                <p className="text-xs font-semibold" style={{ color: conf >= 80 ? '#a855f7' : conf >= 65 ? '#22c55e' : conf >= 50 ? '#eab308' : '#ef4444' }}>
                                  {conf.toFixed(0)}% conf
                                </p>
                              </div>
                            </div>
                            
                            {/* Confidence Breakdown (if available from new funnel) */}
                            {hasConfBreakdown && (
                              <div className="grid grid-cols-4 gap-1 mb-2 p-2 rounded bg-background/40 text-xs">
                                <div className="text-center">
                                  <p className="font-bold text-blue-400">{breakdown['_conf_normalized']}%</p>
                                  <p className="text-muted-foreground text-[10px]">Norm</p>
                                </div>
                                <div className="text-center">
                                  <p className="font-bold text-green-400">{breakdown['_conf_historical']}%</p>
                                  <p className="text-muted-foreground text-[10px]">History</p>
                                </div>
                                <div className="text-center">
                                  <p className="font-bold text-orange-400">{breakdown['_conf_risk']}%</p>
                                  <p className="text-muted-foreground text-[10px]">Risk</p>
                                </div>
                                <div className="text-center">
                                  <p className="font-bold text-purple-400">{breakdown['_conf_probability']}%</p>
                                  <p className="text-muted-foreground text-[10px]">Prob</p>
                                </div>
                              </div>
                            )}
                            
                            <p className="text-xs text-cyan-500 font-medium mb-2">{parlay.strategy_used}</p>

                            <div className="space-y-2">
                              {legs.slice(0, 3).map((leg: any, idx: number) => (
                                <div key={idx} className="flex flex-col gap-1 text-sm border-b border-border/30 pb-2 last:border-0">
                                  {leg.game_description && (
                                    <span className="text-xs text-muted-foreground font-medium">{leg.game_description}</span>
                                  )}
                                  {leg.commence_time && (
                                    <span className="text-xs text-cyan-500">
                                      {new Date(leg.commence_time).toLocaleString('en-US', { 
                                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                                      })}
                                    </span>
                                  )}
                                  <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs">{leg.engine_source || '?'}</Badge>
                                    <span className="truncate flex-1">{leg.description}</span>
                                    <span className="font-mono text-xs">{leg.odds > 0 ? '+' : ''}{leg.odds}</span>
                                  </div>
                                </div>
                              ))}
                              {legs.length > 3 && (
                                <p className="text-xs text-muted-foreground">+{legs.length - 3} more legs</p>
                              )}
                            </div>

                            {parlay.source_engines && parlay.source_engines.length > 0 && (
                              <div className="flex gap-1 flex-wrap mt-2">
                                {parlay.source_engines.map((engine, idx) => (
                                  <Badge key={idx} variant="secondary" className="text-xs">{engine}</Badge>
                                ))}
                              </div>
                            )}

                            <div className="flex items-center justify-between mt-2">
                              <p className="text-xs text-muted-foreground">
                                {new Date(parlay.created_at).toLocaleString()}
                              </p>
                              {parlay.settled_at && (
                                <p className="text-xs text-green-500">
                                  Settled: {new Date(parlay.settled_at).toLocaleString()}
                                </p>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="patterns">
          {learningProgress && (
            <AILearnedPatterns
              patterns={(learningProgress.learned_patterns as { winning: string[]; losing: string[] }) || { winning: [], losing: [] }}
              weights={(learningProgress.strategy_weights as Record<string, number>) || {}}
            />
          )}
        </TabsContent>

        <TabsContent value="insights">
          <AILearningInsights />
        </TabsContent>

        <TabsContent value="stats">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ManualStatsEntry onStatsAdded={fetchData} />
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  Stats Status
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                <p>Missing stats for Dec 10-13 games are blocking settlement.</p>
                <p className="mt-2">Use "Fetch Missing Stats (API)" to pull from BallDontLie, or manually enter player stats to enable settlement.</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default AIGenerativeProgressDashboard;
