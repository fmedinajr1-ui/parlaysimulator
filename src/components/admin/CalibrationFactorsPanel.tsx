import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SlidersHorizontal, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface CalibrationFactor {
  id: string;
  factor_key: string;
  factor_value: number;
  description: string | null;
  last_accuracy: number | null;
  sample_size: number | null;
  updated_at: string;
}

export function CalibrationFactorsPanel() {
  const { data: factors, isLoading } = useQuery({
    queryKey: ['calibration-factors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sharp_signal_calibration')
        .select('*')
        .order('factor_key', { ascending: true });
      
      if (error) throw error;
      return data as CalibrationFactor[];
    }
  });

  const getFactorBadgeClass = (value: number) => {
    if (value > 1.1) return 'bg-neon-green/20 text-neon-green border-neon-green/30';
    if (value < 0.9) return 'bg-red-500/20 text-red-400 border-red-500/30';
    return 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30';
  };

  const getAccuracyBadgeClass = (accuracy: number | null) => {
    if (!accuracy) return 'bg-muted text-muted-foreground';
    if (accuracy >= 60) return 'bg-neon-green/20 text-neon-green border-neon-green/30';
    if (accuracy >= 50) return 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30';
    return 'bg-red-500/20 text-red-400 border-red-500/30';
  };

  const getTrendIcon = (value: number) => {
    if (value > 1.05) return <TrendingUp className="h-3 w-3 text-neon-green" />;
    if (value < 0.95) return <TrendingDown className="h-3 w-3 text-red-400" />;
    return <Minus className="h-3 w-3 text-muted-foreground" />;
  };

  const formatFactorKey = (key: string) => {
    return key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  };

  if (isLoading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            Calibration Factors
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!factors || factors.length === 0) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            Calibration Factors
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No calibration factors found. Run recalibration to generate factors.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          Calibration Factors
          <Badge variant="outline" className="ml-auto text-xs">
            {factors.length} factors
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {factors.map((factor) => (
          <div
            key={factor.id}
            className="p-3 rounded-lg bg-muted/30 border border-border/50"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {getTrendIcon(factor.factor_value)}
                  <span className="font-medium text-sm truncate">
                    {formatFactorKey(factor.factor_key)}
                  </span>
                </div>
                {factor.description && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {factor.description}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge className={getFactorBadgeClass(factor.factor_value)}>
                  {factor.factor_value.toFixed(2)}x
                </Badge>
                {factor.last_accuracy !== null && (
                  <Badge className={getAccuracyBadgeClass(factor.last_accuracy)}>
                    {factor.last_accuracy.toFixed(1)}%
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
              <span>
                {factor.sample_size ? `${factor.sample_size} samples` : 'No samples'}
              </span>
              <span>
                Updated: {new Date(factor.updated_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
