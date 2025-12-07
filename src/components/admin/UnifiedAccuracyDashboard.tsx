import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, TrendingUp, TrendingDown, Target, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface AccuracyStat {
  system_name: string;
  category: string;
  total_predictions: number;
  verified_predictions: number;
  correct_predictions: number;
  accuracy_rate: number;
  roi_percentage: number;
  sample_confidence: string;
}

const SYSTEM_DISPLAY_NAMES: Record<string, { name: string; icon: React.ReactNode; color: string }> = {
  'juiced_props': { name: 'Juiced Props', icon: <Target className="w-4 h-4" />, color: 'text-yellow-400' },
  'hitrate_parlays': { name: 'Hit Rate Parlays', icon: <TrendingUp className="w-4 h-4" />, color: 'text-green-400' },
  'upset_predictions': { name: 'Upset Calculator', icon: <AlertTriangle className="w-4 h-4" />, color: 'text-orange-400' },
  'sharp_money': { name: 'Sharp Money', icon: <TrendingDown className="w-4 h-4" />, color: 'text-blue-400' },
};

export function UnifiedAccuracyDashboard() {
  const [isVerifying, setIsVerifying] = useState<string | null>(null);

  const { data: accuracyData, isLoading, refetch } = useQuery({
    queryKey: ['unified-accuracy'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_complete_accuracy_summary');
      if (error) throw error;
      return data as AccuracyStat[];
    }
  });

  const handleVerify = async (systemName: string) => {
    setIsVerifying(systemName);
    try {
      const functionMap: Record<string, string> = {
        'juiced_props': 'verify-juiced-outcomes',
        'hitrate_parlays': 'verify-hitrate-outcomes',
        'upset_predictions': 'verify-upset-outcomes',
        'sharp_money': 'verify-sharp-outcomes',
      };

      const functionName = functionMap[systemName];
      if (!functionName) {
        toast.error('Unknown system');
        return;
      }

      const { data, error } = await supabase.functions.invoke(functionName);
      if (error) throw error;

      toast.success(`Verified ${data?.verified || 0} predictions`);
      refetch();
    } catch (error) {
      console.error('Verification error:', error);
      toast.error('Verification failed');
    } finally {
      setIsVerifying(null);
    }
  };

  const getAccuracyColor = (rate: number) => {
    if (rate >= 60) return 'text-green-400';
    if (rate >= 50) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getROIColor = (roi: number) => {
    if (roi > 0) return 'text-green-400';
    if (roi === 0) return 'text-muted-foreground';
    return 'text-red-400';
  };

  const getConfidenceBadge = (confidence: string) => {
    switch (confidence) {
      case 'high':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">High</Badge>;
      case 'medium':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Medium</Badge>;
      case 'low':
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Low</Badge>;
      default:
        return <Badge className="bg-muted text-muted-foreground">Insufficient</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  // Group data by system
  const groupedData: Record<string, AccuracyStat[]> = {};
  accuracyData?.forEach(stat => {
    if (!groupedData[stat.system_name]) {
      groupedData[stat.system_name] = [];
    }
    groupedData[stat.system_name].push(stat);
  });

  // Calculate overall stats per system
  const systemSummaries = Object.entries(groupedData).map(([system, stats]) => {
    const totalPredictions = stats.reduce((sum, s) => sum + s.total_predictions, 0);
    const totalVerified = stats.reduce((sum, s) => sum + s.verified_predictions, 0);
    const totalCorrect = stats.reduce((sum, s) => sum + s.correct_predictions, 0);
    const avgAccuracy = totalVerified > 0 ? (totalCorrect / totalVerified) * 100 : 0;
    const avgROI = stats.reduce((sum, s) => sum + s.roi_percentage * s.verified_predictions, 0) / (totalVerified || 1);

    return {
      system,
      totalPredictions,
      totalVerified,
      totalCorrect,
      avgAccuracy,
      avgROI,
      categories: stats
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">Unified Accuracy Dashboard</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {/* Overall Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {systemSummaries.map(summary => {
          const displayInfo = SYSTEM_DISPLAY_NAMES[summary.system] || { 
            name: summary.system, 
            icon: <Target className="w-4 h-4" />, 
            color: 'text-muted-foreground' 
          };

          return (
            <Card key={summary.system} className="bg-card/50 border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span className={displayInfo.color}>{displayInfo.icon}</span>
                  {displayInfo.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground text-xs">Accuracy</span>
                  <span className={`font-bold ${getAccuracyColor(summary.avgAccuracy)}`}>
                    {summary.avgAccuracy.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground text-xs">ROI</span>
                  <span className={`font-bold ${getROIColor(summary.avgROI)}`}>
                    {summary.avgROI > 0 ? '+' : ''}{summary.avgROI.toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground text-xs">Sample</span>
                  <span className="text-xs text-muted-foreground">
                    {summary.totalVerified} / {summary.totalPredictions}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2"
                  onClick={() => handleVerify(summary.system)}
                  disabled={isVerifying === summary.system}
                >
                  {isVerifying === summary.system ? (
                    <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <CheckCircle className="w-3 h-3 mr-1" />
                  )}
                  Verify
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Detailed Breakdown */}
      {systemSummaries.map(summary => {
        const displayInfo = SYSTEM_DISPLAY_NAMES[summary.system] || { 
          name: summary.system, 
          icon: <Target className="w-4 h-4" />, 
          color: 'text-muted-foreground' 
        };

        return (
          <Card key={`detail-${summary.system}`} className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span className={displayInfo.color}>{displayInfo.icon}</span>
                {displayInfo.name} - Category Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {summary.categories.map((cat, idx) => (
                  <div 
                    key={`${cat.category}-${idx}`}
                    className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">{cat.category}</span>
                      {getConfidenceBadge(cat.sample_confidence)}
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-center">
                        <div className="text-muted-foreground text-xs">Verified</div>
                        <div className="font-medium">{cat.verified_predictions}/{cat.total_predictions}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-muted-foreground text-xs">Accuracy</div>
                        <div className={`font-bold ${getAccuracyColor(cat.accuracy_rate)}`}>
                          {cat.accuracy_rate.toFixed(1)}%
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-muted-foreground text-xs">ROI</div>
                        <div className={`font-bold ${getROIColor(cat.roi_percentage)}`}>
                          {cat.roi_percentage > 0 ? '+' : ''}{cat.roi_percentage.toFixed(1)}%
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {cat.accuracy_rate >= 52 ? (
                          <CheckCircle className="w-4 h-4 text-green-400" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400" />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {summary.categories.length === 0 && (
                  <div className="text-center py-4 text-muted-foreground">
                    No data available yet
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
