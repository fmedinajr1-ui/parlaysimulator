import { useState, useEffect } from "react";
import { BottomNav } from "@/components/BottomNav";
import { FeedCard } from "@/components/FeedCard";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trophy, Flame, TrendingUp, Crown, Medal, Award, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface LeaderboardEntry {
  user_id: string;
  username: string | null;
  avatar_url: string | null;
  lifetime_degenerate_score: number;
  total_staked: number;
  total_wins: number;
  total_losses: number;
  total_parlays: number;
  period_staked: number;
  period_parlays: number;
  avg_probability: number;
}

type TimePeriod = 'all' | 'monthly' | 'weekly';

const getRankIcon = (rank: number) => {
  switch (rank) {
    case 1:
      return <Crown className="w-5 h-5 text-neon-yellow" />;
    case 2:
      return <Medal className="w-5 h-5 text-gray-400" />;
    case 3:
      return <Award className="w-5 h-5 text-amber-600" />;
    default:
      return <span className="text-sm font-bold text-muted-foreground">#{rank}</span>;
  }
};

const getDegenTier = (score: number) => {
  if (score >= 80) return { label: 'DEGEN KING', color: 'text-neon-red', bg: 'bg-neon-red/20' };
  if (score >= 60) return { label: 'FULL TILT', color: 'text-neon-orange', bg: 'bg-neon-orange/20' };
  if (score >= 40) return { label: 'SWEATING', color: 'text-neon-yellow', bg: 'bg-neon-yellow/20' };
  if (score >= 20) return { label: 'CASUAL', color: 'text-neon-purple', bg: 'bg-neon-purple/20' };
  return { label: 'ROOKIE', color: 'text-neon-green', bg: 'bg-neon-green/20' };
};

