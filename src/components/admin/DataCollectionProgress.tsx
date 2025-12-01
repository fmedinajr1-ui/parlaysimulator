import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { BarChart3, AlertCircle, CheckCircle } from 'lucide-react';

interface CategoryStats {
  sport: string;
  bet_type: string;
  total: number;
  settled: number;
  wins: number;
  accuracy: number;
  pending: number;
}

interface DataCollectionProgressProps {
  categories: CategoryStats[];
}

const TARGET_SAMPLES_PER_CATEGORY = 100;

export function DataCollectionProgress({ categories }: DataCollectionProgressProps) {
  // Sort by total samples (ascending) to show what needs more data
  const sortedByNeed = [...categories].sort((a, b) => a.settled - b.settled);
  const priorityCategories = sortedByNeed.slice(0, 5);

  // Calculate overall data sufficiency
  const categoriesWithEnoughData = categories.filter(c => c.settled >= TARGET_SAMPLES_PER_CATEGORY).length;
  const totalCategories = categories.length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            Data Collection Status
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {categoriesWithEnoughData}/{totalCategories} ready
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall Progress */}
        <div className="p-3 rounded-lg bg-muted/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Overall Data Sufficiency</span>
            <span className="text-sm text-muted-foreground">
              {totalCategories > 0 ? Math.round((categoriesWithEnoughData / totalCategories) * 100) : 0}%
            </span>
          </div>
          <Progress 
            value={totalCategories > 0 ? (categoriesWithEnoughData / totalCategories) * 100 : 0}
            className="h-2"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Need {TARGET_SAMPLES_PER_CATEGORY}+ settled samples per category for reliable predictions
          </p>
        </div>

        {/* Priority Categories (Need More Data) */}
        <div>
          <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Priority: Need More Data
          </h4>
          <div className="space-y-3">
            {priorityCategories.map((cat, idx) => {
              const progress = (cat.settled / TARGET_SAMPLES_PER_CATEGORY) * 100;
              const needMore = TARGET_SAMPLES_PER_CATEGORY - cat.settled;
              const isReady = cat.settled >= TARGET_SAMPLES_PER_CATEGORY;
              
              return (
                <div key={idx} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {isReady ? (
                        <CheckCircle className="w-3 h-3 text-green-500" />
                      ) : (
                        <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
                      )}
                      <span className="text-sm font-medium">{cat.sport}</span>
                      <Badge variant="secondary" className="text-xs">
                        {cat.bet_type}
                      </Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {cat.settled}/{TARGET_SAMPLES_PER_CATEGORY}
                    </span>
                  </div>
                  <Progress value={Math.min(progress, 100)} className="h-1.5" />
                  {!isReady && (
                    <p className="text-xs text-yellow-500">
                      Need ~{needMore} more settled samples
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Categories with Most Pending */}
        <div>
          <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
            Highest Pending (Need Settlement)
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {[...categories]
              .sort((a, b) => b.pending - a.pending)
              .slice(0, 4)
              .map((cat, idx) => (
                <div key={idx} className="p-2 rounded bg-muted/30 text-center">
                  <p className="text-xs text-muted-foreground truncate">{cat.sport}</p>
                  <p className="text-lg font-bold text-foreground">{cat.pending}</p>
                  <p className="text-xs text-muted-foreground">pending</p>
                </div>
              ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
