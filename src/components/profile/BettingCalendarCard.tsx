import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FeedCard } from '@/components/FeedCard';
import { Calendar, Flame, Target, Trophy, Sparkles, TrendingUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { getUpcomingEvents, MONTH_LABELS, DAY_LABELS, ChampionshipEvent } from '@/lib/sports-calendar';

interface MonthStat {
  month: number;
  label: string;
  winRate: number;
  totalBets: number;
  upsetWins: number;
}

interface DayStat {
  dayOfWeek: number;
  label: string;
  winRate: number;
  totalBets: number;
  isHot: boolean;
}

interface CalendarInsights {
  hotMonths: MonthStat[];
  hotDays: DayStat[];
  upsetDays: { dayOfWeek: number; label: string }[];
  aiInsight: string;
  hasData: boolean;
}

interface BettingCalendarCardProps {
  userId: string;
}

export function BettingCalendarCard({ userId }: BettingCalendarCardProps) {
  const [insights, setInsights] = useState<CalendarInsights | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [upcomingEvents] = useState<ChampionshipEvent[]>(getUpcomingEvents(4));

  useEffect(() => {
    fetchInsights();
  }, [userId]);

  const fetchInsights = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('betting-calendar-insights', {
        body: { userId }
      });

      if (error) throw error;
      setInsights(data);
    } catch (error) {
      console.error('Error fetching calendar insights:', error);
      setInsights({
        hotMonths: [],
        hotDays: [],
        upsetDays: [],
        aiInsight: "Start betting to unlock your personalized calendar insights!",
        hasData: false
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getWinRateColor = (rate: number) => {
    if (rate >= 60) return 'bg-green-500';
    if (rate >= 50) return 'bg-yellow-500';
    if (rate >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getWinRateWidth = (rate: number) => {
    return `${Math.min(rate, 100)}%`;
  };

  if (isLoading) {
    return (
      <FeedCard variant="glow" className="space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-6 w-48" />
        </div>
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </FeedCard>
    );
  }

  return (
    <FeedCard variant="glow" className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-primary" />
          <h3 className="font-display text-lg font-bold text-foreground">SMART BETTING CALENDAR</h3>
        </div>
        <Badge variant="outline" className="text-xs border-primary/30 text-primary">
          <Sparkles className="w-3 h-3 mr-1" />
          AI Powered
        </Badge>
      </div>

      {/* Best Days to Bet */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Flame className="w-4 h-4 text-orange-500" />
          <span>BEST DAYS TO BET</span>
        </div>
        
        {insights?.hasData && insights.hotDays.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {DAY_LABELS.map((day, idx) => {
              const dayStat = insights.hotDays.find(d => d.dayOfWeek === idx);
              const winRate = dayStat?.winRate || 0;
              const totalBets = dayStat?.totalBets || 0;
              const isHot = dayStat?.isHot || false;
              
              return (
                <div key={day} className="relative">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className={`${isHot ? 'text-orange-400 font-medium' : 'text-muted-foreground'}`}>
                      {day.slice(0, 3)} {isHot && '🔥'}
                    </span>
                    <span className="text-foreground font-medium">
                      {totalBets > 0 ? `${winRate}%` : '-'}
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${getWinRateColor(winRate)} transition-all duration-500`}
                      style={{ width: totalBets > 0 ? getWinRateWidth(winRate) : '0%' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Place some bets to see your best days!
          </p>
        )}
      </div>

      {/* Hot Months */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <TrendingUp className="w-4 h-4 text-green-500" />
          <span>MONTHLY PERFORMANCE</span>
        </div>
        
        {insights?.hasData && insights.hotMonths.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {MONTH_LABELS.map((month, idx) => {
              const monthStat = insights.hotMonths.find(m => m.month === idx + 1);
              const winRate = monthStat?.winRate || 0;
              const totalBets = monthStat?.totalBets || 0;
              const isHot = winRate >= 55 && totalBets >= 3;
              
              return (
                <div
                  key={month}
                  className={`px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                    totalBets > 0
                      ? isHot
                        ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                        : winRate >= 45
                          ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                          : 'bg-muted text-muted-foreground border border-border'
                      : 'bg-muted/50 text-muted-foreground/50 border border-border/50'
                  }`}
                  title={totalBets > 0 ? `${winRate}% win rate (${totalBets} bets)` : 'No data'}
                >
                  {month}
                  {isHot && ' 🔥'}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Build your monthly track record!
          </p>
        )}
      </div>

      {/* Upcoming Championship Events */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Trophy className="w-4 h-4 text-yellow-500" />
          <span>UPCOMING CHAMPIONSHIP EVENTS</span>
        </div>
        
        <div className="space-y-2">
          {upcomingEvents.map((event, idx) => (
            <div 
              key={`${event.sport}-${event.event}-${idx}`}
              className="flex items-center justify-between p-2 rounded-lg bg-muted/50 border border-border/50"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{event.emoji}</span>
                <div>
                  <p className="text-sm font-medium text-foreground">{event.event}</p>
                  <p className="text-xs text-muted-foreground">{event.sport}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">
                  {MONTH_LABELS[event.month - 1]} {event.specificDay || `${event.dayRange?.[0]}-${event.dayRange?.[1]}`}
                </p>
                {event.upsetProne && (
                  <Badge variant="outline" className="text-[10px] border-orange-500/30 text-orange-400 mt-1">
                    <Target className="w-2 h-2 mr-1" />
                    Upset Window
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AI Insight */}
      <div className="p-3 rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20">
        <div className="flex items-start gap-2">
          <div className="p-1.5 rounded-lg bg-primary/20">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-xs font-medium text-primary mb-1">AI INSIGHT</p>
            <p className="text-sm text-foreground leading-relaxed">
              {insights?.aiInsight}
            </p>
          </div>
        </div>
      </div>
    </FeedCard>
  );
}
