import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, AlertTriangle, XCircle, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Recommendation {
  type: 'trust' | 'caution' | 'avoid' | 'needs_data';
  message: string;
}

interface PerformerItem {
  name: string;
  accuracy: number;
  grade: string;
}

interface AccuracyRecommendationsProps {
  recommendations: Recommendation[];
  bestPerformers: PerformerItem[];
  worstPerformers: PerformerItem[];
}

const typeConfig = {
  trust: {
    icon: CheckCircle,
    label: 'TRUST',
    className: 'text-green-500 border-green-500/30 bg-green-500/10'
  },
  caution: {
    icon: AlertTriangle,
    label: 'CAUTION',
    className: 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10'
  },
  avoid: {
    icon: XCircle,
    label: 'AVOID',
    className: 'text-red-500 border-red-500/30 bg-red-500/10'
  },
  needs_data: {
    icon: BarChart3,
    label: 'NEEDS DATA',
    className: 'text-muted-foreground border-border bg-muted/50'
  }
};

export function AccuracyRecommendations({ 
  recommendations, 
  bestPerformers, 
  worstPerformers 
}: AccuracyRecommendationsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Best Performers */}
      {bestPerformers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-display flex items-center gap-2">
              🏆 BEST PERFORMERS
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {bestPerformers.map((item, idx) => (
              <div 
                key={idx}
                className="flex items-center justify-between p-2 rounded-lg bg-green-500/10 border border-green-500/30"
              >
                <span className="text-sm font-medium">{item.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-green-500 font-bold">
                    {item.accuracy.toFixed(1)}%
                  </span>
                  <span className="text-xs text-green-400">({item.grade})</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Worst Performers */}
      {worstPerformers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-display flex items-center gap-2">
              ⚠️ NEEDS IMPROVEMENT
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {worstPerformers.map((item, idx) => (
              <div 
                key={idx}
                className="flex items-center justify-between p-2 rounded-lg bg-red-500/10 border border-red-500/30"
              >
                <span className="text-sm font-medium">{item.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-red-500 font-bold">
                    {item.accuracy.toFixed(1)}%
                  </span>
                  <span className="text-xs text-red-400">({item.grade})</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Recommendations */}
      <Card className="md:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-display flex items-center gap-2">
            💡 RECOMMENDATIONS
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {recommendations.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Not enough data to generate recommendations yet
            </p>
          ) : (
            recommendations.slice(0, 6).map((rec, idx) => {
              const config = typeConfig[rec.type];
              const Icon = config.icon;
              
              return (
                <div 
                  key={idx}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-lg border",
                    config.className
                  )}
                >
                  <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <span className="text-xs font-bold uppercase tracking-wide">
                      {config.label}
                    </span>
                    <p className="text-sm mt-0.5">{rec.message}</p>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
