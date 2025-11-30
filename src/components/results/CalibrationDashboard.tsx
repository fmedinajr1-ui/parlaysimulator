import { useState, useEffect } from "react";
import { FeedCard } from "../FeedCard";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Target, BarChart3 } from "lucide-react";

interface CalibrationFactor {
  sport: string;
  bet_type: string;
  confidence_level: string;
  predicted_avg: number;
  actual_win_rate: number;
  calibration_factor: number;
  sample_size: number;
}

interface CalibrationDashboardProps {
  delay?: number;
  compact?: boolean;
}

export function CalibrationDashboard({ delay = 0, compact = false }: CalibrationDashboardProps) {
  const [factors, setFactors] = useState<CalibrationFactor[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchCalibration = async () => {
      try {
        // Query the calibration factors table directly (using type assertion for new table)
        const { data, error } = await (supabase as any)
          .from('ai_calibration_factors')
          .select('*')
          .gte('sample_size', 3)
          .order('sport');
        
        if (error) {
          console.error('Error fetching calibration factors:', error);
          return;
        }

        // Map database columns to our interface
        const mappedFactors: CalibrationFactor[] = (data || []).map((d: any) => ({
          sport: d.sport,
          bet_type: d.bet_type,
          confidence_level: d.confidence_level,
          predicted_avg: Number(d.predicted_avg),
          actual_win_rate: Number(d.actual_win_rate),
          calibration_factor: Number(d.calibration_factor),
          sample_size: d.sample_size
        }));

        setFactors(mappedFactors);
      } catch (err) {
        console.error('Failed to fetch calibration:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCalibration();
  }, []);

  const getCalibrationStatus = (factor: number) => {
    if (factor >= 0.95 && factor <= 1.05) return { label: 'Well Calibrated', color: 'text-neon-green', bg: 'bg-neon-green/20' };
    if (factor < 0.95) return { label: 'Overconfident', color: 'text-neon-orange', bg: 'bg-neon-orange/20' };
    return { label: 'Underconfident', color: 'text-neon-purple', bg: 'bg-neon-purple/20' };
  };

  const overallCalibration = factors.length > 0 
    ? factors.reduce((sum, f) => sum + f.calibration_factor, 0) / factors.length 
    : 1;

  const totalSamples = factors.reduce((sum, f) => sum + f.sample_size, 0);

  if (isLoading) {
    return (
      <FeedCard delay={delay}>
        <div className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-20 w-full" />
        </div>
      </FeedCard>
    );
  }

  if (factors.length === 0) {
    return null; // Don't show if no calibration data
  }

  const status = getCalibrationStatus(overallCalibration);

  if (compact) {
    return (
      <div className={`rounded-lg px-3 py-2 ${status.bg} border border-border/50 flex items-center gap-2`}>
        <Target className={`w-4 h-4 ${status.color}`} />
        <span className="text-xs text-muted-foreground">AI Calibration:</span>
        <span className={`text-xs font-medium ${status.color}`}>
          {(overallCalibration * 100).toFixed(0)}%
        </span>
        <span className="text-xs text-muted-foreground">
          ({totalSamples} samples)
        </span>
      </div>
    );
  }

  return (
    <FeedCard delay={delay}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground uppercase tracking-wider">
          🎯 AI Calibration
        </p>
        <div className={`px-2 py-1 rounded-full text-xs font-medium ${status.bg} ${status.color}`}>
          {status.label}
        </div>
      </div>

      {/* Overall Score */}
      <div className="flex items-center gap-4 mb-4 p-3 rounded-lg bg-muted/50">
        <div className="flex-1">
          <p className="text-xs text-muted-foreground uppercase">Overall Calibration</p>
          <p className={`text-2xl font-bold ${status.color}`}>
            {(overallCalibration * 100).toFixed(1)}%
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground uppercase">Total Samples</p>
          <p className="text-lg font-semibold text-foreground">{totalSamples}</p>
        </div>
        {overallCalibration < 1 ? (
          <TrendingDown className="w-8 h-8 text-neon-orange" />
        ) : (
          <TrendingUp className="w-8 h-8 text-neon-green" />
        )}
      </div>

      {/* Calibration by Category */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground uppercase mb-2 flex items-center gap-1">
          <BarChart3 className="w-3 h-3" /> By Category
        </p>
        <div className="grid gap-2">
          {factors.slice(0, 5).map((factor, idx) => {
            const factorStatus = getCalibrationStatus(factor.calibration_factor);
            const predictedPct = (factor.predicted_avg * 100).toFixed(0);
            const actualPct = (factor.actual_win_rate * 100).toFixed(0);
            
            return (
              <div key={idx} className="p-2 rounded-lg bg-background/50 border border-border/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-foreground">
                    {factor.sport} · {factor.bet_type} ({factor.confidence_level})
                  </span>
                  <span className={`text-xs font-medium ${factorStatus.color}`}>
                    {(factor.calibration_factor * 100).toFixed(0)}%
                  </span>
                </div>
                
                {/* Visual comparison bar */}
                <div className="relative h-4 bg-muted rounded-full overflow-hidden">
                  {/* Predicted */}
                  <div 
                    className="absolute top-0 left-0 h-full bg-muted-foreground/30 rounded-full"
                    style={{ width: `${Math.min(Number(predictedPct), 100)}%` }}
                  />
                  {/* Actual */}
                  <div 
                    className={`absolute top-0 left-0 h-full ${factorStatus.bg} rounded-full`}
                    style={{ width: `${Math.min(Number(actualPct), 100)}%` }}
                  />
                </div>
                
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>Predicted: {predictedPct}%</span>
                  <span>Actual: {actualPct}%</span>
                  <span>{factor.sample_size} bets</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-3 text-center">
        100% = perfectly calibrated • &lt;100% = AI overconfident • &gt;100% = AI underconfident
      </p>
    </FeedCard>
  );
}
