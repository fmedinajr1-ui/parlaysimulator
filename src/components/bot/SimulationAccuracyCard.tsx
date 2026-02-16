import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Target } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface AccuracyRow {
  id: string;
  sport: string;
  bet_type: string;
  predictions_made: number;
  predictions_correct: number;
  accuracy_rate: number;
  is_production_ready: boolean;
}

export function SimulationAccuracyCard() {
  const [rows, setRows] = useState<AccuracyRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAccuracy = useCallback(async () => {
    const { data } = await supabase
      .from('simulation_accuracy')
      .select('*')
      .order('accuracy_rate', { ascending: false });
    setRows((data as AccuracyRow[]) || []);
  }, []);

  useEffect(() => {
    fetchAccuracy().finally(() => setLoading(false));
  }, [fetchAccuracy]);

  // Poll every 60s
  useEffect(() => {
    const interval = setInterval(fetchAccuracy, 60000);
    return () => clearInterval(interval);
  }, [fetchAccuracy]);

  if (loading) return <Skeleton className="h-40 w-full" />;

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
          No accuracy data yet — run the simulation engine first.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Target className="w-5 h-5" /> Accuracy by Sport
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r) => {
          const pct = Math.round(r.accuracy_rate * 100);
          return (
            <div key={r.id} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium capitalize">{r.sport.replace(/_/g, ' ')}</span>
                  <span className="text-muted-foreground text-xs">({r.bet_type})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">{r.predictions_correct}/{r.predictions_made}</span>
                  <Badge
                    variant={r.is_production_ready ? 'default' : 'secondary'}
                    className={r.is_production_ready ? 'bg-green-600 hover:bg-green-700 text-[10px]' : 'text-[10px]'}
                  >
                    {r.is_production_ready ? 'Production Ready' : 'Simulating'}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Progress value={pct} className="h-2 flex-1" />
                <span className="text-xs font-mono w-10 text-right">{pct}%</span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
