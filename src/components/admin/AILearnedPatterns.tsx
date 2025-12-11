import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Brain, BarChart3 } from 'lucide-react';

interface AILearnedPatternsProps {
  patterns: {
    winning: string[];
    losing: string[];
  };
  weights: Record<string, number>;
}

export function AILearnedPatterns({ patterns, weights }: AILearnedPatternsProps) {
  const sortedWeights = Object.entries(weights)
    .sort(([, a], [, b]) => (b as number) - (a as number));

  const formatSignalName = (signal: string) => {
    return signal
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  };

  const getWeightColor = (weight: number) => {
    if (weight >= 1.2) return 'bg-green-500';
    if (weight >= 1.0) return 'bg-cyan-500';
    if (weight >= 0.8) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* Learned Patterns Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="w-4 h-4 text-purple-500" />
            Learned Patterns
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Winning Patterns */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-green-500" />
              <span className="text-sm font-medium text-green-500">Winning Combinations</span>
            </div>
            {patterns.winning.length > 0 ? (
              <div className="space-y-1">
                {patterns.winning.slice(0, 5).map((pattern, idx) => (
                  <div 
                    key={idx}
                    className="flex items-center gap-2 text-sm bg-green-500/10 rounded-lg px-3 py-2"
                  >
                    <span className="text-green-500">✓</span>
                    <span className="truncate">{pattern}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No winning patterns identified yet
              </p>
            )}
          </div>

          {/* Losing Patterns */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="w-4 h-4 text-red-500" />
              <span className="text-sm font-medium text-red-500">Patterns to Avoid</span>
            </div>
            {patterns.losing.length > 0 ? (
              <div className="space-y-1">
                {patterns.losing.slice(0, 5).map((pattern, idx) => (
                  <div 
                    key={idx}
                    className="flex items-center gap-2 text-sm bg-red-500/10 rounded-lg px-3 py-2"
                  >
                    <span className="text-red-500">✗</span>
                    <span className="truncate">{pattern}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No losing patterns identified yet
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Strategy Weights Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="w-4 h-4 text-cyan-500" />
            Strategy Weights
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sortedWeights.length > 0 ? (
            <div className="space-y-3">
              {sortedWeights.map(([signal, weight]) => {
                const numWeight = weight as number;
                const percentage = Math.min(numWeight * 50, 100);
                
                return (
                  <div key={signal}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">
                        {formatSignalName(signal)}
                      </span>
                      <Badge 
                        variant="outline" 
                        className={`text-xs ${
                          numWeight >= 1.2 ? 'text-green-500 border-green-500/50' :
                          numWeight >= 1.0 ? 'text-cyan-500 border-cyan-500/50' :
                          numWeight >= 0.8 ? 'text-yellow-500 border-yellow-500/50' :
                          'text-red-500 border-red-500/50'
                        }`}
                      >
                        {numWeight.toFixed(2)}x
                      </Badge>
                    </div>
                    <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-500 ${getWeightColor(numWeight)}`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No weights calculated yet</p>
              <p className="text-xs">Generate parlays to start learning</p>
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-xs text-muted-foreground">Boosted</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-cyan-500" />
              <span className="text-xs text-muted-foreground">Neutral</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-xs text-muted-foreground">Reduced</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
