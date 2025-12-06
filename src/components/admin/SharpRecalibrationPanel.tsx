import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, RefreshCw, TrendingUp, TrendingDown, AlertTriangle, CheckCircle } from 'lucide-react';

interface SignalAccuracy {
  signal: string;
  total: number;
  correct: number;
  accuracy: number;
  currentWeight: number;
  suggestedWeight: number;
}

interface RecommendationAccuracy {
  recommendation: string;
  total: number;
  correct: number;
  accuracy: number;
}

interface CalibrationResult {
  timestamp: string;
  signalAccuracy: SignalAccuracy[];
  recommendationAccuracy: RecommendationAccuracy[];
  confidenceBuckets: {
    bucket: string;
    total: number;
    correct: number;
    accuracy: number;
  }[];
  suggestions: string[];
  calibrationFactors: Record<string, number>;
}

export function SharpRecalibrationPanel() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<CalibrationResult | null>(null);
  const [summary, setSummary] = useState<{
    totalMovements: number;
    pickAccuracy: string;
    fadeAccuracy: string;
    suggestionsCount: number;
    savedFactors?: number;
  } | null>(null);

  const runRecalibration = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('recalibrate-sharp-signals');
      
      if (error) throw error;
      
      if (data.success) {
        setResult(data.result);
        setSummary({ ...data.summary, savedFactors: data.savedFactors });
        toast({
          title: "Recalibration Complete",
          description: `Analyzed ${data.summary.totalMovements} movements, saved ${data.savedFactors || 0} factors`
        });
      } else {
        toast({
          title: "Insufficient Data",
          description: data.message || "Not enough verified movements to recalibrate",
          variant: "destructive"
        });
      }
    } catch (err) {
      console.error('Recalibration error:', err);
      toast({
        title: "Error",
        description: "Failed to run recalibration",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getAccuracyColor = (accuracy: number) => {
    if (accuracy >= 60) return 'text-green-500';
    if (accuracy >= 55) return 'text-yellow-500';
    if (accuracy >= 50) return 'text-orange-500';
    return 'text-red-500';
  };

  const getWeightChange = (current: number, suggested: number) => {
    const diff = suggested - current;
    if (diff > 0) return <TrendingUp className="w-3 h-3 text-green-500" />;
    if (diff < 0) return <TrendingDown className="w-3 h-3 text-red-500" />;
    return <CheckCircle className="w-3 h-3 text-muted-foreground" />;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <RefreshCw className="w-5 h-5" />
            Sharp Signal Recalibration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Analyzes historical sharp money accuracy to suggest weight adjustments for improved predictions.
          </p>
          
          <Button 
            onClick={runRecalibration} 
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Accuracy...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Run Recalibration Analysis
              </>
            )}
          </Button>

          {/* Summary Stats */}
          {summary && (
            <div className="grid grid-cols-5 gap-2 pt-2">
              <div className="text-center p-2 bg-muted rounded">
                <p className="text-lg font-bold">{summary.totalMovements}</p>
                <p className="text-xs text-muted-foreground">Analyzed</p>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <p className={`text-lg font-bold ${getAccuracyColor(parseFloat(summary.pickAccuracy))}`}>
                  {summary.pickAccuracy}
                </p>
                <p className="text-xs text-muted-foreground">PICK Acc</p>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <p className={`text-lg font-bold ${getAccuracyColor(parseFloat(summary.fadeAccuracy))}`}>
                  {summary.fadeAccuracy}
                </p>
                <p className="text-xs text-muted-foreground">FADE Acc</p>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <p className="text-lg font-bold text-primary">{summary.suggestionsCount}</p>
                <p className="text-xs text-muted-foreground">Suggestions</p>
              </div>
              <div className="text-center p-2 bg-muted rounded">
                <p className="text-lg font-bold text-green-500">{summary.savedFactors || 0}</p>
                <p className="text-xs text-muted-foreground">Saved</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recommendations by Type */}
      {result?.recommendationAccuracy && result.recommendationAccuracy.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recommendation Accuracy</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {result.recommendationAccuracy.map((rec) => (
                <div key={rec.recommendation} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                  <div className="flex items-center gap-2">
                    <Badge variant={rec.recommendation === 'pick' ? 'default' : rec.recommendation === 'fade' ? 'destructive' : 'secondary'}>
                      {rec.recommendation.toUpperCase()}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {rec.correct}/{rec.total}
                    </span>
                  </div>
                  <span className={`font-bold ${getAccuracyColor(rec.accuracy)}`}>
                    {rec.accuracy}%
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confidence Buckets */}
      {result?.confidenceBuckets && result.confidenceBuckets.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By Confidence Level</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {result.confidenceBuckets.map((bucket) => (
                <div key={bucket.bucket} className="flex items-center justify-between p-2 bg-muted/50 rounded">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{bucket.bucket}</span>
                    <span className="text-xs text-muted-foreground">
                      ({bucket.correct}/{bucket.total})
                    </span>
                  </div>
                  <span className={`font-bold ${getAccuracyColor(bucket.accuracy)}`}>
                    {bucket.accuracy}%
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Signal Accuracy */}
      {result?.signalAccuracy && result.signalAccuracy.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Signal Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {result.signalAccuracy.map((signal) => (
                <div key={signal.signal} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{signal.signal.replace(/_/g, ' ')}</p>
                    <p className="text-xs text-muted-foreground">
                      {signal.correct}/{signal.total} • Weight: {signal.currentWeight} → {signal.suggestedWeight}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {getWeightChange(signal.currentWeight, signal.suggestedWeight)}
                    <span className={`font-bold ${getAccuracyColor(signal.accuracy)}`}>
                      {signal.accuracy}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Suggestions */}
      {result?.suggestions && result.suggestions.length > 0 && (
        <Card className="border-primary/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              Calibration Suggestions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {result.suggestions.map((suggestion, idx) => (
                <li key={idx} className="text-sm p-2 bg-yellow-500/10 border border-yellow-500/20 rounded">
                  {suggestion}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Calibration Factors */}
      {result?.calibrationFactors && Object.keys(result.calibrationFactors).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Suggested Calibration Factors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(result.calibrationFactors).map(([key, value]) => (
                <div key={key} className="flex justify-between p-2 bg-muted/50 rounded text-sm">
                  <span className="font-mono text-xs truncate">{key}</span>
                  <Badge variant="outline">{value}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
