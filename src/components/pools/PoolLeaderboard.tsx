import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Trophy, Medal, TrendingUp, Users } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface LeaderboardEntry {
  id: string;
  user_id: string;
  total_pools_joined: number;
  pools_won: number;
  legs_submitted: number;
  legs_won: number;
  total_payout: number;
  total_staked: number;
  roi_percentage: number;
  current_streak: number;
}

export function PoolLeaderboard() {
  const { user } = useAuth();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;

        const response = await supabase.functions.invoke('pool-manager', {
          body: { action: 'get-leaderboard' },
          headers: { Authorization: `Bearer ${token}` }
        });

        if (response.data?.leaderboard) {
          setLeaderboard(response.data.leaderboard);
        }
      } catch (error) {
        console.error('Error fetching leaderboard:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
  }, []);

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Trophy className="w-5 h-5 text-yellow-500" />;
      case 2:
        return <Medal className="w-5 h-5 text-gray-400" />;
      case 3:
        return <Medal className="w-5 h-5 text-amber-600" />;
      default:
        return <span className="w-5 h-5 text-center text-muted-foreground">{rank}</span>;
    }
  };

  const getRankStyle = (rank: number) => {
    switch (rank) {
      case 1:
        return 'border-yellow-500/50 bg-yellow-500/5';
      case 2:
        return 'border-gray-400/50 bg-gray-400/5';
      case 3:
        return 'border-amber-600/50 bg-amber-600/5';
      default:
        return 'border-border';
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map(i => (
          <Card key={i} className="p-4 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-muted" />
              <div className="flex-1">
                <div className="h-4 bg-muted rounded w-1/3 mb-2" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (leaderboard.length === 0) {
    return (
      <Card className="p-8 text-center">
        <Trophy className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
        <h3 className="font-display text-lg mb-2">No Rankings Yet</h3>
        <p className="text-sm text-muted-foreground">
          Join pools and submit legs to appear on the leaderboard
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {leaderboard.map((entry, index) => {
        const rank = index + 1;
        const isCurrentUser = entry.user_id === user?.id;
        const winRate = entry.total_pools_joined > 0 
          ? ((entry.pools_won / entry.total_pools_joined) * 100).toFixed(0)
          : '0';

        return (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card 
              className={`p-4 border-2 transition-colors ${getRankStyle(rank)} ${
                isCurrentUser ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''
              }`}
            >
              <div className="flex items-center gap-4">
                {/* Rank */}
                <div className="flex items-center justify-center w-8">
                  {getRankIcon(rank)}
                </div>

                {/* User Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium truncate">
                      {isCurrentUser ? 'You' : `Player ${entry.user_id.slice(0, 6)}`}
                    </span>
                    {isCurrentUser && (
                      <Badge variant="outline" className="text-xs">You</Badge>
                    )}
                    {entry.current_streak > 2 && (
                      <Badge className="bg-neon-green/20 text-neon-green border-neon-green/30 text-xs">
                        🔥 {entry.current_streak} streak
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {entry.total_pools_joined} pools
                    </span>
                    <span>{entry.pools_won}W</span>
                    <span>{entry.legs_submitted} legs</span>
                  </div>
                </div>

                {/* Stats */}
                <div className="text-right">
                  <div className={`text-lg font-display ${
                    entry.roi_percentage >= 0 ? 'text-neon-green' : 'text-destructive'
                  }`}>
                    {entry.roi_percentage >= 0 ? '+' : ''}{entry.roi_percentage.toFixed(1)}%
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center justify-end gap-1">
                    <TrendingUp className="w-3 h-3" />
                    {winRate}% win rate
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
