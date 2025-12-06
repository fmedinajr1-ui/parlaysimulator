import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CategoryStats, TrendData } from '@/lib/accuracy-calculator';
import { cn } from '@/lib/utils';
import { AlertCircle, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface CategoryBreakdownProps {
  categories: CategoryStats[];
  trends?: TrendData[];
}

export function CategoryBreakdown({ categories, trends = [] }: CategoryBreakdownProps) {
  // Create a map for quick trend lookup
  const trendMap = new Map(trends.map(t => [t.category, t]));

  const getTrendBadge = (category: string) => {
    const trend = trendMap.get(category);
    if (!trend || trend.trend_direction === 'insufficient') {
      return null;
    }

    if (trend.trend_direction === 'up') {
      return (
        <Badge variant="outline" className="text-xs border-green-500/50 text-green-500 gap-1">
          <TrendingUp className="w-3 h-3" />
          +{trend.trend_change.toFixed(1)}%
        </Badge>
      );
    }
    if (trend.trend_direction === 'down') {
      return (
        <Badge variant="outline" className="text-xs border-red-500/50 text-red-500 gap-1">
          <TrendingDown className="w-3 h-3" />
          {trend.trend_change.toFixed(1)}%
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-xs border-muted-foreground/50 text-muted-foreground gap-1">
        <Minus className="w-3 h-3" />
        Stable
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-display flex items-center gap-2">
          📊 CATEGORY BREAKDOWN
          <span className="text-xs font-normal text-muted-foreground">(30-day trends)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Accordion type="single" collapsible className="space-y-2">
          {categories.map((cat) => (
            <AccordionItem 
              key={cat.category} 
              value={cat.category}
              className="border rounded-lg px-4 bg-muted/30"
            >
              <AccordionTrigger className="hover:no-underline py-3">
                <div className="flex items-center justify-between w-full pr-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{cat.icon}</span>
                    <div className="text-left">
                      <p className="font-medium text-sm">{cat.displayName}</p>
                      <p className="text-xs text-muted-foreground">
                        {cat.verifiedPredictions} verified
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {getTrendBadge(cat.category)}
                    <div className="text-right">
                      <span className={cn("text-lg font-bold", cat.gradeColor)}>
                        {cat.grade}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        {cat.accuracyRate.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="space-y-3 pt-2">
                  {/* Trend details */}
                  {trendMap.has(cat.category) && trendMap.get(cat.category)!.trend_direction !== 'insufficient' && (
                    <div className="flex items-center justify-between text-xs p-2 rounded-lg bg-background/50">
                      <span className="text-muted-foreground">30-Day Trend</span>
                      <div className="flex items-center gap-2">
                        <span>Last 30d: {trendMap.get(cat.category)!.current_period_accuracy.toFixed(1)}%</span>
                        <span className="text-muted-foreground">vs</span>
                        <span>Prev 30d: {trendMap.get(cat.category)!.previous_period_accuracy.toFixed(1)}%</span>
                      </div>
                    </div>
                  )}

                  {/* Progress bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Accuracy</span>
                      <span>{cat.accuracyRate.toFixed(1)}% (breakeven: 52.4%)</span>
                    </div>
                    <div className="relative">
                      <Progress 
                        value={Math.min(cat.accuracyRate, 100)} 
                        className="h-2"
                      />
                      {/* Breakeven marker */}
                      <div 
                        className="absolute top-0 h-2 w-0.5 bg-yellow-500"
                        style={{ left: '52.4%' }}
                      />
                    </div>
                  </div>
                  
                  {/* Sample confidence */}
                  <div className="flex items-center gap-2">
                    {cat.sampleConfidence === 'insufficient' && (
                      <Badge variant="outline" className="text-xs border-yellow-500/50 text-yellow-500">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        Needs more data
                      </Badge>
                    )}
                    {cat.sampleConfidence === 'low' && (
                      <Badge variant="outline" className="text-xs border-orange-500/50 text-orange-500">
                        Low confidence
                      </Badge>
                    )}
                    {cat.sampleConfidence === 'medium' && (
                      <Badge variant="outline" className="text-xs border-yellow-500/50 text-yellow-500">
                        Medium confidence
                      </Badge>
                    )}
                    {cat.sampleConfidence === 'high' && (
                      <Badge variant="outline" className="text-xs border-green-500/50 text-green-500">
                        High confidence
                      </Badge>
                    )}
                  </div>
                  
                  {/* Subcategories */}
                  {cat.subcategories.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-border/50">
                      <p className="text-xs font-medium text-muted-foreground uppercase">
                        Subcategories
                      </p>
                      <div className="grid grid-cols-1 gap-2">
                        {cat.subcategories.map((sub, idx) => (
                          <div 
                            key={idx}
                            className="flex items-center justify-between text-xs bg-background/50 rounded-md p-2"
                          >
                            <span className="truncate flex-1 mr-2">{sub.subcategory}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-muted-foreground">
                                {sub.verified_predictions} picks
                              </span>
                              <span className={cn(
                                "font-medium",
                                sub.accuracy_rate >= 52.4 ? "text-green-500" : "text-red-500"
                              )}>
                                {sub.accuracy_rate.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}
