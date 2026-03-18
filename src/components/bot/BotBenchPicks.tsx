import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Armchair, TrendingUp, TrendingDown } from 'lucide-react';

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const PROP_LABELS: Record<string, string> = {
  points: 'PTS', rebounds: 'REB', assists: 'AST',
  threes: '3PT', blocks: 'BLK', steals: 'STL',
  player_points: 'PTS', player_rebounds: 'REB', player_assists: 'AST',
  player_threes: '3PT', player_blocks: 'BLK', player_steals: 'STL',
};

export const BotBenchPicks = () => {
  const today = getEasternDate();

  const { data: picks, isLoading } = useQuery({
    queryKey: ['bench-picks', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bot_daily_pick_pool')
        .select('*')
        .eq('pick_date', today)
        .eq('was_used_in_parlay', false)
        .order('confidence_score', { ascending: false })
        .limit(25);

      if (error) throw error;
      return data || [];
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['bench-picks-stats', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bot_daily_pick_pool')
        .select('was_used_in_parlay')
        .eq('pick_date', today);

      if (error) throw error;
      const total = (data || []).length;
      const used = (data || []).filter(d => d.was_used_in_parlay).length;
      return { total, used, bench: total - used };
    },
  });

  if (isLoading) {
    return (
      <Card className="border-muted/30">
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          Loading bench picks...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-muted/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Armchair className="w-4 h-4 text-yellow-500" />
          <span>Bench Picks</span>
          {stats && (
            <div className="ml-auto flex gap-2 text-xs">
              <Badge variant="outline" className="text-green-500 border-green-500/30">
                {stats.used} used
              </Badge>
              <Badge variant="outline" className="text-yellow-500 border-yellow-500/30">
                {stats.bench} bench
              </Badge>
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!picks || picks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No bench picks available today
          </p>
        ) : (
          <ScrollArea className="max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Player</TableHead>
                  <TableHead className="text-xs">Prop</TableHead>
                  <TableHead className="text-xs">Side</TableHead>
                  <TableHead className="text-xs">Line</TableHead>
                  <TableHead className="text-xs">Conf</TableHead>
                  <TableHead className="text-xs">L10</TableHead>
                  <TableHead className="text-xs">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {picks.map((pick, idx) => {
                  const propLabel = PROP_LABELS[(pick.prop_type || '').toLowerCase()] || pick.prop_type || '—';
                  const isOver = (pick.recommended_side || 'over').toLowerCase() === 'over';

                  return (
                    <TableRow key={pick.id || idx}>
                      <TableCell className="text-sm font-medium py-2">
                        {pick.player_name}
                      </TableCell>
                      <TableCell className="text-xs py-2">{propLabel}</TableCell>
                      <TableCell className="py-2">
                        <Badge
                          variant="outline"
                          className={isOver
                            ? 'text-green-500 border-green-500/30 text-xs'
                            : 'text-red-400 border-red-400/30 text-xs'
                          }
                        >
                          {isOver ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                          {(pick.recommended_side || 'OVER').toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm py-2">
                        {pick.recommended_line ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm py-2">
                        {pick.confidence_score
                          ? `${(pick.confidence_score * 100).toFixed(0)}%`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2">
                        {pick.l10_avg ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2">
                        {pick.rejection_reason || '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
};
