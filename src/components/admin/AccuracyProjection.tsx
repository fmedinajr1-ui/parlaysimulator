import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, Calculator, Target } from 'lucide-react';

interface CategoryStats {
  sport: string;
  bet_type: string;
  total: number;
  settled: number;
  wins: number;
  accuracy: number;
  pending: number;
}

interface AccuracyProjectionProps {
  categories: CategoryStats[];
  currentAccuracy: number;
  totalSamples: number;
}

export function AccuracyProjection({ categories, currentAccuracy, totalSamples }: AccuracyProjectionProps) {
  // Statistical estimation for samples needed to reach 80% accuracy
  // Based on: confidence intervals narrow as sample size increases
  // For 80% accuracy with 95% confidence interval of ±5%, need ~246 samples per category
  
  const TARGET_ACCURACY = 80;
  const MIN_SAMPLES_FOR_RELIABILITY = 100;
  const IDEAL_SAMPLES_PER_CATEGORY = 150;

  // Calculate estimated samples needed
  const categoriesCount = categories.length || 1;
  const avgSamplesPerCategory = totalSamples / categoriesCount;
  
  // Estimate based on current trajectory
  const accuracyGap = TARGET_ACCURACY - currentAccuracy;
  const improvementPerSample = 0.1; // Rough estimate: 0.1% improvement per 10 samples
  const samplesNeededForAccuracy = accuracyGap > 0 ? Math.ceil(accuracyGap / improvementPerSample) * 10 : 0;
  
  // Samples needed for statistical reliability
  const samplesNeededForReliability = Math.max(0, (IDEAL_SAMPLES_PER_CATEGORY * categoriesCount) - totalSamples);
  
  // Total estimated
  const totalSamplesNeeded = Math.max(samplesNeededForAccuracy, samplesNeededForReliability);
  
  // Estimate parlays (each parlay has ~3-4 legs on average)
  const avgLegsPerParlay = 3.5;
  const parlaysNeeded = Math.ceil(totalSamplesNeeded / avgLegsPerParlay);

  // Time estimate (assuming 5 parlays/day upload rate)
  const uploadRatePerDay = 5;
  const daysNeeded = Math.ceil(parlaysNeeded / uploadRatePerDay);

  // Categories closest to 80%
  const nearTarget = categories
    .filter(c => c.settled >= 5 && c.accuracy >= 60 && c.accuracy < 80)
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 3);

  // Categories already at 80%+
  const atTarget = categories.filter(c => c.settled >= 5 && c.accuracy >= 80);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calculator className="w-4 h-4 text-primary" />
          Projection to 80% Accuracy
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main Estimate */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-center">
            <p className="text-2xl font-bold text-primary">{totalSamplesNeeded.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Samples Needed</p>
          </div>
          <div className="p-3 rounded-lg bg-chart-2/10 border border-chart-2/20 text-center">
            <p className="text-2xl font-bold text-chart-2">{parlaysNeeded.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Parlays to Upload</p>
          </div>
        </div>

        {/* Time Estimate */}
        <div className="p-3 rounded-lg bg-muted/50">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Time Estimate
            </span>
            <Badge variant="outline">{uploadRatePerDay} parlays/day</Badge>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {daysNeeded > 30 ? `${Math.ceil(daysNeeded / 30)} months` : `${daysNeeded} days`}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            At current upload rate to reach target
          </p>
        </div>

        {/* Categories Close to Target */}
        {nearTarget.length > 0 && (
          <div>
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <Target className="w-3 h-3" />
              Almost at 80% (Quick Wins)
            </h4>
            <div className="space-y-2">
              {nearTarget.map((cat, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 rounded bg-yellow-500/10 border border-yellow-500/20">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{cat.sport}</span>
                    <Badge variant="secondary" className="text-xs">{cat.bet_type}</Badge>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-yellow-500">{(cat.accuracy ?? 0).toFixed(0)}%</p>
                    <p className="text-xs text-muted-foreground">
                      ~{Math.ceil((80 - (cat.accuracy ?? 0)) * 2)} more wins needed
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Categories at Target */}
        {atTarget.length > 0 && (
          <div>
            <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              ✅ At or Above 80%
            </h4>
            <div className="flex flex-wrap gap-2">
              {atTarget.map((cat, idx) => (
                <Badge key={idx} variant="default" className="bg-green-500/20 text-green-500 border-green-500/30">
                  {cat.sport} {cat.bet_type} ({(cat.accuracy ?? 0).toFixed(0)}%)
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Methodology Note */}
        <div className="text-xs text-muted-foreground p-2 rounded bg-muted/30">
          <p className="font-medium mb-1">📊 Methodology:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Target: 100+ settled samples per sport/bet type</li>
            <li>Accuracy improves with more diverse, settled data</li>
            <li>Focus on high-pending categories for faster learning</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