const Leaderboard = () => {
  const [period, setPeriod] = useState<TimePeriod>('all');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase.rpc('get_leaderboard_stats', {
          time_period: period
        });

        if (error) {
          console.error('Error fetching leaderboard:', error);
          setEntries([]);
        } else {
          setEntries(data || []);
        }
      } catch (err) {
        console.error('Failed to fetch leaderboard:', err);
        setEntries([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchLeaderboard();
  }, [period]);

  const getPeriodLabel = () => {
    switch (period) {
      case 'weekly': return 'This Week';
      case 'monthly': return 'This Month';
      default: return 'All Time';
    }
  };

  return (
    <div className="min-h-screen bg-background pb-24 touch-pan-y">
      <main className="max-w-lg mx-auto px-3 py-4">
        {/* Header */}
        <div className="text-center mb-5">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full gradient-fire mb-3">
            <Trophy className="w-8 h-8 text-background" />
          </div>
          <h1 className="font-display text-3xl text-gradient-fire mb-1">
            🏆 DEGEN LEADERBOARD
          </h1>
          <p className="text-muted-foreground text-sm">
            The most unhinged bettors. Respect the grind.
          </p>
        </div>

        {/* Period Tabs */}
        <Tabs value={period} onValueChange={(v) => setPeriod(v as TimePeriod)} className="mb-5">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="all" className="font-display text-xs">
              ALL TIME
            </TabsTrigger>
            <TabsTrigger value="monthly" className="font-display text-xs">
              MONTHLY
            </TabsTrigger>
            <TabsTrigger value="weekly" className="font-display text-xs">
              WEEKLY
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Stats Header */}
        <FeedCard variant="full-bleed" className="mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-neon-orange" />
              <span className="font-display text-sm">{getPeriodLabel()} Rankings</span>
            </div>
            <span className="text-xs text-muted-foreground">
              {entries.length} degens ranked
            </span>
          </div>
        </FeedCard>

        {/* Leaderboard List */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-neon-purple mb-3" />
            <p className="text-muted-foreground">Loading the degenerates...</p>
          </div>
        ) : entries.length === 0 ? (
          <FeedCard variant="full-bleed" className="text-center py-8">
            <div className="text-4xl mb-3">🦗</div>
            <p className="text-muted-foreground mb-2">No degens found yet</p>
            <p className="text-xs text-muted-foreground">
              Be the first to analyze a parlay and set a username!
            </p>
          </FeedCard>
        ) : (
          <div className="space-y-2">
            {/* Top 3 Podium */}
            {entries.slice(0, 3).length > 0 && (
              <FeedCard variant="full-bleed" className="mb-4">
                <div className="flex items-end justify-center gap-2 py-4">
                  {/* 2nd Place */}
                  {entries[1] && (
                    <div className="flex flex-col items-center">
                      <Avatar className="w-12 h-12 border-2 border-gray-400 mb-2">
                        <AvatarImage src={entries[1].avatar_url || undefined} />
                        <AvatarFallback className="bg-gray-400/20 text-gray-400">
                          {entries[1].username?.[0]?.toUpperCase() || '?'}
                        </AvatarFallback>
                      </Avatar>
                      <Medal className="w-5 h-5 text-gray-400 mb-1" />
                      <p className="text-xs font-medium truncate max-w-[80px]">
                        {entries[1].username || 'Anonymous'}
                      </p>
                      <p className="text-xs text-gray-400 font-mono">
                        {entries[1].lifetime_degenerate_score.toFixed(0)}
                      </p>
                      <div className="h-16 w-20 bg-gray-400/20 rounded-t-lg mt-2" />
                    </div>
                  )}
                  
                  {/* 1st Place */}
                  {entries[0] && (
                    <div className="flex flex-col items-center -mb-4">
                      <Avatar className="w-16 h-16 border-2 border-neon-yellow mb-2 ring-2 ring-neon-yellow/50">
                        <AvatarImage src={entries[0].avatar_url || undefined} />
                        <AvatarFallback className="bg-neon-yellow/20 text-neon-yellow">
                          {entries[0].username?.[0]?.toUpperCase() || '?'}
                        </AvatarFallback>
                      </Avatar>
                      <Crown className="w-6 h-6 text-neon-yellow mb-1" />
                      <p className="text-sm font-bold truncate max-w-[100px]">
                        {entries[0].username || 'Anonymous'}
                      </p>
                      <p className="text-sm text-neon-yellow font-mono font-bold">
                        {entries[0].lifetime_degenerate_score.toFixed(0)}
                      </p>
                      <div className="h-24 w-24 bg-neon-yellow/20 rounded-t-lg mt-2" />
                    </div>
                  )}
                  
                  {/* 3rd Place */}
                  {entries[2] && (
                    <div className="flex flex-col items-center">
                      <Avatar className="w-12 h-12 border-2 border-amber-600 mb-2">
                        <AvatarImage src={entries[2].avatar_url || undefined} />
                        <AvatarFallback className="bg-amber-600/20 text-amber-600">
                          {entries[2].username?.[0]?.toUpperCase() || '?'}
                        </AvatarFallback>
                      </Avatar>
                      <Award className="w-5 h-5 text-amber-600 mb-1" />
                      <p className="text-xs font-medium truncate max-w-[80px]">
                        {entries[2].username || 'Anonymous'}
                      </p>
                      <p className="text-xs text-amber-600 font-mono">
                        {entries[2].lifetime_degenerate_score.toFixed(0)}
                      </p>
                      <div className="h-12 w-20 bg-amber-600/20 rounded-t-lg mt-2" />
                    </div>
                  )}
                </div>
              </FeedCard>
            )}

            {/* Rest of Leaderboard */}
            {entries.slice(3).map((entry, idx) => {
              const rank = idx + 4;
              const tier = getDegenTier(Number(entry.lifetime_degenerate_score));
              
              return (
                <FeedCard 
                  key={entry.user_id} 
                  variant="full-bleed"
                  className="slide-up"
                  style={{ animationDelay: `${idx * 30}ms` }}
                >
                  <div className="flex items-center gap-3">
                    {/* Rank */}
                    <div className="w-8 flex items-center justify-center">
                      {getRankIcon(rank)}
                    </div>

                    {/* Avatar */}
                    <Avatar className="w-10 h-10">
                      <AvatarImage src={entry.avatar_url || undefined} />
                      <AvatarFallback className="bg-muted">
                        {entry.username?.[0]?.toUpperCase() || '?'}
                      </AvatarFallback>
                    </Avatar>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">
                          {entry.username || 'Anonymous'}
                        </p>
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded font-bold",
                          tier.bg, tier.color
                        )}>
                          {tier.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{entry.total_parlays} parlays</span>
                        <span className="text-neon-green">{entry.total_wins}W</span>
                        <span className="text-neon-red">{entry.total_losses}L</span>
                      </div>
                    </div>

                    {/* Degen Score */}
                    <div className="text-right">
                      <p className="font-display text-lg text-neon-orange">
                        {Number(entry.lifetime_degenerate_score).toFixed(0)}
                      </p>
                      <p className="text-[10px] text-muted-foreground uppercase">
                        Degen Score
                      </p>
                    </div>
                  </div>

                  {/* Period Stats (for weekly/monthly) */}
                  {period !== 'all' && entry.period_parlays > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3 text-neon-purple" />
                        <span className="text-muted-foreground">{getPeriodLabel()}:</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span>{entry.period_parlays} parlays</span>
                        <span className="font-mono">${Number(entry.period_staked).toFixed(0)} staked</span>
                      </div>
                    </div>
                  )}
                </FeedCard>
              );
            })}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
};

export default Leaderboard;
